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
import { createRetrievalFingerprint } from '../evidence/retrieval-fingerprint';
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

type RagAnswerHistory = Array<{ role: 'human' | 'ai'; content: string }>;
type RagAnswerMemory = Array<{ role: string; content: string }>;
type AnswerGate = { sufficient: boolean; reason: string };

interface RagAnswerContext {
  query: string;
  normalizedQuery: string;
  retrievalQuery: string;
  history: RagAnswerHistory;
  userId?: string;
  memoryMessages: RagAnswerMemory;
  onToken?: (token: string) => void;
  retrieveOptions: RetrieveOptions;
  initialRetrieveOptions: RetrieveOptions;
  hasPlannedAnswerRequirements: boolean;
  prefetchedFastPath?: PrefetchedFastPath;
}

type InitialRetrievalOutcome =
  | { kind: 'direct_answer'; answer: RagAnswerResult }
  | {
      kind: 'retrieved';
      badCaseMatches: BadCaseMatch[];
      retrieval: DetailedRetrievalResult;
      obsidianHits: ObsidianSearchHit[];
    };

interface CoreAnswerEvidence {
  retrieval: DetailedRetrievalResult;
  badCaseMatches: BadCaseMatch[];
  obsidianHits: ObsidianSearchHit[];
  reviewedBaseCaseChunks: RetrievedChunk[];
  baseCaseGate: AnswerGate;
  formalRetrievalGate: AnswerGate;
  chunks: RetrievedChunk[];
  retrievalGate: AnswerGate;
}

