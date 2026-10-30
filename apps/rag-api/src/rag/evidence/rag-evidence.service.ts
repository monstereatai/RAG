import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmProvider } from '../../providers/llm/llm.provider';
import {
  BadCaseFlywheelService,
  type BadCaseMatch,
} from '../prompts/bad-case-flywheel.service';
import type { QueryTaskType } from '../planning/query-plan';
import type { RagAnswerResult } from '../contracts/rag-types';
import type {
  RetrievalScope,
  RetrievedChunk,
} from '../evidence/retrieval.types';
import { EvidencePolicyService } from './evidence-policy.service';
import { GroundedAnswerGenerationService } from '../generation/grounded-answer-generation.service';
import { RagIndexService } from '../indexing/rag-index.service';
import { RagRetrievalService } from '../retrieval/rag-retrieval.service';

@Injectable()
export class RagEvidenceService {
  private readonly logger = new Logger(RagEvidenceService.name);
  private readonly evidencePolicy: EvidencePolicyService;

  get answerQuality() {
    return this.evidencePolicy.answerQuality;
  }

  get answerGenerationService() {
    return this.answerGenerationServiceInstance;
  }

  private readonly answerGenerationServiceInstance: GroundedAnswerGenerationService;

  constructor(
    private readonly configService: ConfigService,
    private readonly llmProvider: LlmProvider,
    private readonly badCaseFlywheel: BadCaseFlywheelService,
    private readonly indexService: RagIndexService,
    private readonly retrievalService: RagRetrievalService,
    @Optional() evidencePolicy?: EvidencePolicyService,
    @Optional() answerGenerationService?: GroundedAnswerGenerationService,
  ) {
    this.evidencePolicy =
      evidencePolicy ?? new EvidencePolicyService(this.configService);
    this.answerGenerationServiceInstance =
      answerGenerationService ??
      new GroundedAnswerGenerationService(
        this.llmProvider,
        this.evidencePolicy,
        this.configService,
      );
  }

  extractCorrectedAnswer(text: string): string {
    return this.answerGenerationServiceInstance.extractCorrectedAnswer(text);
  }

  async generateCorrectionAnswer(
    query: string,
    correction: string,
    history: Array<{ role: 'human' | 'ai'; content: string }>,
    memoryMessages: Array<{ role: string; content: string }>,
    onToken?: (token: string) => void,
    reviewedQuery?: string,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.answerGenerationServiceInstance.generateCorrectionAnswer(
      query,
      correction,
      history,
      memoryMessages,
      onToken,
      reviewedQuery,
      signal,
    );
  }

  assessRetrievedChunks(
    query: string,
    chunks: RetrievedChunk[],
    taskType: QueryTaskType = 'lookup',
  ): { sufficient: boolean; reason: string } {
    return this.evidencePolicy.assessRetrievedChunks(query, chunks, taskType);
  }

  async retrieveReviewedEvidence(
    query: string,
    limit = 2,
    userId?: string,
    tenantId?: string,
  ): Promise<RetrievedChunk[]> {
    const matches = await this.badCaseFlywheel.retrieveMatches(
      query,
      limit,
      userId,
      tenantId,
    );
    return this.toReviewedEvidenceChunks(matches);
  }

  /** 将已审核纠正候选转换为可参与统一证据门禁的片段。 */
  toReviewedEvidenceChunks(matches: BadCaseMatch[]): RetrievedChunk[] {
    return matches
      .filter((match) => match.mode === 'exact' || match.mode === 'correction')
      .flatMap((match, index): RetrievedChunk[] => {
        const correctedAnswer = this.extractCorrectedAnswer(match.text);
        if (!correctedAnswer) return [];

        return [
          {
            id: `reviewed-bad-case:${match.id}`,
            docId: `reviewed-bad-case:${match.id}`,
            content: `已审核问题：${match.query}\n正确处理标准：${correctedAnswer}`,
            chunkIndex: index,
            bm25Score: match.score,
            cosineScore: match.score,
            totalScore: match.score,
            sourceAuthority: 'reviewed_bad_case',
            retrievalSource: 'expansion',
            contextRole: 'hit',
          } satisfies RetrievedChunk,
        ];
      });
  }

