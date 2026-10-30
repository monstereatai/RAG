import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmbeddingProvider } from '../../providers/embedding/embedding.provider';
import { ElasticsearchProvider } from '../../providers/elasticsearch/elasticsearch.provider';
import { VectorStoreProvider } from '../../providers/vector-store/vector-store.provider';
import { DocumentPermissionService } from '../../modules/document/document-permission.service';
import { DocumentRetrievalDescriptionService } from '../../modules/document/document-retrieval-description.service';
import { GraphService } from '../../modules/graph/graph.service';
import { ImageIndexService } from '../../modules/image-index/image-index.service';
import { MetricsService } from '../../modules/metrics/metrics.service';
import { DingTalkProvider } from '../../providers/notify/dingtalk.provider';
import { DashScopeRerankService } from '../../tools/dashscope-rerank.service';
import type {
  DetailedRetrievalResult,
  RetrievalCandidateSnapshot,
  RetrievalDiagnostics,
  RetrievalScope,
  RetrievedChunk,
} from '../evidence/retrieval.types';
import type { RetrievalExecutionPlan } from '../contracts/retrieval-execution-plan';
import type { RetrieveOptions } from '../contracts/rag-types';
import { RagIndexService } from '../indexing/rag-index.service';
import { RagChunkPolicyService } from './rag-chunk-policy.service';
import type { Bm25PersistedEntry } from '../indexing/bm25-store';
import { ContextBuilder, retrievalProfileForTaskType } from './context-builder';
import { fusePlannedQueryRuns } from './planned-query-fusion';
import { normalizeQuery } from './query-normalizer';
import { RetrievalPostprocessor } from './retrieval-postprocessor';
import { RetrievalSources } from './retrieval-sources';
import { SupplementalEvidenceRetriever } from './supplemental-evidence-retriever';

@Injectable()
export class RagRetrievalService {
  private readonly logger = new Logger(RagRetrievalService.name);
  private readonly bm25Weight = 0.3;
  private readonly contextBuilder = new ContextBuilder();
  private readonly retrievalPostprocessor: RetrievalPostprocessor;
  private readonly retrievalSources: RetrievalSources;
  private readonly supplementalEvidenceRetriever: SupplementalEvidenceRetriever;
  private readonly chunkPolicy: RagChunkPolicyService;

  private get chunkMeta() {
    return this.indexService.getChunkMeta();
  }

  private get persistedEntries(): readonly Bm25PersistedEntry[] {
    return this.indexService.getPersistedEntries();
  }

  constructor(
    private readonly configService: ConfigService,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly vectorStoreProvider: VectorStoreProvider,
    private readonly elasticsearchProvider: ElasticsearchProvider,
    private readonly metricsService: MetricsService,
    private readonly documentPermissionService: DocumentPermissionService,
    private readonly indexService: RagIndexService,
    @Optional() private readonly rerankService?: DashScopeRerankService,
    @Optional() graphService?: GraphService,
    @Optional() imageIndexService?: ImageIndexService,
    @Optional() private readonly dingTalk?: DingTalkProvider,
    @Optional()
    private readonly retrievalDescriptionService?: DocumentRetrievalDescriptionService,
    @Optional() chunkPolicy?: RagChunkPolicyService,
  ) {
    this.retrievalPostprocessor = new RetrievalPostprocessor(
      configService,
      rerankService,
    );
    this.retrievalSources = new RetrievalSources(
      configService,
      embeddingProvider,
      vectorStoreProvider,
      elasticsearchProvider,
      metricsService,
      this.retrievalPostprocessor,
      retrievalDescriptionService,
      dingTalk,
    );
    this.supplementalEvidenceRetriever = new SupplementalEvidenceRetriever(
      graphService,
      imageIndexService,
    );
    this.chunkPolicy =
      chunkPolicy ??
      new RagChunkPolicyService(configService, indexService, rerankService);
  }

