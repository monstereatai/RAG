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
  ) => VectorHits | Promise<VectorHits>;
  verifyLegacyVectorHits?: (hits: VectorHits) => Promise<VectorHits>;
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
      verifyLegacyVectorHits,
    } = input;
    const queryVectorAttempt = vectorSearch
      ? this.embeddingProvider.embedQuery(normalizedQuery).then(
          (vector) => ({ vector, error: null as unknown }),
          (error: unknown) => ({ vector: null as number[] | null, error }),
        )
      : null;
    let bm25Hits = localBm25Hits;
    let keywordFailed = false;
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
        bm25Hits = esHits;
      }
      this.metricsService.observeRetrievalStage(
        'bm25',
        'success',
        Number(process.hrtime.bigint() - bm25StartedAt) / 1e9,
      );
    } catch (error) {
      keywordFailed = true;
      this.metricsService.observeRetrievalStage(
        'bm25',
        'error',
        Number(process.hrtime.bigint() - bm25StartedAt) / 1e9,
      );
      this.logger.warn(
        `Elasticsearch keyword search failed; using local BM25 migration fallback: ${(error as Error).message}`,
      );
    }
    const bm25Source = this.elasticsearchProvider.isEnabled() && !keywordFailed
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

    // 主文档向量召回统一走 Elasticsearch；Milvus 仅兼容 ES 不可用时的旧索引。
    const esKnnReady = this.elasticsearchProvider.isEnabled();
    let cosineHits: Awaited<
      ReturnType<VectorStoreProvider['similaritySearch']>
    > = [];
    let descriptionCandidateCount = 0;
    let descriptionSourceChunkCount = 0;
    let descriptionUsed = false;
    let vectorSource: RagVectorSource = 'none';
    let vectorFailed = false;
    if (vectorSearch) {
      let milvusUsed = false;
      let queryVector: number[] | null = null;
      const vectorStartedAt = process.hrtime.bigint();
      try {
        const embedded = await queryVectorAttempt;
        if (!embedded) throw new Error('embedding not scheduled');
        if (embedded.error) throw embedded.error;
        queryVector = embedded.vector;
        if (esKnnReady) {
          cosineHits = await this.esKnnVectorHits(
            queryVector,
            candidateDepth,
            userId,
            scope,
            allowedDocIds ?? undefined,
          );
        } else {
          // 迁移期兼容：ES 不可用时才读取既有 Milvus 主 chunk 集合。
          cosineHits = await this.vectorStoreProvider.similaritySearch(
            queryVector,
            candidateDepth,
            userId,
            allowedDocIds ?? undefined,
          );
          cosineHits = verifyLegacyVectorHits
            ? await verifyLegacyVectorHits(cosineHits)
            : this.postprocessor.filterActiveVectorHits(
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
          const sourceHits = await resolveDescriptionHits(
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
      vectorSource = milvusUsed
        ? 'milvus'
        : queryVector && esKnnReady && !vectorFailed
          ? 'elasticsearch'
          : descriptionSourceChunkCount > 0
            ? 'milvus'
            : 'none';
      this.metricsService.observeRetrievalStage(
        'vector_search',
        vectorFailed ? 'error' : 'success',
        Number(process.hrtime.bigint() - vectorStartedAt) / 1e9,
      );
    }
    this.metricsService.observeRetrievalHits(
      vectorSource === 'none' ? 'elasticsearch' : vectorSource,
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

    if (keywordFailed && (!vectorSearch || vectorFailed) && cosineHits.length === 0 && bm25Hits.length === 0) {
      throw new Error('All available retrieval channels failed; refusing to report a false empty result');
    }
    return {
      bm25Hits,
      cosineHits,
      vectorSource,
      descriptionCandidateCount,
      descriptionSourceChunkCount,
      descriptionUsed,
      keywordFailed,
      vectorFailed,
    };
  }

  private async esKnnVectorHits(
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
        scope,
        allowedDocIds,
      },
    );
    return knnHits.map((hit) => ({
      id: hit.id,
      content: hit.content,
      docId: hit.docId,
      chunkIndex: hit.chunkIndex,
      score: hit.score,
    }));
  }
}