interface PreparedAnswerEvidence extends CoreAnswerEvidence {
  obsidianGate: AnswerGate;
  generationMemory: RagAnswerMemory;
  obsidianChunks: RetrievedChunk[];
  evidenceChunks: RetrievedChunk[];
}

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
    const normalizedQuery = this.retrievalService.normalizeQuery(query);
    const arithmeticAnswer = this.answerArithmetic(
      normalizedQuery,
      history,
      onToken,
    );
    if (arithmeticAnswer) return arithmeticAnswer;

    const context = this.createAnswerContext(
      query,
      normalizedQuery,
      history,
      userId,
      memoryMessages,
      onToken,
      retrieveOptions,
    );
    // cd：并发拿到 hybrid 和 case base 和 obsidian 证据
    const initial = await this.retrieveInitialEvidence(context);
    if (initial.kind === 'direct_answer') return initial.answer;

    const exactCorrectionAnswer = await this.tryAnswerFromExactCorrection(
      context,
      initial,
    );
    if (exactCorrectionAnswer) return exactCorrectionAnswer;

    const coreEvidence = await this.prepareCoreAnswerEvidence(context, initial);
    const correctionAnswer = await this.tryAnswerFromBaseCaseCorrection(
      context,
      initial,
      coreEvidence,
    );
    if (correctionAnswer) return correctionAnswer;

    const evidence = this.prepareAnswerEvidence(context, coreEvidence);
    const conversationAnswer = await this.tryAnswerFromConversationContext(
      context,
      evidence,
    );
    if (conversationAnswer) return conversationAnswer;

    if (evidence.chunks.length === 0) {
      return this.answerWithoutChunks(context, evidence);
    }

    const deterministicAnswer = context.hasPlannedAnswerRequirements
      ? null
      : this.evidenceService.buildDeterministicAnswer(
          context.normalizedQuery,
          evidence.evidenceChunks,
        );
    if (deterministicAnswer) {
      return {
        answer: deterministicAnswer,
        references: this.evidenceService.toReferences(evidence.evidenceChunks),
        retrievalSufficient: true,
        retrievalReason: '命中明确结构化事实，已使用片段抽取式回答',
        obsidianPaths: evidence.obsidianHits.map((hit) => hit.path),
        obsidianHits: evidence.obsidianHits,
        retrievalDiagnostics: evidence.retrieval.diagnostics,
      };
    }

    if (
      !evidence.retrievalGate.sufficient &&
      !evidence.obsidianGate.sufficient
    ) {
      return this.answerWithInsufficientEvidence(context, evidence);
    }

    return this.groundedAnswerService.generate({
      query: context.query,
      normalizedQuery: context.normalizedQuery,
      evidenceChunks: evidence.evidenceChunks,
      ragChunks: evidence.chunks,
      ragChunkCount: evidence.chunks.length,
      obsidianChunkCount: evidence.obsidianChunks.length,
      obsidianHits: evidence.obsidianHits,
      retrievalDiagnostics: evidence.retrieval.diagnostics,
      history: context.history,
      generationMemory: evidence.generationMemory,
      answerRequirements: context.retrieveOptions.queryPlan?.subQueries ?? [],
      hasPlannedAnswerRequirements: context.hasPlannedAnswerRequirements,
      onToken: context.onToken,
      signal: context.retrieveOptions.signal,
      preferFastModel: context.retrieveOptions.preferFastModel,
      obsidianGateSufficient: evidence.obsidianGate.sufficient,
    });
  }

  private answerArithmetic(
    normalizedQuery: string,
    history: RagAnswerHistory,
    onToken?: (token: string) => void,
  ): RagAnswerResult | null {
    const answer = this.fallbackService.buildArithmeticAnswer(
      normalizedQuery,
      history,
    );
    if (!answer) return null;

    onToken?.(answer);
    return {
      answer,
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

  private createAnswerContext(
    query: string,
    normalizedQuery: string,
    history: RagAnswerHistory,
    userId: string | undefined,
    memoryMessages: RagAnswerMemory,
    onToken: ((token: string) => void) | undefined,
    retrieveOptions: RetrieveOptions,
  ): RagAnswerContext {
    const profile =
      retrieveOptions.profile ??
      retrievalProfileForTaskType(
        retrieveOptions.queryPlan?.taskType ?? 'lookup',
      );
    // 保持完整 Hybrid 检索；旧 adaptiveVectorSearch 参数仅用于调用兼容。
    const initialRetrieveOptions: RetrieveOptions = {
      ...retrieveOptions,
      profile,
      vectorSearch: retrieveOptions.vectorSearch !== false,
    };

    return {
      query,
      normalizedQuery,
      retrievalQuery: normalizedQuery,
      history,
      userId,
      memoryMessages,
      onToken,
      retrieveOptions,
      initialRetrieveOptions,
      hasPlannedAnswerRequirements: Boolean(
        retrieveOptions.queryPlan?.subQueries.length,
      ),
      prefetchedFastPath: retrieveOptions.prefetchedFastPath,
    };
  }

  private async retrieveInitialEvidence(
    context: RagAnswerContext,
  ): Promise<InitialRetrievalOutcome> {
    const { retrievalQuery, initialRetrieveOptions, retrieveOptions, userId } =
      context;
    const prefetchedFastPath = this.canReusePrefetchedFastPath(context)
      ? context.prefetchedFastPath
      : undefined;
    const supplementalEvidenceRestricted =
      isSupplementalEvidenceRestricted(retrieveOptions);
    const baseCaseRestricted = hasExplicitDocumentScope(retrieveOptions.scope);

    const retrieveFormalKnowledge = () =>
      prefetchedFastPath
        ? Promise.resolve(prefetchedFastPath.retrieval)
        : this.retrievalService.retrieveWithContextualQuery(
            retrievalQuery,
            initialRetrieveOptions,
            userId,
          );
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

    if (
      retrieveOptions.governedDirectAnswer &&
      !retrieveOptions.supplementalEvidence?.length &&
      !retrieveOptions.needsSynthesis &&
      !prefetchedFastPath
    ) {
      const directAnswer = await this.directService.answerDirect(
        context.query,
        context.history,
        context.userId,
        context.memoryMessages,
        context.onToken,
        retrieveOptions.scope,
        retrieveOptions.signal,
        retrieveOptions.tenantId,
        baseCaseRestricted === false,
        retrieveOptions.roles ?? [],
        retrieveOptions.departmentIds ?? [],
        retrieveOptions.trustedAdminPrincipal,
      );
      if (directAnswer) {
        return { kind: 'direct_answer', answer: directAnswer };
      }
    }

    const [badCaseMatches, retrieval, obsidianHits] = await Promise.all([
      retrieveBaseCaseKnowledge(),
      retrieveFormalKnowledge(),
      retrieveObsidianKnowledge(),
    ]);
    return {
      kind: 'retrieved',
      badCaseMatches,
      retrieval,
      obsidianHits,
    };
  }

  private async prepareCoreAnswerEvidence(
    context: RagAnswerContext,
    initial: Extract<InitialRetrievalOutcome, { kind: 'retrieved' }>,
  ): Promise<CoreAnswerEvidence> {
    const { retrieval, badCaseMatches } = initial;
    let obsidianHits = initial.obsidianHits;
    const sourceResolution =
      await this.obsidianService.resolveObsidianSourceEvidence(
        context.retrievalQuery,
        obsidianHits,
        context.userId,
        context.retrieveOptions,
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
    const obsidianChunks = this.obsidianService.toObsidianChunks(obsidianHits);
    const requiredAspects = context.retrieveOptions.queryPlan?.subQueries ?? [];
    const taskType = context.retrieveOptions.queryPlan?.taskType ?? 'lookup';
    const baseCaseGate = this.answerQuality.assessRetrievalQuality(
      context.retrievalQuery,
      reviewedBaseCaseChunks,
      taskType,
      requiredAspects,
    );
    const prefetchedBundle = context.prefetchedFastPath?.evidenceBundle;
    const canReusePrefetched = this.canReusePrefetchedFastPath(context);
    const formalRetrievalGate = this.answerQuality.assessRetrievalQuality(
      context.retrievalQuery,
      formalChunks,
      taskType,
      requiredAspects,
    );
    const retrievalGate =
      canReusePrefetched && prefetchedBundle
        ? prefetchedBundle.assessment
        : this.answerQuality.assessRetrievalQuality(
            context.retrievalQuery,
            [...formalChunks, ...reviewedBaseCaseChunks, ...obsidianChunks],
            taskType,
            requiredAspects,
          );
    const chunks = [...formalChunks, ...reviewedBaseCaseChunks];

    return {
      retrieval,
      badCaseMatches,
      obsidianHits,
      reviewedBaseCaseChunks,
      baseCaseGate,
      formalRetrievalGate,
      chunks,
      retrievalGate,
    };
  }

  private canReusePrefetchedFastPath(context: RagAnswerContext): boolean {
    const prefetchedFastPath = context.prefetchedFastPath;
    const prefetchedBundle = prefetchedFastPath?.evidenceBundle;
    if (
      !prefetchedFastPath?.retrievalAttempted ||
      !prefetchedBundle ||
      !appliesToQuery(prefetchedBundle, context.query)
    ) {
      return false;
    }
    const expectedFingerprint = createRetrievalFingerprint(
      context.retrievalQuery,
      context.userId,
      context.retrieveOptions,
      context.retrieveOptions.executionPlan,
    );
    return (
      prefetchedFastPath.retrievalFingerprints?.includes(expectedFingerprint) ??
      false
    );
  }

  private async tryAnswerFromExactCorrection(
    context: RagAnswerContext,
    initial: Extract<InitialRetrievalOutcome, { kind: 'retrieved' }>,
  ): Promise<RagAnswerResult | null> {
    const exactBadCase = initial.badCaseMatches.find(
      (match) => match.mode === 'exact',
    );
    if (exactBadCase) {
      const reviewedChunks = this.evidenceService.toReviewedEvidenceChunks(
        initial.badCaseMatches,
      );
      const assessment = this.answerQuality.assessRetrievalQuality(
        context.query,
        reviewedChunks,
        context.retrieveOptions.queryPlan?.taskType ?? 'lookup',
        context.retrieveOptions.queryPlan?.subQueries ?? [],
      );
      if (!assessment.sufficient) return null;
      const correctedAnswer = this.evidenceService.extractCorrectedAnswer(
        exactBadCase.text,
      );
      if (correctedAnswer) {
        const answer = await this.evidenceService.generateCorrectionAnswer(
          context.query,
          correctedAnswer,
          context.history,
          context.memoryMessages,
          context.onToken,
          exactBadCase.query,
          context.retrieveOptions.signal,
        );
        return {
          answer,
          references: [],
          retrievalSufficient: true,
          retrievalReason: `命中已审核 Bad Case 纠错证据（${exactBadCase.mode}，${exactBadCase.score.toFixed(3)}）`,
        };
      }
    }
    return null;
  }

  private async tryAnswerFromBaseCaseCorrection(
    context: RagAnswerContext,
    initial: Extract<InitialRetrievalOutcome, { kind: 'retrieved' }>,
    evidence: CoreAnswerEvidence,
  ): Promise<RagAnswerResult | null> {
    const correctionBaseCase = initial.badCaseMatches.find(
      (match) => match.mode === 'correction',
    );
    if (
      evidence.baseCaseGate.sufficient &&
      !evidence.formalRetrievalGate.sufficient &&
      correctionBaseCase
    ) {
      const correctedAnswer = this.evidenceService.extractCorrectedAnswer(
        correctionBaseCase.text,
      );
      if (correctedAnswer) {
        const answer = await this.evidenceService.generateCorrectionAnswer(
          context.query,
          correctedAnswer,
          context.history,
          context.memoryMessages,
          context.onToken,
          correctionBaseCase.query,
          context.retrieveOptions.signal,
        );
        return {
          answer,
          references: this.evidenceService.toReferences(
            evidence.reviewedBaseCaseChunks,
          ),
          retrievalSufficient: true,
          retrievalReason: `命中已审核 Base Case 纠正证据（${correctionBaseCase.mode}，${correctionBaseCase.score.toFixed(3)}）`,
          retrievalDiagnostics: evidence.retrieval.diagnostics,
        };
      }
    }
    return null;
  }

  private prepareAnswerEvidence(
    context: RagAnswerContext,
    core: CoreAnswerEvidence,
  ): PreparedAnswerEvidence {
    const badCasePrompt = core.badCaseMatches.length
      ? this.badCaseFlywheel.formatPrompt(core.badCaseMatches)
      : '';
    const generationMemory = badCasePrompt
      ? [...context.memoryMessages, { role: 'system', content: badCasePrompt }]
      : context.memoryMessages;
    const obsidianChunks = this.obsidianService.toObsidianChunks(
      core.obsidianHits,
    );
    const obsidianGate = this.answerQuality.assessRetrievalQuality(
      context.retrievalQuery,
      obsidianChunks,
      context.retrieveOptions.queryPlan?.taskType ?? 'lookup',
      context.retrieveOptions.queryPlan?.subQueries ?? [],
    );
    const evidenceObsidianChunks = core.formalRetrievalGate.sufficient
      ? []
      : obsidianChunks;
    const evidenceChunks = this.evidenceService.expandRuleCompanions(
      evidenceObsidianChunks.length > 0
        ? this.contextBuilder.build(
            [...core.chunks, ...evidenceObsidianChunks],
            core.retrieval.profile,
            context.normalizedQuery,
          ).chunks
        : core.chunks,
      context.retrieveOptions.scope,
    );

    return {
      ...core,
      obsidianGate,
      generationMemory,
      obsidianChunks,
      evidenceChunks,
    };
  }

  private async tryAnswerFromConversationContext(
    context: RagAnswerContext,
    evidence: PreparedAnswerEvidence,
  ): Promise<RagAnswerResult | null> {
    const hasAttachmentEvidence = evidence.evidenceChunks.some(
      (chunk) => chunk.retrievalSource === 'attachment',
    );
    const shouldPreferConversationState =
      context.retrieveOptions.allowConversationStateAnswer &&
      context.history.length > 0 &&
      !hasAttachmentEvidence &&
      !this.fallbackService.hasConversationEntityEvidence(
        evidence.evidenceChunks,
        context.retrieveOptions.entities ??
          context.retrieveOptions.queryPlan?.entities,
      );
    if (shouldPreferConversationState) {
      const answer = await this.fallbackService.generateConversationStateAnswer(
        context.query,
        context.history,
        context.onToken,
        context.retrieveOptions.signal,
      );
      if (answer) {
        return {
          answer,
          references: [],
          retrievalSufficient: true,
          retrievalReason:
            '检索未命中同一实体权威证据，已按本轮最新对话状态回答',
          obsidianPaths: evidence.obsidianHits.map((hit) => hit.path),
          obsidianHits: evidence.obsidianHits,
          retrievalDiagnostics: evidence.retrieval.diagnostics,
        };
      }
    }

    if (
      context.retrieveOptions.queryPlan?.contextMode === 'mixed' &&
      context.history.some((item) => item.role === 'human')
    ) {
      const answer = await this.fallbackService.generateMixedContextAnswer(
        context.query,
        context.history,
        context.onToken,
        context.retrieveOptions.signal,
      );
      if (answer) {
        return {
          answer,
          references: [],
          retrievalSufficient: true,
          retrievalReason: '客观事实优先，已补充当前会话中的历史设定',
          obsidianPaths: evidence.obsidianHits.map((hit) => hit.path),
          obsidianHits: evidence.obsidianHits,
          retrievalDiagnostics: evidence.retrieval.diagnostics,
        };
      }
    }
    return null;
  }

  private async answerWithoutChunks(
    context: RagAnswerContext,
    evidence: PreparedAnswerEvidence,
  ): Promise<RagAnswerResult> {
    if (evidence.obsidianGate.sufficient) {
      const answer = await this.fallbackService.generateObsidianAnswer(
        context.query,
        evidence.obsidianHits,
        context.history,
        evidence.generationMemory,
        context.onToken,
        context.retrieveOptions.signal,
      );
      return {
        answer,
        references: this.evidenceService.toReferences(evidence.obsidianChunks),
        retrievalSufficient: true,
        retrievalReason: evidence.obsidianGate.reason,
        obsidianPaths: evidence.obsidianHits.map((hit) => hit.path),
        obsidianHits: evidence.obsidianHits,
        retrievalDiagnostics: evidence.retrieval.diagnostics,
      };
    }

    if (
      context.retrieveOptions.allowConversationStateAnswer &&
      context.history.length > 0
    ) {
      const answer = await this.fallbackService.generateConversationStateAnswer(
        context.query,
        context.history,
        context.onToken,
        context.retrieveOptions.signal,
      );
      if (answer) {
        return {
          answer,
          references: [],
          retrievalSufficient: true,
          retrievalReason: '未命中权威资料，已按本轮最新对话状态回答',
          obsidianPaths: [],
          obsidianHits: evidence.obsidianHits,
          retrievalDiagnostics: evidence.retrieval.diagnostics,
        };
      }
    }

    const webFallback = await this.fallbackService.answerWithWebFallback(
      context.query,
      `没有检索到候选片段；${evidence.obsidianGate.reason}`,
      context.history,
      evidence.generationMemory,
      context.onToken,
      context.retrieveOptions,
    );
    const modelFallback = !webFallback
      ? await this.fallbackService.answerWithModelFallback(
          context.query,
          context.history,
          context.onToken,
          context.retrieveOptions,
        )
      : null;
    const answer =
      webFallback?.answer ??
      modelFallback?.answer ??
      this.evidenceService.unsupportedReliableAnswer();
    if (!webFallback && !modelFallback) context.onToken?.(answer);

    return {
      answer,
      references: webFallback?.references ?? [],
      retrievalSufficient: Boolean(webFallback || modelFallback),
      retrievalReason: webFallback
        ? `没有检索到本地证据；${evidence.obsidianGate.reason}；已通过 Bocha 联网搜索补充 ${webFallback.references.length} 条来源`
        : modelFallback
          ? '没有检索到本地证据；联网搜索不可用，已使用模型通用能力回答'
          : `没有检索到候选片段；${evidence.obsidianGate.reason}；联网搜索和模型回答均不可用，已进入安全降级`,
      obsidianPaths: evidence.obsidianHits.map((hit) => hit.path),
      obsidianHits: evidence.obsidianHits,
      retrievalDiagnostics: evidence.retrieval.diagnostics,
    };
  }

  private async answerWithInsufficientEvidence(
    context: RagAnswerContext,
    evidence: PreparedAnswerEvidence,
  ): Promise<RagAnswerResult> {
    if (
      context.retrieveOptions.allowConversationStateAnswer &&
      context.history.length > 0
    ) {
      const answer = await this.fallbackService.generateConversationStateAnswer(
        context.query,
        context.history,
        context.onToken,
        context.retrieveOptions.signal,
      );
      if (answer) {
        return {
          answer,
          references: [],
          retrievalSufficient: true,
          retrievalReason: '权威资料不足，已按本轮最新对话状态回答',
          obsidianPaths: evidence.obsidianHits.map((hit) => hit.path),
          obsidianHits: evidence.obsidianHits,
          retrievalDiagnostics: evidence.retrieval.diagnostics,
        };
      }
    }

    const webFallback = await this.fallbackService.answerWithWebFallback(
      context.query,
      `${evidence.retrievalGate.reason}；${evidence.obsidianGate.reason}`,
      context.history,
      evidence.generationMemory,
      context.onToken,
      context.retrieveOptions,
    );
    const answer =
      webFallback?.answer ?? this.evidenceService.unsupportedReliableAnswer();
    if (!webFallback) context.onToken?.(answer);

    return {
      answer,
      references: webFallback?.references ?? [],
      retrievalSufficient: Boolean(webFallback),
      retrievalReason: webFallback
        ? `${evidence.retrievalGate.reason}；${evidence.obsidianGate.reason}；已通过 Bocha 联网搜索补充 ${webFallback.references.length} 条来源`
        : `${evidence.retrievalGate.reason}；${evidence.obsidianGate.reason}；联网搜索不可用，已进入安全降级`,
      obsidianPaths: evidence.obsidianHits.map((hit) => hit.path),
      obsidianHits: evidence.obsidianHits,
      retrievalDiagnostics: evidence.retrieval.diagnostics,
    };
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