  async retrieve(
    query: string,
    options: RetrieveOptions = {},
    userId?: string,
  ): Promise<RetrievedChunk[]> {
    if (options.executionPlan) {
      const result = await this.retrieveByPlan(
        options.executionPlan,
        { ...options, rankingQuery: options.rankingQuery ?? query },
        userId,
      );
      return result.chunks;
    }
    const result = await this.retrieveDetailed(query, options, userId);
    return result.chunks;
  }

  /**
   * 按统一执行计划检索：每条查询独立完成 Hybrid 召回，跨查询使用带权 RRF
   * 合并，最后始终按原问题重排一次并统一构建上下文。任一补充查询失败时
   * 保留其他查询结果，避免改写或拆题故障拖垮原问题检索。
   */
  async retrieveByPlan(
    executionPlan: RetrievalExecutionPlan,
    options: RetrieveOptions = {},
    userId?: string,
  ): Promise<DetailedRetrievalResult> {
    const plannedQueries = executionPlan.queries
      .map((item) => ({ ...item, text: item.text.trim() }))
      .filter((item) => item.text.length > 0);
    const fallbackQuery = options.rankingQuery?.trim() ?? '';
    const queries =
      plannedQueries.length > 0
        ? plannedQueries
        : fallbackQuery
          ? [
              {
                text: fallbackQuery,
                kind: 'original' as const,
                weight: 1,
              },
            ]
          : [];
    const originalQuery = normalizeQuery(
      queries.find((item) => item.kind === 'original')?.text ??
        queries[0]?.text ??
        fallbackQuery,
    );
    const profile = executionPlan.profile;
    const originalIndex = queries.findIndex((item) => item.kind === 'original');
    const queryRuns = await Promise.allSettled(
      queries.map((plannedQuery, index) =>
        this.retrieveDetailed(
          plannedQuery.text,
          {
            ...options,
            scope: executionPlan.scope ?? options.scope,
            profile,
            supplementalEvidence: undefined,
            skipRerank: true,
            rankingQuery: originalQuery,
            executionPlan: {
              ...executionPlan,
              queries: [plannedQuery],
              useGraph:
                executionPlan.useGraph &&
                plannedQuery.kind === 'original' &&
                index === originalIndex,
            },
          },
          userId,
        ),
      ),
    );

    const fusion = fusePlannedQueryRuns({
      queries,
      queryRuns,
      supplementalEvidence: options.supplementalEvidence,
      rankScore: (rank) => this.chunkPolicy.rankScore(rank),
    });
    for (const failure of fusion.failures) {
      this.logger.warn(
        `Planned retrieval failed for ${failure.kind}: ${failure.message}`,
      );
    }
    let merged = fusion.chunks;
    let bm25FallbackChunks: RetrievedChunk[] = [];
    if (merged.length === 0 && originalQuery) {
      // Simple、Auto 和 Agentic 共用同一空结果兜底；BM25 仍沿用当前用户、租户和 Scope 权限。
      try {
        bm25FallbackChunks = await this.retrieveBm25Only(
          originalQuery,
          userId,
          executionPlan.scope ?? options.scope,
          true,
          options.tenantId,
          options.roles ?? [],
          options.departmentIds ?? [],
          options.trustedAdminPrincipal,
        );
        merged = bm25FallbackChunks;
      } catch (error) {
        this.logger.warn(
          `Planned retrieval BM25 fallback failed: ${(error as Error).message}`,
        );
      }
    }

    let rerankOutcome: { chunks: RetrievedChunk[]; applied: boolean };
    if (merged.length > 0) {
      const rerankStartedAt = process.hrtime.bigint();
      try {
        rerankOutcome = await this.chunkPolicy.applyRerank(
          originalQuery,
          merged,
          options.signal,
        );
      } catch (error) {
        this.metricsService.observeRetrievalStage(
          'rerank',
          'error',
          Number(process.hrtime.bigint() - rerankStartedAt) / 1e9,
        );
        throw error;
      }
      if (rerankOutcome.applied) {
        this.metricsService.observeRetrievalStage(
          'rerank',
          'success',
          Number(process.hrtime.bigint() - rerankStartedAt) / 1e9,
        );
        this.metricsService.observeRetrievalRecalled(
          'rerank',
          'rerank',
          rerankOutcome.chunks.length,
        );
      }
    } else {
      rerankOutcome = { chunks: [], applied: false };
    }

    const built = this.contextBuilder.build(
      rerankOutcome.chunks,
      profile,
      originalQuery,
    );
    const primaryDiagnostics = fusion.primaryResult?.diagnostics;
    const diagnostics: RetrievalDiagnostics = {
      intent: profile.intent,
      candidateDepth: profile.candidateDepth,
      expandedChunks: 0,
      duplicateChunksRemoved: fusion.duplicateChunksRemoved,
      documentLimitRemoved: built.stats.documentLimitRemoved,
      budgetRemoved: built.stats.budgetRemoved,
      contextCharacters: built.stats.contextCharacters,
      contextualQueryUsed: queries.length > 1,
      ...(bm25FallbackChunks.length > 0
        ? { retrievalFallback: 'bm25' as const }
        : {}),
      plannedQueries: fusion.plannedQueries,
      graphProbe: primaryDiagnostics?.graphProbe,
      imageProbe: primaryDiagnostics?.imageProbe,
      stages: {
        keywordCandidates:
          queryRuns.reduce(
            (sum, result) =>
              sum +
              (result.status === 'fulfilled'
                ? (result.value.diagnostics.stages?.keywordCandidates ?? 0)
                : 0),
            0,
          ) + bm25FallbackChunks.length,
        vectorCandidates: queryRuns.reduce(
          (sum, result) =>
            sum +
            (result.status === 'fulfilled'
              ? (result.value.diagnostics.stages?.vectorCandidates ?? 0)
              : 0),
          0,
        ),
        descriptionCandidates: queryRuns.reduce(
          (sum, result) =>
            sum +
            (result.status === 'fulfilled'
              ? (result.value.diagnostics.stages?.descriptionCandidates ?? 0)
              : 0),
          0,
        ),
        descriptionSourceChunks: queryRuns.reduce(
          (sum, result) =>
            sum +
            (result.status === 'fulfilled'
              ? (result.value.diagnostics.stages?.descriptionSourceChunks ?? 0)
              : 0),
          0,
        ),
        fusedCandidates: fusion.fusedCandidateCount + bm25FallbackChunks.length,
        scopedCandidates: merged.length,
        finalCandidates: built.chunks.length,
        filteredByScope: queryRuns.reduce(
          (sum, result) =>
            sum +
            (result.status === 'fulfilled'
              ? (result.value.diagnostics.stages?.filteredByScope ?? 0)
              : 0),
          0,
        ),
        filteredByBudget: built.stats.budgetRemoved,
      },
      candidates: {
        keyword: queryRuns
          .flatMap((result) =>
            result.status === 'fulfilled'
              ? (result.value.diagnostics.candidates?.keyword ?? [])
              : [],
          )
          .concat(this.snapshotCandidates(bm25FallbackChunks))
          .slice(0, 50),
        vector: queryRuns
          .flatMap((result) =>
            result.status === 'fulfilled'
              ? (result.value.diagnostics.candidates?.vector ?? [])
              : [],
          )
          .slice(0, 50),
        fused: this.snapshotCandidates(merged),
        rerankInput: this.snapshotCandidates(merged),
        reranked: this.snapshotCandidates(rerankOutcome.chunks),
        context: this.snapshotCandidates(built.chunks),
      },
    };
    return {
      chunks: built.chunks,
      diagnostics,
      profile,
      vectorSource: fusion.vectorSource,
      rerankApplied: rerankOutcome.applied,
    };
  }

