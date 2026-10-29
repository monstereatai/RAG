import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmProvider } from '../../providers/llm/llm.provider';
import {
  ObsidianKnowledgeService,
  type ObsidianSearchHit,
} from '../../modules/obsidian/obsidian-knowledge.service';
import {
  BadCaseFlywheelService,
  type BadCaseMatch,
} from '../prompts/bad-case-flywheel.service';
import { BochaSearchService } from '../../tools/bocha-search.service';
import { ToolExecutionPolicyService } from '../../tools/tool-execution-policy.service';
import { appliesToQuery } from '../evidence/evidence-bundle';
import type { AnswerQualityService } from '../evidence/answer-quality.service';
import { GroundedAnswerGenerationService } from '../generation/grounded-answer-generation.service';
import {
  ContextBuilder,
  retrievalProfileForTaskType,
} from '../retrieval/context-builder';
import type {
  DetailedRetrievalResult,
  RetrievalScope,
  RetrievedChunk,
} from '../evidence/retrieval.types';
import type {
  PrefetchedFastPath,
  RagAnswerResult,
  RetrieveOptions,
} from '../contracts/rag-types';
import { RagEvidenceService } from '../evidence/rag-evidence.service';
import { RagObsidianService } from '../evidence/rag-obsidian.service';
import { RagRetrievalService } from '../retrieval/rag-retrieval.service';
import { RagAnswerFallbackService } from './rag-answer-fallback.service';
import { RagFastPathService } from './rag-fast-path.service';
import { RagDirectAnswerService } from './rag-direct-answer.service';
import { RagGroundedAnswerService } from './rag-grounded-answer.service';
import {
  hasExplicitDocumentScope,
  isSupplementalEvidenceRestricted,
} from '../retrieval/scope-policy';

@Injectable()
export class RagAnswerService {
  private readonly logger = new Logger(RagAnswerService.name);
  private readonly answerQuality: AnswerQualityService;
  private readonly answerGenerationService: GroundedAnswerGenerationService;
  private readonly contextBuilder = new ContextBuilder();
  private readonly fallbackService: RagAnswerFallbackService;
  private readonly fastPathService: RagFastPathService;
  private readonly directService: RagDirectAnswerService;
  private readonly groundedAnswerService: RagGroundedAnswerService;

  constructor(
    private readonly configService: ConfigService,
    private readonly llmProvider: LlmProvider,
    private readonly obsidianKnowledge: ObsidianKnowledgeService,
    private readonly badCaseFlywheel: BadCaseFlywheelService,
    private readonly bochaSearchService: BochaSearchService,
    private readonly toolPolicy: ToolExecutionPolicyService,
    private readonly retrievalService: RagRetrievalService,
    private readonly evidenceService: RagEvidenceService,
    private readonly obsidianService: RagObsidianService,
    @Optional() fallbackService?: RagAnswerFallbackService,
    @Optional() fastPathService?: RagFastPathService,
    @Optional() directService?: RagDirectAnswerService,
    @Optional() groundedAnswerService?: RagGroundedAnswerService,
  ) {
    this.answerQuality = this.evidenceService.answerQuality;
    this.answerGenerationService = this.evidenceService.answerGenerationService;
    this.fallbackService =
      fallbackService ??
      new RagAnswerFallbackService(
        configService,
        llmProvider,
        bochaSearchService,
        toolPolicy,
        this.answerGenerationService,
      );
    this.fastPathService =
      fastPathService ??
      new RagFastPathService(
        this.retrievalService,
        this.evidenceService,
        this.obsidianKnowledge,
        this.obsidianService,
        this.badCaseFlywheel,
      );
    this.directService =
      directService ??
      new RagDirectAnswerService(
        configService,
        this.badCaseFlywheel,
        this.retrievalService,
        this.evidenceService,
      );
    this.groundedAnswerService =
      groundedAnswerService ??
      new RagGroundedAnswerService(
        llmProvider,
        this.evidenceService,
        this.fallbackService,
        this.answerGenerationService,
      );
  }