  assessReviewedBaseCaseEvidence(
    matches: BadCaseMatch[],
    chunks: RetrievedChunk[],
  ): { sufficient: boolean; reason: string } {
    if (chunks.length === 0) {
      return { sufficient: false, reason: '未命中已审核纠正证据' };
    }
    const strongest = matches
      .filter((match) => match.mode === 'exact' || match.mode === 'correction')
      .sort((left, right) => right.score - left.score)[0];
    return {
      sufficient: true,
      reason: strongest
        ? `命中已审核 ${strongest.mode} 证据（${strongest.score.toFixed(3)}）`
        : '命中已审核纠正证据',
    };
  }

  assessRetrievalQuality(
    query: string,
    chunks: RetrievedChunk[],
    taskType: QueryTaskType = 'lookup',
  ): { sufficient: boolean; reason: string } {
    return this.evidencePolicy.assessRetrievalQuality(query, chunks, taskType);
  }

  assessCitationSupport(
    answer: string,
    chunks: RetrievedChunk[],
  ): { sufficient: boolean; reason: string } {
    return this.evidencePolicy.assessCitationSupport(answer, chunks);
  }

  validateAnswerCitationSupport(
    answer: string,
    chunks: RetrievedChunk[],
  ): { sufficient: boolean; reason: string } {
    return this.evidencePolicy.assessCitationSupport(answer, chunks);
  }

  /**
   * 统一证据顺序：已执行 Rerank 的候选优先按 rerankScore，未执行 Rerank
   * 的候选回退到 Hybrid RRF 的 totalScore。这样 Agentic 合并多路结果后，
   * 不会再把 Rerank 结果重新按旧的 RRF 分数打乱。
   */
  /**
   * 规则级关系扩展：如果召回到 supplement，补上仍有效的被补充规则；
   * 如果召回到基础规则，补上指向它的补充规则。有效期内的 amend/replace
   * 由 expiredAt 过滤，当前只保留有效版本。
   */
  expandRuleCompanions(
    chunks: RetrievedChunk[],
    scope?: RetrievalScope,
  ): RetrievedChunk[] {
    if (chunks.length === 0) return chunks;
    const expanded = new Map<string, RetrievedChunk>(
      chunks.map((chunk) => [chunk.id, chunk]),
    );
    for (const chunk of chunks) {
      for (const [metaId, meta] of this.indexService.getChunkMeta().entries()) {
        const linked =
          metaId === chunk.supersedesChunkId ||
          meta.supersedesChunkId === chunk.id;
        const sameRule =
          chunk.ruleKey !== null &&
          chunk.ruleKey !== undefined &&
          meta.ruleKey === chunk.ruleKey &&
          meta.docId === chunk.docId;
        if (linked === false && sameRule === false) continue;
        if (!this.retrievalService.isLifecycleVisible(meta, scope)) continue;
        if (expanded.has(metaId)) continue;
        expanded.set(metaId, {
          id: metaId,
          content: meta.content,
          docId: meta.docId,
          chunkIndex: meta.chunkIndex,
          bm25Score: 0,
          cosineScore: 0,
          totalScore: Math.min(chunk.totalScore, 0.01),
          parentChunkId: meta.parentChunkId,
          headingPath: meta.headingPath,
          sectionId: meta.sectionId,
          clauseId: meta.clauseId,
          tableRef: meta.tableRef,
          sourceStart: meta.sourceStart,
          sourceEnd: meta.sourceEnd,
          docVersion: meta.docVersion,
          effectiveAt: meta.effectiveAt,
          expiredAt: meta.expiredAt,
          sourceAuthority: meta.sourceAuthority,
          projectId: meta.projectId,
          activityId: meta.activityId,
          region: meta.region,
          locale: meta.locale,
          channel: meta.channel,
          roleScope: meta.roleScope,
          documentType: meta.documentType,
          lifecycleStatus: meta.lifecycleStatus,
          supersedesDocId: meta.supersedesDocId,
          ruleKey: meta.ruleKey,
          changeType: meta.changeType,
          supersedesChunkId: meta.supersedesChunkId,
          retrievalSource: 'expansion',
          contextRole: 'section',
        });
      }
    }
    return [...expanded.values()];
  }

  rankEvidenceChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
    return this.evidencePolicy.rankEvidenceChunks(chunks);
  }

  /**
   * Agentic 生成节点复用的统一回答器。它与 Simple／Auto 共用同一套：
   * 受约束生成 → 引用门禁 → 语义压缩 → 结构化抽取 → 安全降级。
   * 生成过程先缓存在内存里，只有通过引用校验的答案才推送给前端，避免
   * 先展示一段未被证据支持的草稿、随后又追加一段兜底答案。
   */
  prepareGroundedEvidence(
    chunks: RetrievedChunk[],
    scope?: RetrievalScope,
  ): RetrievedChunk[] {
    return this.expandRuleCompanions(
      this.evidencePolicy.rankEvidenceChunks(chunks),
      scope,
    );
  }

  async generateGroundedAnswer(
    query: string,
    chunks: RetrievedChunk[],
    history: Array<{ role: 'human' | 'ai'; content: string }> = [],
    memoryMessages: Array<{ role: string; content: string }> = [],
    onToken?: (token: string) => void,
    options: {
      userId?: string;
      scope?: RetrievalScope;
      entities?: string[];
      needsSynthesis?: boolean;
      answerRequirements?: string[];
      preferAgenticModel?: boolean;
      signal?: AbortSignal;
    } = {},
  ): Promise<RagAnswerResult> {
    const evidenceChunks = this.prepareGroundedEvidence(chunks, options.scope);
    const result =
      await this.answerGenerationServiceInstance.generateGroundedAnswer(
        query,
        evidenceChunks,
        history,
        memoryMessages,
        onToken,
        {
          answerRequirements: options.answerRequirements,
          preferAgenticModel: options.preferAgenticModel,
          signal: options.signal,
        },
      );
    return {
      answer: result.answer,
      references: this.toReferences(result.citedChunks),
      retrievalSufficient: result.retrievalSufficient,
      retrievalReason: result.retrievalReason,
    };
  }

  repairAnswerCitations(answer: string, chunks: RetrievedChunk[]): string {
    return this.evidencePolicy.repairAnswerCitations(answer, chunks);
  }

  /** 只把答案中实际标记的证据返回给界面，候选召回片段不应伪装成已引用资料。 */
  selectCitedChunks(
    answer: string,
    chunks: RetrievedChunk[],
  ): RetrievedChunk[] {
    return this.evidencePolicy.selectCitedChunks(answer, chunks);
  }

  unsupportedReliableAnswer(): string {
    return this.answerGenerationServiceInstance.unsupportedReliableAnswer();
  }

  buildEvidenceFirstAnswer(
    query: string,
    chunks: RetrievedChunk[],
  ): string | null {
    return this.evidencePolicy.buildEvidenceFirstAnswer(query, chunks);
  }

  buildDeterministicAnswer(
    query: string,
    chunks: RetrievedChunk[],
  ): string | null {
    return this.evidencePolicy.buildDeterministicAnswer(query, chunks);
  }

  buildCitationSafeExtractiveAnswer(
    query: string,
    chunks: RetrievedChunk[],
  ): string | null {
    return this.evidencePolicy.buildCitationSafeExtractiveAnswer(query, chunks);
  }

  toReferences(chunks: RetrievedChunk[]): RagAnswerResult['references'] {
    return chunks.map((c) => ({
      id: c.id,
      content: c.content,
      docId: c.docId,
      chunkIndex: c.chunkIndex,
      totalScore: c.totalScore,
      score: c.totalScore,
      bm25Score: c.bm25Score,
      cosineScore: c.cosineScore,
      ...(c.rerankScore === undefined ? {} : { rerankScore: c.rerankScore }),
      sourceAuthorityWeight: c.sourceAuthorityWeight,
      parentChunkId: c.parentChunkId,
      headingPath: c.headingPath,
      sectionId: c.sectionId,
      clauseId: c.clauseId,
      tableRef: c.tableRef,
      sourceStart: c.sourceStart,
      sourceEnd: c.sourceEnd,
      docVersion: c.docVersion,
      effectiveAt: c.effectiveAt,
      expiredAt: c.expiredAt,
      sourceAuthority: c.sourceAuthority,
      projectId: c.projectId,
      activityId: c.activityId,
      region: c.region,
      locale: c.locale,
      channel: c.channel,
      roleScope: c.roleScope,
      documentType: c.documentType,
      lifecycleStatus: c.lifecycleStatus,
      supersedesDocId: c.supersedesDocId,
      ruleKey: c.ruleKey,
      changeType: c.changeType,
      supersedesChunkId: c.supersedesChunkId,
      retrievalSource: c.retrievalSource,
      contextRole: c.contextRole,
      citationLabel: c.citationLabel,
    }));
  }
}