  /**
   * 统一混合召回入口：合并关键词与向量候选，应用权限／生命周期约束，
   * 再做排序、章节扩展和上下文预算治理，同时返回各阶段诊断信息。
   */
  async retrieveDetailed(
    query: string,
    options: RetrieveOptions = {},
    userId?: string,
  ): Promise<DetailedRetrievalResult> {
    const vectorSearch = options.vectorSearch ?? true;
    const normalizedQuery = normalizeQuery(query);
    const profile =
      options.executionPlan?.profile ??
      options.profile ??
      retrievalProfileForTaskType(options.queryPlan?.taskType ?? 'lookup');
    const graphProbeStartedAt = Date.now();
    // Chat 请求一律遵从一次结构化计划；没有 RequestContext 的历史内部调用
    // 保持旧的保守兼容行为，避免无关运营接口的检索语义意外变化。
    const graphRequested = options.executionPlan?.useGraph === true;
    const graphProbeDisabled =
      this.supplementalEvidenceRetriever.skippedGraphProbe(
        'not_requested_by_retrieval_plan',
      );
    // 权限集合在召回前放大候选深度、在融合后再次强制过滤，避免受限文档挤占可见结果。
    const allowedDocIds = userId
      ? await this.documentPermissionService.getAllowedDocIds(
          userId,
          options.roles ?? [],
          options.departmentIds ?? [],
          options.tenantId,
          options.trustedAdminPrincipal,
        )
      : null;
    const isDocumentVisible = (docId: string) =>
      this.chunkPolicy.isEvidenceDocumentVisible(
        docId,
        userId,
        allowedDocIds ?? undefined,
        options.scope,
      );
    // 图谱和图片只是计划允许时才查询的补充证据；召回后仍要经过同一套文档可见性检查。
    const graphProbePromise = graphRequested
      ? this.supplementalEvidenceRetriever.probeGraph(
          normalizedQuery,
          userId,
          isDocumentVisible,
        )
      : Promise.resolve(graphProbeDisabled);
    const imageQueryKind = options.executionPlan?.queries[0]?.kind;
    const imageProbePromise =
      !options.executionPlan || imageQueryKind === 'original'
        ? this.supplementalEvidenceRetriever.probeImages(
            normalizedQuery,
            userId,
            allowedDocIds ?? undefined,
            isDocumentVisible,
          )
        : Promise.resolve(
            this.supplementalEvidenceRetriever.skippedImageProbe(
              'supplemental_query',
            ),
          );
    const candidateDepth = allowedDocIds
      ? profile.candidateDepth * 3
      : profile.candidateDepth;
    const localBm25Hits = this.indexService.searchLocalBm25(
      normalizedQuery,
      userId,
      candidateDepth,
      allowedDocIds ?? undefined,
    );
    const {
      bm25Hits,
      cosineHits,
      vectorSource,
      descriptionCandidateCount,
      descriptionSourceChunkCount,
    } = await this.retrievalSources.recall({
      normalizedQuery,
      candidateDepth,
      vectorSearch,
      userId,
      tenantId: options.tenantId,
      scope: options.scope,
      allowedDocIds,
      localBm25Hits,
      chunkMeta: this.chunkMeta,
      resolveDescriptionHits: (hits, query, ids, owner, scope) =>
        this.chunkPolicy.mapDescriptionHitsToSourceChunks(
          hits,
          query,
          ids,
          owner,
          scope,
        ),
    });

    // RRF 消除不同检索通道的原始分数尺度差异；它不改变后面的版本、权限和范围门禁。
    const fused = this.chunkPolicy
      .fuseByRrf(bm25Hits, cosineHits)
      .filter(
        (chunk) =>
          (!allowedDocIds || allowedDocIds.has(chunk.docId)) &&
          this.chunkPolicy.isLifecycleVisible(chunk, options.scope),
      );
    const fusedCandidateCount = fused.length;
    const scoped = this.chunkPolicy
      .applySourceAuthority(fused)
      .filter((chunk) => this.chunkPolicy.matchesScope(chunk, options.scope))
      .sort((a, b) => b.totalScore - a.totalScore);
    // DashScope 重排：authority/scope 过滤排序后、最终截断前执行，只调整顺序并挂 rerankScore
    const rerankStartedAt = process.hrtime.bigint();
    let rerankOutcome: { chunks: typeof scoped; applied: boolean };
    try {
      rerankOutcome = options.skipRerank
        ? { chunks: scoped, applied: false }
        : await this.chunkPolicy.applyRerank(
            options.rankingQuery ?? normalizedQuery,
            scoped,
            options.signal,
          );
    } catch (error) {
      this.metricsService.observeRetrievalStage(
        'rerank',
        'error',
        Number(process.hrtime.bigint() - rerankStartedAt) / 1e9,
      );
      throw error;
    }
    // 未启用或短路（未真正调用远端）时不记录耗时，避免污染 P95/P99
    if (rerankOutcome.applied) {
      this.metricsService.observeRetrievalStage(
        'rerank',
        'success',
        Number(process.hrtime.bigint() - rerankStartedAt) / 1e9,
      );
      this.metricsService.observeRetrievalRecalled(
        'rerank',
        'rerank',
        rerankOutcome.chunks.length,
      );
    }
    // cd：补充相关内容
    const ranked = rerankOutcome.chunks
      .slice(0, profile.candidateDepth)
      .map((chunk) => ({
        ...chunk,
        retrievalSource:
          chunk.bm25Score > 0 && chunk.cosineScore > 0
            ? ('hybrid' as const)
            : chunk.cosineScore > 0
              ? ('vector' as const)
              : ('bm25' as const),
        contextRole: 'hit' as const,
      }));
    const graphProbe = await graphProbePromise;
    const imageProbe = await imageProbePromise;
    const graphChunks = graphProbe.facts.map((fact, index) =>
      this.supplementalEvidenceRetriever.graphFactToChunk(fact, index),
    );
    const imageChunks = imageProbe.hits.map((hit, index) =>
      this.supplementalEvidenceRetriever.imageHitToChunk(hit, index),
    );
    const shouldMergeGraph = graphRequested;
    const shouldMergeImages = imageProbe.hits.length > 0;
    const expanded = this.chunkPolicy.expandContextChunks(
      ranked,
      profile,
      userId,
      options.scope,
      allowedDocIds ?? undefined,
    );
    const visibleGraphChunks = graphChunks.filter((chunk) =>
      this.chunkPolicy.isEvidenceDocumentVisible(
        chunk.docId,
        userId,
        allowedDocIds ?? undefined,
        options.scope,
      ),
    );
    const visibleImageChunks = imageChunks.filter((chunk) =>
      this.chunkPolicy.isEvidenceDocumentVisible(
        chunk.docId,
        userId,
        allowedDocIds ?? undefined,
        options.scope,
      ),
    );
    const built = this.contextBuilder.build(
      [
        ...(shouldMergeGraph ? visibleGraphChunks : []),
        ...(shouldMergeImages ? visibleImageChunks : []),
        ...expanded,
        ...(options.supplementalEvidence ?? []),
      ],
      profile,
      normalizedQuery,
    );
    const diagnostics: RetrievalDiagnostics = {
      intent: profile.intent,
      candidateDepth: profile.candidateDepth,
      expandedChunks: expanded.filter(
        (chunk) => chunk.retrievalSource === 'expansion',
      ).length,
      duplicateChunksRemoved: built.stats.duplicateChunksRemoved,
      documentLimitRemoved: built.stats.documentLimitRemoved,
      budgetRemoved: built.stats.budgetRemoved,
      contextCharacters: built.stats.contextCharacters,
      graphProbe: {
        ...graphProbe,
        merged: shouldMergeGraph && graphChunks.length > 0,
        elapsedMs: Date.now() - graphProbeStartedAt,
      },
      imageProbe: {
        ...imageProbe,
        merged: shouldMergeImages && imageChunks.length > 0,
      },
      stages: {
        keywordCandidates: bm25Hits.length,
        vectorCandidates: cosineHits.length,
        descriptionCandidates: descriptionCandidateCount,
        descriptionSourceChunks: descriptionSourceChunkCount,
        fusedCandidates: fusedCandidateCount,
        scopedCandidates: scoped.length,
        finalCandidates: built.chunks.length,
        filteredByScope: Math.max(0, fusedCandidateCount - scoped.length),
        filteredByBudget: built.stats.budgetRemoved,
      },
      candidates: {
        keyword: this.snapshotCandidates(bm25Hits),
        vector: this.snapshotCandidates(cosineHits),
        fused: this.snapshotCandidates(fused),
        rerankInput: this.snapshotCandidates(scoped),
        reranked: this.snapshotCandidates(ranked),
        context: this.snapshotCandidates(built.chunks),
      },
    };
    // cd：记录监控，那种检索问题，留下多少片段，有多少相邻片段，上下文多少字符
    this.metricsService.observeRetrievalContext(
      profile.intent,
      built.chunks.length,
      diagnostics.expandedChunks,
      diagnostics.contextCharacters,
    );
    return {
      chunks: built.chunks,
      diagnostics,
      profile,
      vectorSource,
      rerankApplied: rerankOutcome.applied,
    };
  }