  async answer(
    query: string,
    history: Array<{ role: 'human' | 'ai'; content: string }> = [],
    userId?: string,
    memoryMessages: Array<{ role: string; content: string }> = [],
    onToken?: (token: string) => void,
    retrieveOptions: RetrieveOptions = {},
  ): Promise<RagAnswerResult> {
    // cd：格式化输入，空格去掉
    const normalizedQuery = this.retrievalService.normalizeQuery(query);
    const hasPlannedAnswerRequirements = Boolean(
      retrieveOptions.queryPlan?.subQueries.length,
    );
    // cd：判断是否为结构化算式
    const arithmeticAnswer = this.fallbackService.buildArithmeticAnswer(
      normalizedQuery,
      history,
    );
    if (arithmeticAnswer) {
      onToken?.(arithmeticAnswer);
      return {
        answer: arithmeticAnswer,
        references: [],
        retrievalSufficient: true,
        retrievalReason: '结构化算式求值，已忽略历史设定与无关检索片段',
        obsidianPaths: [],
        obsidianHits: [],
        retrievalDiagnostics: {
          intent: 'lookup',
          candidateDepth: 0,
          expandedChunks: 0,
          duplicateChunksRemoved: 0,
          documentLimitRemoved: 0,
          budgetRemoved: 0,
          contextCharacters: 0,
        },
      };
    }
    // 格式化输入，清理空格
    const retrievalQuery = normalizedQuery;
    const profile =
      retrieveOptions.profile ??
      retrievalProfileForTaskType(
        retrieveOptions.queryPlan?.taskType ?? 'lookup',
      );
    const canUseVector = retrieveOptions.vectorSearch !== false;
    // 直答未命中后统一执行完整 Hybrid RAG；旧的 adaptiveVectorSearch
    // 参数仅保留调用兼容，不再让 lookup 查询跳过向量召回。
    const startsWithVector = canUseVector;
    const initialRetrieveOptions: RetrieveOptions = {
      ...retrieveOptions,
      profile,
      vectorSearch: startsWithVector,
    };
    const prefetchedFastPath = retrieveOptions.prefetchedFastPath;

    const retrieveFormalKnowledge = () =>
      prefetchedFastPath
        ? // auto查过，那结果
          Promise.resolve(prefetchedFastPath.retrieval)
        : // 没查当前问题查询
          this.retrievalService.retrieveWithContextualQuery(
            retrievalQuery,
            initialRetrieveOptions,
            userId,
          );
    const supplementalEvidenceRestricted =
      isSupplementalEvidenceRestricted(retrieveOptions);
    const baseCaseRestricted = hasExplicitDocumentScope(retrieveOptions.scope);
    const retrieveBaseCaseKnowledge = () =>
      baseCaseRestricted
        ? Promise.resolve([] as BadCaseMatch[])
        : prefetchedFastPath?.badCaseMatches
          ? Promise.resolve(prefetchedFastPath.badCaseMatches)
          : this.badCaseFlywheel.retrieveMatches(
              retrievalQuery,
              2,
              userId,
              retrieveOptions.tenantId,
            );
    const retrieveObsidianKnowledge = () =>
      supplementalEvidenceRestricted
        ? Promise.resolve([] as ObsidianSearchHit[])
        : prefetchedFastPath
          ? Promise.resolve(prefetchedFastPath.obsidianHits)
          : this.obsidianKnowledge
              .search(retrievalQuery, 5, {
                userId,
                roles: retrieveOptions.scope?.role
                  ? [retrieveOptions.scope.role]
                  : [],
              })
              .catch((error) => {
                this.logger.warn(
                  `Obsidian fast path failed: ${(error as Error).message}`,
                );
                return [] as ObsidianSearchHit[];
              });

    let badCaseMatches: BadCaseMatch[];
    let initialRetrieval: DetailedRetrievalResult;
    let obsidianHits: ObsidianSearchHit[];
    if (
      retrieveOptions.governedDirectAnswer &&
      !retrieveOptions.supplementalEvidence?.length &&
      !retrieveOptions.needsSynthesis &&
      !prefetchedFastPath
    ) {
      // 受治理直答保留精确纠错覆盖检查：它只查 PostgreSQL 精确问题，
      // 与本地 BM25 直答并行，不触发 Milvus 语义检索。
      const direct = await this.directService.answerDirect(
        query,
        history,
        userId,
        memoryMessages,
        onToken,
        retrieveOptions.scope,
        retrieveOptions.signal,
        retrieveOptions.tenantId,
        baseCaseRestricted === false,
        retrieveOptions.roles ?? [],
        retrieveOptions.departmentIds ?? [],
        retrieveOptions.trustedAdminPrincipal,
      );
      if (direct) {
        return direct;
      }
      // 未走成直答后，纠正语义候选与正式 Hybrid RAG 同时构建。
      [badCaseMatches, initialRetrieval, obsidianHits] = await Promise.all([
        retrieveBaseCaseKnowledge(),
        retrieveFormalKnowledge(),
        retrieveObsidianKnowledge(),
      ]);
    } else {
      // 常规问答没有额外 Bad Case 往返：纠正层与正式知识层并行召回。
      [badCaseMatches, initialRetrieval, obsidianHits] = await Promise.all([
        retrieveBaseCaseKnowledge(),
        retrieveFormalKnowledge(),
        retrieveObsidianKnowledge(),
      ]);
    }
    const exactBadCase = badCaseMatches.find((match) => match.mode === 'exact');
    if (exactBadCase) {
      const correctedAnswer = this.evidenceService.extractCorrectedAnswer(
        exactBadCase.text,
      );
      if (correctedAnswer) {
        const answer = await this.evidenceService.generateCorrectionAnswer(
          query,
          correctedAnswer,
          history,
          memoryMessages,
          onToken,
          exactBadCase.query,
          retrieveOptions.signal,
        );
        return {
          answer,
          references: [],
          retrievalSufficient: true,
          retrievalReason: `命中已审核 Bad Case 纠错证据（${exactBadCase.mode}，${exactBadCase.score.toFixed(3)}）`,
        };
      }
    }
    const retrieval = initialRetrieval;
    const sourceResolution =
      await this.obsidianService.resolveObsidianSourceEvidence(
        retrievalQuery,
        obsidianHits,
        userId,
        retrieveOptions,
      );
    obsidianHits = obsidianHits.filter(
      (hit) => !sourceResolution.sourceNotePaths.has(hit.path),
    );
    const formalChunkMap = new Map<string, RetrievedChunk>();
    for (const chunk of [...retrieval.chunks, ...sourceResolution.chunks]) {
      const existing = formalChunkMap.get(chunk.id);
      if (!existing || chunk.totalScore > existing.totalScore) {
        formalChunkMap.set(chunk.id, chunk);
      }
    }
    const formalChunks = Array.from(formalChunkMap.values());
    const reviewedBaseCaseChunks =
      this.evidenceService.toReviewedEvidenceChunks(badCaseMatches);
    const baseCaseGate = this.evidenceService.assessReviewedBaseCaseEvidence(
      badCaseMatches,
      reviewedBaseCaseChunks,
    );
    const prefetchedBundle = prefetchedFastPath?.evidenceBundle;
    // Fast Path 与正式回答对同一原问题只能有一份充分性结论。此前这里再次
    // 用改写后的文本判定，导致搜索命中后仍可能在问答链路被误报资料不足。
    const attachmentEvidenceCount = formalChunks.filter(
      (chunk) => chunk.retrievalSource === 'attachment',
    ).length;
    const formalRetrievalGate =
      attachmentEvidenceCount > 0
        ? {
            sufficient: true,
            reason: `当前会话附件命中 ${attachmentEvidenceCount} 个片段`,
          }
        : sourceResolution.chunks.length === 0 &&
            prefetchedBundle &&
            appliesToQuery(prefetchedBundle, query)
          ? prefetchedBundle.assessment
          : formalChunks.length === 0
            ? { sufficient: false, reason: 'RAG 没有检索到候选片段' }
            : this.answerQuality.assessRetrievalQuality(
                retrievalQuery,
                formalChunks,
                retrieveOptions.queryPlan?.taskType ?? 'lookup',
              );
    const chunks = formalRetrievalGate.sufficient
      ? [...formalChunks, ...reviewedBaseCaseChunks]
      : [...reviewedBaseCaseChunks, ...formalChunks];
    const retrievalGate = {
      sufficient: baseCaseGate.sufficient || formalRetrievalGate.sufficient,
      reason: baseCaseGate.sufficient
        ? `Base Case: ${baseCaseGate.reason}; RAG: ${formalRetrievalGate.reason}`
        : formalRetrievalGate.reason,
    };
    const correctionBaseCase = badCaseMatches.find(
      (match) => match.mode === 'correction',
    );
    if (
      baseCaseGate.sufficient &&
      !formalRetrievalGate.sufficient &&
      correctionBaseCase
    ) {
      const correctedAnswer = this.evidenceService.extractCorrectedAnswer(
        correctionBaseCase.text,
      );
      if (correctedAnswer) {
        const answer = await this.evidenceService.generateCorrectionAnswer(
          query,
          correctedAnswer,
          history,
          memoryMessages,
          onToken,
          correctionBaseCase.query,
          retrieveOptions.signal,
        );
        return {
          answer,
          references: this.evidenceService.toReferences(reviewedBaseCaseChunks),
          retrievalSufficient: true,
          retrievalReason: `命中已审核 Base Case 纠正证据（${correctionBaseCase.mode}，${correctionBaseCase.score.toFixed(3)}）`,
          retrievalDiagnostics: retrieval.diagnostics,
        };
      }
    }

    const obsidianGate = this.obsidianKnowledge.assessHits(
      retrievalQuery,
      obsidianHits,
    );
    const badCasePrompt = badCaseMatches.length
      ? this.badCaseFlywheel.formatPrompt(badCaseMatches)
      : '';
    const generationMemory = badCasePrompt
      ? [...memoryMessages, { role: 'system', content: badCasePrompt }]
      : memoryMessages;
    const obsidianChunks = this.obsidianService.toObsidianChunks(obsidianHits);
    // 正式 RAG 已有足够证据时，Obsidian 只能作为独立补充源，不能以更高的
    // 文件分数抢占上下文预算；否则无关的 compiled/index 笔记会把正式片段
    // 挤出最终证据，进而触发引用门禁。正式检索不足时仍保留 Obsidian 兜底。
    const evidenceObsidianChunks = formalRetrievalGate.sufficient
      ? []
      : obsidianChunks;
    const evidenceBuild = this.contextBuilder.build(
      [...chunks, ...evidenceObsidianChunks],
      retrieval.profile,
      normalizedQuery,
    );
    const evidenceChunks = this.evidenceService.expandRuleCompanions(
      evidenceBuild.chunks,
      retrieveOptions.scope,
    );
    const hasAttachmentEvidence = evidenceChunks.some(
      (chunk) => chunk.retrievalSource === 'attachment',
    );
    const shouldPreferConversationState =
      retrieveOptions.allowConversationStateAnswer &&
      history.length > 0 &&
      !hasAttachmentEvidence &&
      !this.fallbackService.hasConversationEntityEvidence(
        evidenceChunks,
        retrieveOptions.entities ?? retrieveOptions.queryPlan?.entities,
      );
    if (shouldPreferConversationState) {
      const answer = await this.fallbackService.generateConversationStateAnswer(
        query,
        history,
        onToken,
        retrieveOptions.signal,
      );
      if (answer) {
        return {
          answer,
          references: [],
          retrievalSufficient: true,
          retrievalReason:
            '检索未命中同一实体权威证据，已按本轮最新对话状态回答',
          obsidianPaths: obsidianHits.map((hit) => hit.path),
          obsidianHits,
          retrievalDiagnostics: retrieval.diagnostics,
        };
      }
    }

    if (
      retrieveOptions.queryPlan?.contextMode === 'mixed' &&
      history.some((item) => item.role === 'human')
    ) {
      const answer = await this.fallbackService.generateMixedContextAnswer(
        query,
        history,
        onToken,
        retrieveOptions.signal,
      );
      if (answer) {
        return {
          answer,
          references: [],
          retrievalSufficient: true,
          retrievalReason: '客观事实优先，已补充当前会话中的历史设定',
          obsidianPaths: obsidianHits.map((hit) => hit.path),
          obsidianHits,
          retrievalDiagnostics: retrieval.diagnostics,
        };
      }
    }

    if (chunks.length === 0) {
      if (obsidianGate.sufficient) {
        const answer = await this.fallbackService.generateObsidianAnswer(
          query,
          obsidianHits,
          history,
          generationMemory,
          onToken,
          retrieveOptions.signal,
        );
        return {
          answer,
          references: this.evidenceService.toReferences(obsidianChunks),
          retrievalSufficient: true,
          retrievalReason: obsidianGate.reason,
          obsidianPaths: obsidianHits.map((hit) => hit.path),
          obsidianHits,
          retrievalDiagnostics: retrieval.diagnostics,
        };
      }
      if (retrieveOptions.allowConversationStateAnswer && history.length > 0) {
        const answer =
          await this.fallbackService.generateConversationStateAnswer(
            query,
            history,
            onToken,
            retrieveOptions.signal,
          );
        if (answer) {
          return {
            answer,
            references: [],
            retrievalSufficient: true,
            retrievalReason: '未命中权威资料，已按本轮最新对话状态回答',
            obsidianPaths: [],
            obsidianHits,
            retrievalDiagnostics: retrieval.diagnostics,
          };
        }
      }
      const webFallback = await this.fallbackService.answerWithWebFallback(
        query,
        `没有检索到候选片段；${obsidianGate.reason}`,
        history,
        generationMemory,
        onToken,
        retrieveOptions,
      );
      const modelFallback = !webFallback
        ? await this.fallbackService.answerWithModelFallback(
            query,
            history,
            onToken,
            retrieveOptions,
          )
        : null;
      const answer =
        webFallback?.answer ??
        modelFallback?.answer ??
        this.evidenceService.unsupportedReliableAnswer();
      if (!webFallback && !modelFallback) onToken?.(answer);
      return {
        answer,
        references: webFallback?.references ?? [],
        retrievalSufficient: Boolean(webFallback || modelFallback),
        retrievalReason: webFallback
          ? `没有检索到本地证据；${obsidianGate.reason}；已通过 Bocha 联网搜索补充 ${webFallback.references.length} 条来源`
          : modelFallback
            ? `没有检索到本地证据；联网搜索不可用，已使用模型通用能力回答`
            : `没有检索到候选片段；${obsidianGate.reason}；联网搜索和模型回答均不可用，已进入安全降级`,
        obsidianPaths: obsidianHits.map((hit) => hit.path),
        obsidianHits,
        retrievalDiagnostics: retrieval.diagnostics,
      };
    }

    // 结构化事实优先于“需要综合”的通用标记：needsSynthesis 只表示普通语义
    // 问题需要模型总结，不能阻止 OKR、薪资、版本等已有确定性证据直接回答。
    const earlyDeterministicAnswer = hasPlannedAnswerRequirements
      ? null
      : this.evidenceService.buildDeterministicAnswer(
          normalizedQuery,
          evidenceChunks,
        );
    if (earlyDeterministicAnswer) {
      return {
        answer: earlyDeterministicAnswer,
        references: this.evidenceService.toReferences(evidenceChunks),
        retrievalSufficient: true,
        retrievalReason: '命中明确结构化事实，已使用片段抽取式回答',
        obsidianPaths: obsidianHits.map((hit) => hit.path),
        obsidianHits,
        retrievalDiagnostics: retrieval.diagnostics,
      };
    }

    if (!retrievalGate.sufficient && !obsidianGate.sufficient) {
      if (retrieveOptions.allowConversationStateAnswer && history.length > 0) {
        const answer =
          await this.fallbackService.generateConversationStateAnswer(
            query,
            history,
            onToken,
            retrieveOptions.signal,
          );
        if (answer) {
          return {
            answer,
            references: [],
            retrievalSufficient: true,
            retrievalReason: '权威资料不足，已按本轮最新对话状态回答',
            obsidianPaths: obsidianHits.map((hit) => hit.path),
            obsidianHits,
            retrievalDiagnostics: retrieval.diagnostics,
          };
        }
      }
      const webFallback = await this.fallbackService.answerWithWebFallback(
        query,
        `${retrievalGate.reason}；${obsidianGate.reason}`,
        history,
        generationMemory,
        onToken,
        retrieveOptions,
      );
      const answer =
        webFallback?.answer ?? this.evidenceService.unsupportedReliableAnswer();
      if (!webFallback) onToken?.(answer);
      return {
        answer,
        references: webFallback?.references ?? [],
        retrievalSufficient: Boolean(webFallback),
        retrievalReason: webFallback
          ? `${retrievalGate.reason}；${obsidianGate.reason}；已通过 Bocha 联网搜索补充 ${webFallback.references.length} 条来源`
          : `${retrievalGate.reason}；${obsidianGate.reason}；联网搜索不可用，已进入安全降级`,
        obsidianPaths: obsidianHits.map((hit) => hit.path),
        obsidianHits,
        retrievalDiagnostics: retrieval.diagnostics,
      };
    }

    return this.groundedAnswerService.generate({
      query,
      normalizedQuery,
      evidenceChunks,
      ragChunks: chunks,
      ragChunkCount: chunks.length,
      obsidianChunkCount: obsidianChunks.length,
      obsidianHits,
      retrievalDiagnostics: retrieval.diagnostics,
      history,
      generationMemory,
      answerRequirements: retrieveOptions.queryPlan?.subQueries ?? [],
      hasPlannedAnswerRequirements,
      onToken,
      signal: retrieveOptions.signal,
      preferFastModel: retrieveOptions.preferFastModel,
      obsidianGateSufficient: obsidianGate.sufficient,
    });
  }

