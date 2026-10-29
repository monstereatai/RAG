import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmbeddingProvider } from '../../providers/embedding/embedding.provider';
import type { VectorStoreProvider } from '../../providers/vector-store/vector-store.provider';
import type { ElasticsearchProvider } from '../../providers/elasticsearch/elasticsearch.provider';
import type { MetricsService } from '../../modules/metrics/metrics.service';
import type { DingTalkProvider } from '../../providers/notify/dingtalk.provider';
import type { DocumentRetrievalDescriptionService } from '../../modules/document/document-retrieval-description.service';
import type {
  RetrievalScope,
  RagVectorSource,
} from '../evidence/retrieval.types';
import {
  RetrievalPostprocessor,
  type IndexedChunk,
  type RankedRetrievalHit,
} from './retrieval-postprocessor';

type VectorHits = Awaited<ReturnType<VectorStoreProvider['similaritySearch']>>;
type DescriptionHits = Awaited<
  ReturnType<DocumentRetrievalDescriptionService['searchByVector']>
>;

export interface SourceRecallRequest {
  normalizedQuery: string;
  candidateDepth: number;
  vectorSearch: boolean;
  userId?: string;
  tenantId?: string;
  scope?: RetrievalScope;
  allowedDocIds: Set<string> | null;
  localBm25Hits: RankedRetrievalHit[];
  chunkMeta: ReadonlyMap<string, Omit<IndexedChunk, 'id'>>;
  resolveDescriptionHits: (
    hits: DescriptionHits,
    query: string,
    allowedDocIds: Set<string> | null,
    userId?: string,
    scope?: RetrievalScope,
  ) => VectorHits;
}

/** Provider recall only: authoritative ACLs and source-index snapshots come from the caller. */
export class RetrievalSources {
  private readonly logger = new Logger('RagService');
  constructor(
    private readonly configService: ConfigService,
    private readonly embeddingProvider: Pick<EmbeddingProvider, 'embedQuery'>,
    private readonly vectorStoreProvider: Pick<
      VectorStoreProvider,
      'similaritySearch' | 'getRuntimeStatus'
    >,
    private readonly elasticsearchProvider: Pick<
      ElasticsearchProvider,
      'isEnabled' | 'search' | 'knnSearch'
    >,
    private readonly metricsService: Pick<
      MetricsService,
      | 'observeRetrievalStage'
      | 'observeRetrievalHits'
      | 'observeRetrievalRecalled'
    >,
    private readonly postprocessor: RetrievalPostprocessor,
    private readonly retrievalDescriptionService?: Pick<
      DocumentRetrievalDescriptionService,
      'searchByVector'
    >,
    private readonly dingTalk?: Pick<DingTalkProvider, 'notifyAlert'>,
  ) {}