  /**
   * 兼容旧的内部调用名。新链路直接传 executionPlan；缺少计划时只检索原问题，
   * 不再根据关键词或旧 QueryIntent 临时生成第二套查询策略。
   */
  async retrieveWithContextualQuery(
    query: string,
    options: RetrieveOptions,
    userId?: string,
  ): Promise<DetailedRetrievalResult> {
    const originalQuery = normalizeQuery(query);
    const profile =
      options.executionPlan?.profile ??
      options.profile ??
      retrievalProfileForTaskType(options.queryPlan?.taskType ?? 'lookup');
    const executionPlan =
      options.executionPlan ??
      ({
        planVersion: 2,
        sourcePolicy: 'local_only',
        queries: [{ text: originalQuery, kind: 'original', weight: 1 }],
        profile,
        useGraph: false,
        scope: options.scope,
        reasonCode: 'internal_evidence_required',
      } satisfies RetrievalExecutionPlan);
    return this.retrieveByPlan(
      executionPlan,
      { ...options, rankingQuery: originalQuery },
      userId,
    );
  }

  private snapshotCandidates(
    chunks: Array<{
      id: string;
      docId: string;
      chunkIndex: number;
      totalScore?: number;
      score?: number;
      rerankScore?: number;
      retrievalSource?: RetrievedChunk['retrievalSource'];
    }>,
  ): RetrievalCandidateSnapshot[] {
    return chunks.slice(0, 50).map((chunk) => ({
      id: chunk.id,
      docId: chunk.docId,
      chunkIndex: chunk.chunkIndex,
      score: Number((chunk.totalScore ?? chunk.score ?? 0).toFixed(6)),
      ...(chunk.rerankScore === undefined
        ? {}
        : { rerankScore: chunk.rerankScore }),
      ...(chunk.retrievalSource
        ? { retrievalSource: chunk.retrievalSource }
        : {}),
    }));
  }