  assessFastPath(
    query: string,
    userId?: string,
    options: RetrieveOptions = {},
  ): Promise<{
    sufficient: boolean;
    reason: string;
    chunks: RetrievedChunk[];
    obsidianHits: ObsidianSearchHit[];
    prefetchedFastPath: PrefetchedFastPath;
  }> {
    return this.fastPathService.assessFastPath(query, userId, options);
  }

  answerDirect(
    query: string,
    history: Array<{ role: 'human' | 'ai'; content: string }> = [],
    userId?: string,
    memoryMessages: Array<{ role: string; content: string }> = [],
    onToken?: (token: string) => void,
    scope?: RetrievalScope,
    signal?: AbortSignal,
    tenantId?: string,
    allowBadCase = true,
    roles: string[] = [],
    departmentIds: string[] = [],
    trustedAdminPrincipal = false,
  ): Promise<RagAnswerResult | null> {
    return this.directService.answerDirect(
      query,
      history,
      userId,
      memoryMessages,
      onToken,
      scope,
      signal,
      tenantId,
      allowBadCase,
      roles,
      departmentIds,
      trustedAdminPrincipal,
    );
  }

  unsupportedReliableAnswer(): string {
    return this.evidenceService.unsupportedReliableAnswer();
  }

  private formatAnswerRequirements(requirements: string[]): string {
    return requirements.length
      ? requirements.map((item, index) => `${index + 1}. ${item}`).join('\n')
      : '无（请从用户问题中逐项拆分）';
  }
}