  async recall(input: SourceRecallRequest) {
    const {
      normalizedQuery,
      candidateDepth,
      vectorSearch,
      userId,
      tenantId,
      scope,
      allowedDocIds,
      localBm25Hits,
      chunkMeta,
      resolveDescriptionHits,
    } = input;
    let bm25Hits = localBm25Hits;
    const bm25StartedAt = process.hrtime.bigint();
    try {
      if (this.elasticsearchProvider.isEnabled()) {
        const esHits = await this.elasticsearchProvider.search(
          normalizedQuery,
          candidateDepth,
          userId,
          scope,
          allowedDocIds ?? undefined,
        );
        bm25Hits = this.postprocessor.mergeRankedHits(
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
    const bm25Source = this.elasticsearchProvider.isEnabled()
      ? 'elasticsearch'
      : 'bm25';
    this.metricsService.observeRetrievalHits(
      bm25Source,
      vectorSearch ? 'hybrid' : 'keyword',
      bm25Hits.length,
    );
    this.metricsService.observeRetrievalRecalled(
      'bm25',
      bm25Source,
      bm25Hits.length,
    );

    // 2. 向量检索：Milvus 为主通道；RAG_ES_KNN_MODE 控制 ES kNN 降级（fallback）/并行（always）通道
    const esKnnMode = this.resolveEsKnnMode();
    const esKnnReady =
      esKnnMode !== 'off' && this.elasticsearchProvider.isEnabled();
    let cosineHits: Awaited<
      ReturnType<VectorStoreProvider['similaritySearch']>
    > = [];
    let descriptionCandidateCount = 0;
    let descriptionSourceChunkCount = 0;
    let descriptionUsed = false;
    let vectorSource: RagVectorSource = 'none';
    if (vectorSearch) {
      let milvusUsed = false;
      let queryVector: number[] | null = null;
      let vectorFailed = false;
      const vectorStartedAt = process.hrtime.bigint();
      try {
        queryVector = await this.embeddingProvider.embedQuery(normalizedQuery);
        const skipMilvus =
          esKnnMode === 'fallback' &&
          esKnnReady &&
          !this.isMilvusRuntimeAvailable();
        if (skipMilvus) {
          // fallback 模式下 Milvus 运行时不可用：直接走 ES kNN，不浪费一次必然失败的调用
          this.logger.warn(
            'Milvus runtime unavailable, switching vector channel to ES kNN (RAG_ES_KNN_MODE=fallback)',
          );
        } else {
          // cd：向量查询
          cosineHits = await this.vectorStoreProvider.similaritySearch(
            queryVector,
            candidateDepth,
            userId,
            allowedDocIds ?? undefined,
          );
          cosineHits = this.postprocessor.filterActiveVectorHits(
            chunkMeta,
            cosineHits,
            userId,
            allowedDocIds ?? undefined,
            scope,
          );
          milvusUsed = true;
        }
      } catch (err) {
        vectorFailed = true;
        this.logger.warn(
          `Vector search failed, fallback to BM25 only: ${
            (err as Error).message
          }`,
        );
        // 钉钉告警（fire-and-forget，节流窗口内同 key 只发一次）
        void this.dingTalk?.notifyAlert(
          'retrieval.bm25_fallback',
          `**向量检索失败，已降级 BM25**\n\n错误：${(err as Error).message.slice(0, 300)}`,
        );
      }
      // fallback：Milvus 失败/不可用时补 ES kNN；always：Milvus 正常也并行拉 ES kNN
      if (
        queryVector &&
        esKnnReady &&
        (!milvusUsed || esKnnMode === 'always')
      ) {
        try {
          const knnHits = await this.esKnnVectorHits(
            chunkMeta,
            queryVector,
            candidateDepth,
            userId,
            scope,
            allowedDocIds ?? undefined,
          );
          if (knnHits.length > 0) {
            // always 模式：两路向量候选按 chunk id 去重合并进 cosine 池再进 fuseByRrf
            const seenIds = new Set(cosineHits.map((hit) => hit.id));
            cosineHits = [
              ...cosineHits,
              ...knnHits.filter((hit) => !seenIds.has(hit.id)),
            ];
          }
        } catch (err) {
          this.logger.warn(
            `ES kNN vector search failed: ${(err as Error).message}`,
          );
        }
      }
      // 2. 查找引用片段
      if (queryVector && this.retrievalDescriptionService) {
        try {
          const descriptionHits =
            await this.retrievalDescriptionService.searchByVector(queryVector, {
              tenantId: tenantId ?? 'legacy',
              topK: candidateDepth,
            });
          descriptionCandidateCount = descriptionHits.length;
          descriptionUsed = descriptionHits.length > 0;
          const sourceHits = resolveDescriptionHits(
            descriptionHits,
            normalizedQuery,
            allowedDocIds,
            userId,
            scope,
          );
          descriptionSourceChunkCount = sourceHits.length;
          cosineHits = this.postprocessor.mergeVectorCandidates(
            cosineHits,
            sourceHits,
            candidateDepth,
          );
        } catch (err) {
          // 描述索引是补充召回通道；它故障时仍保留原文向量与 BM25 检索。
          this.logger.warn(
            `Retrieval description search failed; keeping raw retrieval channels: ${(err as Error).message}`,
          );
        }
      }
      vectorSource =
        milvusUsed || descriptionUsed
          ? 'milvus'
          : queryVector && esKnnReady
            ? 'elasticsearch'
            : 'none';
      this.metricsService.observeRetrievalStage(
        'vector_search',
        vectorFailed ? 'error' : 'success',
        Number(process.hrtime.bigint() - vectorStartedAt) / 1e9,
      );
    }
    this.metricsService.observeRetrievalHits(
      'milvus',
      vectorSearch ? 'hybrid' : 'keyword',
      cosineHits.length,
    );
    if (vectorSearch) {
      this.metricsService.observeRetrievalRecalled(
        'vector_search',
        vectorSource,
        cosineHits.length,
      );
    }

    return {
      bm25Hits,
      cosineHits,
      vectorSource,
      descriptionCandidateCount,
      descriptionSourceChunkCount,
      descriptionUsed,
    };
  }

  private resolveEsKnnMode(): 'off' | 'fallback' | 'always' {
    const raw = (
      this.configService.get<string>('RAG_ES_KNN_MODE') ?? 'fallback'
    )
      .trim()
      .toLowerCase();
    return raw === 'off' || raw === 'always' ? raw : 'fallback';
  }

  private isMilvusRuntimeAvailable(): boolean {
    try {
      return this.vectorStoreProvider.getRuntimeStatus().available;
    } catch {
      return true;
    }
  }

  private async esKnnVectorHits(
    chunkMeta: ReadonlyMap<string, Omit<IndexedChunk, 'id'>>,
    queryVector: number[],
    candidateDepth: number,
    userId?: string,
    scope?: RetrievalScope,
    allowedDocIds?: ReadonlySet<string>,
  ): Promise<Awaited<ReturnType<VectorStoreProvider['similaritySearch']>>> {
    const knnHits = await this.elasticsearchProvider.knnSearch(
      queryVector,
      candidateDepth,
      userId,
      {
        includeDeprecated: scope?.includeDeprecated,
        ...(scope?.effectiveTime ? { effectiveTime: scope.effectiveTime } : {}),
        allowedDocIds,
      },
    );
    return knnHits.flatMap((hit) => {
      const meta = chunkMeta.get(hit.id);
      if (meta == null) return [];
      if (allowedDocIds != null) {
        if (allowedDocIds.has(meta.docId) === false) return [];
      } else if (userId != null && meta.userId !== userId) {
        return [];
      }
      return [
        {
          id: hit.id,
          content: meta.content,
          docId: meta.docId,
          chunkIndex: meta.chunkIndex,
          score: hit.score,
        },
      ];
    });
  }
}