  /**
   * 仅使用 BM25 检索。
   * 统一检索失败且没有候选时作为 BM25 降级，避免连续 Milvus search 阻塞。
   */
  async retrieveBm25Only(
    query: string,
    userId?: string,
    scope?: RetrievalScope,
    includeElasticsearch = true,
    tenantId?: string,
    roles: string[] = [],
    departmentIds: string[] = [],
    trustedAdminPrincipal = false,
  ): Promise<RetrievedChunk[]> {
    const normalizedQuery = normalizeQuery(query);
    const profile = retrievalProfileForTaskType('lookup');
    const allowedDocIds = userId
      ? await this.documentPermissionService.getAllowedDocIds(
          userId,
          roles,
          departmentIds,
          tenantId,
          trustedAdminPrincipal,
        )
      : null;
    const candidateDepth = allowedDocIds
      ? profile.candidateDepth * 3
      : profile.candidateDepth;
    const localBm25Hits = this.indexService.searchLocalBm25(
      normalizedQuery,
      userId,
      candidateDepth,
      allowedDocIds ?? undefined,
    );
    let bm25Hits = localBm25Hits;
    const bm25StartedAt = process.hrtime.bigint();
    try {
      if (includeElasticsearch && this.elasticsearchProvider.isEnabled()) {
        const esHits = await this.elasticsearchProvider.search(
          normalizedQuery,
          candidateDepth,
          userId,
          scope,
          allowedDocIds ?? undefined,
        );
        bm25Hits = this.chunkPolicy.mergeRankedHits(
          esHits,
          localBm25Hits,
          candidateDepth,
        );
      }
      this.metricsService.observeRetrievalStage(
        'bm25',
        'success',
        Number(process.hrtime.bigint() - bm25StartedAt) / 1e9,
      );
    } catch (error) {
      this.metricsService.observeRetrievalStage(
        'bm25',
        'error',
        Number(process.hrtime.bigint() - bm25StartedAt) / 1e9,
      );
      throw error;
    }

    const bm25OnlySource = this.elasticsearchProvider.isEnabled()
      ? 'elasticsearch'
      : 'bm25';
    this.metricsService.observeRetrievalHits(
      bm25OnlySource,
      'keyword',
      bm25Hits.length,
    );
    this.metricsService.observeRetrievalRecalled(
      'bm25',
      bm25OnlySource,
      bm25Hits.length,
    );

    const permittedBm25Hits = bm25Hits.filter(
      (hit) => !allowedDocIds || allowedDocIds.has(hit.docId),
    );
    const bm25MaxScore = Math.max(...permittedBm25Hits.map((h) => h.score), 1);
    return permittedBm25Hits
      .map((hit, index) => {
        const normalizedBm25 = hit.score / bm25MaxScore;
        return {
          id: hit.id,
          content: hit.content,
          docId: hit.docId,
          chunkIndex: hit.chunkIndex,
          ...this.chunkPolicy.pickChunkMetadata(hit),
          bm25Score: normalizedBm25,
          cosineScore: 0,
          totalScore: this.chunkPolicy.rankScore(index) * this.bm25Weight,
        } satisfies RetrievedChunk;
      })
      .map((chunk) => this.chunkPolicy.applySourceAuthorityToChunk(chunk))
      .sort((a, b) => b.totalScore - a.totalScore)
      .filter((chunk) => this.chunkPolicy.isLifecycleVisible(chunk, scope))
      .filter((chunk) => this.chunkPolicy.matchesScope(chunk, scope))
      .slice(0, profile.finalTopK);
  }

  /**
   * 固定线性问答链：可选精确直答后并发取正式 RAG、已审核纠错和 Obsidian 证据，
   * 再经过充分性判断、上下文构建、受证据约束的生成与引用校验。
   * @param history 多轮对话历史（按时间顺序）
   */

  normalizeQuery(query: string): string {
    return this.chunkPolicy.normalizeQuery(query);
  }

  pickChunkMetadata(chunk: Partial<RetrievedChunk>) {
    return this.chunkPolicy.pickChunkMetadata(chunk);
  }

  applySourceAuthorityToChunk(chunk: RetrievedChunk): RetrievedChunk {
    return this.chunkPolicy.applySourceAuthorityToChunk(chunk);
  }

  matchesScope(
    chunk: Partial<RetrievedChunk>,
    scope: RetrievalScope = {},
  ): boolean {
    return this.chunkPolicy.matchesScope(chunk, scope);
  }

  isLifecycleVisible(
    chunk: Partial<RetrievedChunk>,
    scope?: RetrievalScope,
  ): boolean {
    return this.chunkPolicy.isLifecycleVisible(chunk, scope);
  }

  rankScore(index: number): number {
    return this.chunkPolicy.rankScore(index);
  }
}
