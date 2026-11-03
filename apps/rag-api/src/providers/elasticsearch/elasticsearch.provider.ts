import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, estypes } from '@elastic/elasticsearch';
import { ElasticsearchDocumentSupport } from './elasticsearch.document-support';
import {
  effectiveTimeFilters,
  type EffectiveTimeRange,
  type ElasticsearchSearchScope,
} from './elasticsearch.provider.types';
export type { ElasticsearchSearchScope } from './elasticsearch.provider.types';

type IndexedChunk = {
  content: string;
  hypotheticalQuestions?: string[];
  docId: string;
  chunkIndex: number;
  parentChunkId?: string | null;
  headingPath?: string[];
  sectionId?: string | null;
  clauseId?: string | null;
  tableRef?: string | null;
  sourceStart?: number | null;
  sourceEnd?: number | null;
  parentContent?: string | null;
  sourceMetadata?: string | null;
  docVersion?: string | null;
  effectiveAt?: string | null;
  expiredAt?: string | null;
  sourceAuthority?: string;
  projectId?: string | null;
  activityId?: string | null;
  region?: string | null;
  locale?: string | null;
  channel?: string | null;
  roleScope?: string[];
  documentType?: string;
  lifecycleStatus?: string;
  supersedesDocId?: string | null;
};

const BUSINESS_PROPERTIES = {
  projectId: { type: 'keyword' },
  activityId: { type: 'keyword' },
  region: { type: 'keyword' },
  locale: { type: 'keyword' },
  channel: { type: 'keyword' },
  roleScope: { type: 'keyword' },
  documentType: { type: 'keyword' },
  lifecycleStatus: { type: 'keyword' },
  supersedesDocId: { type: 'keyword' },
} satisfies Record<string, estypes.MappingProperty>;

const ES_CHUNK_BULK_BATCH_SIZE = 100;
const ES_CHUNK_BULK_TIMEOUT_MS = 30_000;

/**
 * Elasticsearch Provider
 *
 * 提供能力：
 * - 文档上传时同步写入 ES（IK 分词，中文全文检索）
 * - BM25 检索（作为内存 BM25 的生产替代方案）
 * - 文档删除时同步从 ES 删除
 *
 * 未配置 ES_NODE 或连接失败时，自动禁用，不阻断服务启动。
 */
@Injectable()
export class ElasticsearchProvider
  extends ElasticsearchDocumentSupport
  implements OnModuleInit
{
  protected readonly logger = new Logger(ElasticsearchProvider.name);
  protected client!: Client;
  protected enabled = false;
  private readonly indexName = 'rag_chunks';
  protected readonly documentIndexName = 'kh_document';
  /** dense_vector 维度：必须与嵌入模型输出维度一致（RAG_ES_EMBEDDING_DIM，默认 1024） */
  private readonly embeddingDim: number;

  constructor(private readonly config: ConfigService) {
    super();
    const rawDim = this.config.get<string | number>('RAG_ES_EMBEDDING_DIM');
    const parsedDim =
      typeof rawDim === 'string' ? Number.parseInt(rawDim, 10) : rawDim;
    this.embeddingDim =
      typeof parsedDim === 'number' &&
      Number.isFinite(parsedDim) &&
      parsedDim > 0
        ? parsedDim
        : 1024;
  }

  async onModuleInit(): Promise<void> {
    const node = this.config.get<string>('elasticsearch.node') ?? '';
    if (!node || node === 'http://localhost:9200') {
      // 默认地址时检查是否真实可连
    }

    try {
      this.client = new Client({
        node: node || 'http://localhost:9200',
        requestTimeout: 5000,
      });
      await this.client.ping();
      this.enabled = true;
      this.logger.log(`Elasticsearch connected at ${node}`);
      await this.ensureIndex();
      await this.ensureDocumentIndex();
    } catch (err) {
      this.logger.warn(
        `Elasticsearch not available (${(err as Error).message}), ES search disabled`,
      );
      this.enabled = false;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * rag_chunks 的 dense_vector 向量字段定义（单 ES 混合检索的 kNN 向量通道）
   */
  private embeddingMappingProperty(): estypes.MappingProperty {
    return {
      type: 'dense_vector',
      dims: this.embeddingDim,
      index: true,
      similarity: 'cosine',
    };
  }

  /**
   * 确保 rag_chunks 索引存在（含中文分词配置）
   */
  private async ensureIndex(): Promise<void> {
    const exists = await this.client.indices.exists({ index: this.indexName });
    if (exists) {
      this.logger.log(
        `ES index "${this.indexName}" already exists, checking mapping...`,
      );
      try {
        const mapping = await this.client.indices.getMapping({
          index: this.indexName,
        });
        const indexMapping = mapping[this.indexName];

        const properties = indexMapping?.mappings?.properties as
          | Record<string, unknown>
          | undefined;
        if (properties && (!properties.userId || !properties.sourceAuthority)) {
          this.logger.error(
            `ES mapping outdated for "${this.indexName}"; refusing automatic deletion. Create a new versioned index and reindex before switching traffic.`,
          );
          return;
        } else {
          // 幂等补字段：为存量索引补齐业务元数据与 dense_vector embedding 字段
          // ES 支持给现有索引新增字段；失败仅告警，不阻塞启动，也绝不删除存量索引
          const patch: Record<string, estypes.MappingProperty> = {};
          if (!properties?.projectId) {
            Object.assign(patch, BUSINESS_PROPERTIES);
          }
          if (!properties?.embedding) {
            patch.embedding = this.embeddingMappingProperty();
          }
          if (!properties?.hypotheticalQuestions) {
            patch.hypotheticalQuestions = {
              type: 'text',
              analyzer: 'ik_smart_analyzer',
            };
          }
          if (!properties?.contentHash) patch.contentHash = { type: 'keyword' };
          if (!properties?.indexGeneration)
            patch.indexGeneration = { type: 'keyword' };
          if (!properties?.tenantId) patch.tenantId = { type: 'keyword' };
          if (!properties?.parentContent)
            patch.parentContent = { type: 'text', index: false };
          if (!properties?.sourceMetadata)
            patch.sourceMetadata = { type: 'text', index: false };
          if (Object.keys(patch).length > 0) {
            try {
              await this.client.indices.putMapping({
                index: this.indexName,
                properties: patch,
              });
              this.logger.log(
                `ES mapping patched for "${this.indexName}": added ${Object.keys(patch).join(', ')}`,
              );
            } catch (patchErr) {
              this.logger.warn(
                `ES putMapping (fields: ${Object.keys(patch).join(', ')}) failed, kNN channel unavailable until patched, startup continues: ${(patchErr as Error).message}`,
              );
            }
          } else {
            const existingDims = (
              properties?.embedding as { dims?: number } | undefined
            )?.dims;
            if (
              existingDims !== undefined &&
              existingDims !== this.embeddingDim
            ) {
              this.logger.warn(
                `ES index "${this.indexName}" embedding dims=${existingDims} != RAG_ES_EMBEDDING_DIM=${this.embeddingDim}, kNN 检索将不可用；请统一配置或重建索引`,
              );
            }
          }
          return;
        }
      } catch (err) {
        this.logger.warn(
          `Failed to inspect ES index: ${(err as Error).message}. Existing data is preserved; manual reindex is required.`,
        );
        return;
      }
    }

    await this.client.indices.create({
      index: this.indexName,
      settings: {
        analysis: {
          analyzer: {
            ik_smart_analyzer: {
              type: 'custom',
              tokenizer: 'ik_smart',
            },
          },
        },
      },
      mappings: {
        properties: {
          docId: { type: 'keyword' },
          chunkIndex: { type: 'integer' },
          content: {
            type: 'text',
            analyzer: 'ik_smart_analyzer',
          },
          hypotheticalQuestions: {
            type: 'text',
            analyzer: 'ik_smart_analyzer',
          },
          userId: { type: 'keyword' },
          parentChunkId: { type: 'keyword' },
          headingPath: { type: 'keyword' },
          sectionId: { type: 'keyword' },
          clauseId: { type: 'keyword' },
          tableRef: { type: 'keyword' },
          sourceStart: { type: 'integer' },
          sourceEnd: { type: 'integer' },
          parentContent: { type: 'text', index: false },
          sourceMetadata: { type: 'text', index: false },
          docVersion: { type: 'keyword' },
          contentHash: { type: 'keyword' },
          indexGeneration: { type: 'keyword' },
          ruleKey: { type: 'keyword' },
          changeType: { type: 'keyword' },
          supersedesChunkId: { type: 'keyword' },
          tenantId: { type: 'keyword' },
          effectiveAt: { type: 'date' },
          expiredAt: { type: 'date' },
          sourceAuthority: { type: 'keyword' },
          ...BUSINESS_PROPERTIES,
          // dense_vector：kNN 向量通道，维度需与嵌入模型一致（写入时可缺省）
          embedding: this.embeddingMappingProperty(),
          createdAt: { type: 'date' },
        },
      },
    });
    this.logger.log(`ES index "${this.indexName}" created`);
  }

  /**
   * 批量写入 chunks 到 ES
   *
   * @param vectors 可选，与 chunks 一一对应的嵌入向量（null/缺省表示该块无向量）；
   *                有向量的块会把 embedding 写进 ES 文档（kNN 通道），没有的正常写
   */
  async indexChunks(
    chunks: Array<{
      id: string;
      content: string;
      docId: string;
      chunkIndex: number;
      userId?: string;
      tenantId?: string;
      parentChunkId?: string | null;
      headingPath?: string[];
      sectionId?: string | null;
      clauseId?: string | null;
      tableRef?: string | null;
      sourceStart?: number | null;
      sourceEnd?: number | null;
      sourceMetadata?: string | null;
      docVersion?: string | null;
      contentHash?: string | null;
      indexGeneration?: string | null;
      ruleKey?: string | null;
      changeType?: string;
      supersedesChunkId?: string | null;
      effectiveAt?: Date | null;
      expiredAt?: Date | null;
      sourceAuthority?: string;
      projectId?: string | null;
      activityId?: string | null;
      region?: string | null;
      locale?: string | null;
      channel?: string | null;
      roleScope?: string[];
      documentType?: string;
      lifecycleStatus?: string;
      supersedesDocId?: string | null;
      hypotheticalQuestions?: string[];
      highlightFragments?: string[];
    }>,
    userId?: string,
    vectors?: Array<number[] | null>,
  ): Promise<void> {
    if (!this.enabled || chunks.length === 0) return;

    try {
      let dimMismatchWarned = false;
      for (
        let start = 0;
        start < chunks.length;
        start += ES_CHUNK_BULK_BATCH_SIZE
      ) {
        const batch = chunks.slice(start, start + ES_CHUNK_BULK_BATCH_SIZE);
        const operations = batch.flatMap((c, batchIndex) => {
          const rawVector = vectors?.[start + batchIndex] ?? null;
          const usableVector =
            rawVector && rawVector.length === this.embeddingDim
              ? rawVector
              : null;
          if (rawVector && !usableVector && !dimMismatchWarned) {
            dimMismatchWarned = true;
            this.logger.warn(
              `ES indexChunks: embedding dims mismatch (vector=${rawVector.length}, configured=${this.embeddingDim}), skip embedding for docId=${c.docId}`,
            );
          }
          return [
            { index: { _index: this.indexName, _id: c.id } },
            {
              docId: c.docId,
              chunkIndex: c.chunkIndex,
              content: c.content,
              hypotheticalQuestions: c.hypotheticalQuestions ?? [],
              userId: c.userId || userId,
              tenantId: c.tenantId,
              parentChunkId: c.parentChunkId,
              headingPath: c.headingPath,
              sectionId: c.sectionId,
              clauseId: c.clauseId,
              tableRef: c.tableRef,
              sourceStart: c.sourceStart,
              sourceEnd: c.sourceEnd,
              sourceMetadata: c.sourceMetadata,
              docVersion: c.docVersion,
              contentHash: c.contentHash,
              indexGeneration: c.indexGeneration,
              ruleKey: c.ruleKey,
              changeType: c.changeType,
              supersedesChunkId: c.supersedesChunkId,
              effectiveAt: c.effectiveAt?.toISOString() ?? null,
              expiredAt: c.expiredAt?.toISOString() ?? null,
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
              // 有向量写向量（kNN 检索通道）；无向量/维度不符时缺省，不影响关键词字段写入
              ...(usableVector ? { embedding: usableVector } : {}),
              createdAt: new Date().toISOString(),
            },
          ];
        });

        const result = await this.client.bulk(
          { operations, refresh: false },
          { requestTimeout: ES_CHUNK_BULK_TIMEOUT_MS },
        );
        if (result.errors) {
          this.logger.warn(
            `ES bulk index had errors for docId=${batch[0]?.docId}`,
          );
          throw new Error(
            `ES bulk index failed for docId=${batch[0]?.docId}: one or more items failed`,
          );
        }
      }
      await this.client.indices.refresh(
        { index: this.indexName },
        { requestTimeout: ES_CHUNK_BULK_TIMEOUT_MS },
      );
      this.logger.log(
        `ES indexed ${chunks.length} chunks for docId=${chunks[0]?.docId}`,
      );
    } catch (err) {
      this.logger.warn(`ES indexChunks failed: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * 按 docId 删除所有 chunks
   */
  async deleteByDocId(docId: string, _userId?: string): Promise<void> {
    if (!this.enabled) return;
    try {
      const filter: estypes.QueryDslQueryContainer[] = [{ term: { docId } }];
      if (_userId) filter.push({ term: { userId: _userId } });
      await this.client.deleteByQuery(
        {
          index: this.indexName,
          query: { bool: { filter } },
        },
        { requestTimeout: ES_CHUNK_BULK_TIMEOUT_MS },
      );
      if (_userId) {
        await this.client
          .deleteByQuery(
            {
              index: this.documentIndexName,
              query: {
                bool: {
                  filter: [{ term: { docId } }, { term: { userId: _userId } }],
                },
              },
              refresh: true,
            },
            { requestTimeout: ES_CHUNK_BULK_TIMEOUT_MS },
          )
          .catch(() => undefined);
      } else {
        await this.client
          .delete(
            { index: this.documentIndexName, id: docId, refresh: true },
            { requestTimeout: ES_CHUNK_BULK_TIMEOUT_MS },
          )
          .catch(() => undefined);
      }
      this.logger.log(
        `ES deleted chunks for docId=${docId} and userId=${_userId ?? 'none'}`,
      );
    } catch (err) {
      this.logger.warn(`ES deleteByDocId failed: ${(err as Error).message}`);
    }
  }

  /**
   * 按 chunk id 精确删除 ES chunks，用于 chunk 级增量更新。
   */
  async deleteChunksByIds(ids: string[]): Promise<void> {
    if (this.enabled === false) return;
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) return;
    try {
      await this.client.bulk({
        operations: uniqueIds.map((id) => ({
          delete: { _index: this.indexName, _id: id },
        })),
        refresh: true,
      });
      this.logger.log(`ES deleted ${uniqueIds.length} chunks by id`);
    } catch (err) {
      this.logger.warn(
        `ES deleteChunksByIds failed: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  /**
   * 仅更新未变化 chunk 的元数据，不重写 content 和 embedding。
   */
  async updateChunkMetadataByIds(
    ids: string[],
    patch: Record<string, unknown>,
  ): Promise<void> {
    if (this.enabled === false) return;
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) return;
    try {
      const result = await this.client.bulk({
        operations: uniqueIds.flatMap((id) => [
          { update: { _index: this.indexName, _id: id } },
          { doc: { ...patch, updatedAt: new Date().toISOString() } },
        ]),
        refresh: true,
      });
      if (result.errors) {
        throw new Error(
          `ES metadata update failed for ${uniqueIds.length} chunks: one or more items failed`,
        );
      }
      this.logger.log(`ES updated metadata for ${uniqueIds.length} chunks`);
    } catch (err) {
      this.logger.warn(
        `ES updateChunkMetadataByIds failed: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  /**
   * 返回文档分块索引和文档索引的对账结果。
   * 该方法不经过检索门禁，避免 draft／archived 文档被误判为缺索引。
   */
  async getIndexCountsByDocId(
    docId: string,
    userId?: string,
  ): Promise<{
    available: boolean;
    chunkCount: number;
    documentCount: number;
    contentHashes?: string[];
    indexGenerations?: string[];
    lifecycleStatusAvailable?: boolean;
    chunkLifecycleStatuses?: string[];
    documentLifecycleStatuses?: string[];
    lifecycleStatusReason?: string;
    reason?: string;
  }> {
    if (!this.enabled) {
      return {
        available: false,
        chunkCount: 0,
        documentCount: 0,
        contentHashes: [],
        indexGenerations: [],
        reason: 'elasticsearch_disabled',
      };
    }
    const filter: estypes.QueryDslQueryContainer[] = [{ term: { docId } }];
    if (userId) filter.push({ term: { userId } });
    const query: estypes.QueryDslQueryContainer = { bool: { filter } };
    try {
      const [chunks, documents, metadata] = await Promise.all([
        this.client.count({ index: this.indexName, query }),
        this.client.count({ index: this.documentIndexName, query }),
        this.client.search({
          index: this.indexName,
          query,
          size: 0,
          aggs: {
            contentHashes: { terms: { field: 'contentHash', size: 10000 } },
            indexGenerations: {
              terms: { field: 'indexGeneration', size: 100 },
            },
          },
        }),
      ]);
      const aggregations = metadata.aggregations as
        | {
            contentHashes?: { buckets?: Array<{ key: string }> };
            indexGenerations?: { buckets?: Array<{ key: string }> };
          }
        | undefined;
      let lifecycleStatusAvailable = false;
      let chunkLifecycleStatuses: string[] = [];
      let documentLifecycleStatuses: string[] = [];
      let lifecycleStatusReason: string | undefined;
      try {
        const [chunkLifecycle, documentLifecycle] = await Promise.all([
          this.client.search({
            index: this.indexName,
            query,
            size: 0,
            aggs: {
              lifecycleStatuses: {
                terms: { field: 'lifecycleStatus', size: 20 },
              },
            },
          }),
          this.client.search({
            index: this.documentIndexName,
            query,
            size: 0,
            aggs: {
              lifecycleStatuses: {
                terms: { field: 'lifecycleStatus', size: 20 },
              },
            },
          }),
        ]);
        const readStatuses = (result: typeof chunkLifecycle): string[] => {
          const aggs = result.aggregations as
            | { lifecycleStatuses?: { buckets?: Array<{ key: string }> } }
            | undefined;
          return (
            aggs?.lifecycleStatuses?.buckets?.map((bucket) => bucket.key) ?? []
          );
        };
        chunkLifecycleStatuses = readStatuses(chunkLifecycle);
        documentLifecycleStatuses = readStatuses(documentLifecycle);
        lifecycleStatusAvailable = true;
      } catch (err) {
        lifecycleStatusReason = `elasticsearch_lifecycle_audit_failed:${(err as Error).message}`;
      }

      return {
        available: true,
        chunkCount: chunks.count,
        documentCount: documents.count,
        contentHashes:
          aggregations?.contentHashes?.buckets?.map((bucket) => bucket.key) ??
          [],
        indexGenerations:
          aggregations?.indexGenerations?.buckets?.map(
            (bucket) => bucket.key,
          ) ?? [],
        lifecycleStatusAvailable,
        chunkLifecycleStatuses,
        documentLifecycleStatuses,
        ...(lifecycleStatusReason ? { lifecycleStatusReason } : {}),
      };
    } catch (err) {
      return {
        available: false,
        chunkCount: 0,
        documentCount: 0,
        reason: `elasticsearch_count_failed:${(err as Error).message}`,
      };
    }
  }

  async updateDocumentLifecycle(
    docId: string,
    lifecycleStatus: string,
    userId?: string,
  ): Promise<void> {
    if (!this.enabled) return;
    const filter: estypes.QueryDslQueryContainer[] = [{ term: { docId } }];
    if (userId) filter.push({ term: { userId } });
    try {
      const chunks = await this.client.updateByQuery({
        index: this.indexName,
        query: { bool: { filter } },
        script: {
          source: 'ctx._source.lifecycleStatus = params.status',
          params: { status: lifecycleStatus },
        },
        refresh: true,
      });
      const chunkFailureCount = chunks.failures?.length ?? 0;
      if (chunks.timed_out || chunkFailureCount > 0) {
        throw new Error(
          `ES chunk lifecycle update incomplete: timedOut=${chunks.timed_out}, failures=${chunkFailureCount}`,
        );
      }
      const documents = await this.client.updateByQuery({
        index: this.documentIndexName,
        query: { bool: { filter } },
        script: {
          source: 'ctx._source.lifecycleStatus = params.status',
          params: { status: lifecycleStatus },
        },
        refresh: true,
      });
      const documentFailureCount = documents.failures?.length ?? 0;
      if (documents.timed_out || documentFailureCount > 0) {
        throw new Error(
          `ES document lifecycle update incomplete: timedOut=${documents.timed_out}, failures=${documentFailureCount}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `ES lifecycle update failed for docId=${docId}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * BM25 全文检索（ES 原生 BM25 算法）
   */
  async search(
    query: string,
    topK = 5,
    userId?: string,
    scope: ElasticsearchSearchScope = {},
    allowedDocIds?: ReadonlySet<string>,
  ): Promise<
    Array<{
      id: string;
      content: string;
      docId: string;
      chunkIndex: number;
      score: number;
      parentChunkId?: string | null;
      headingPath?: string[];
      sectionId?: string | null;
      clauseId?: string | null;
      tableRef?: string | null;
      sourceStart?: number | null;
      sourceEnd?: number | null;
      docVersion?: string | null;
      effectiveAt?: string | null;
      expiredAt?: string | null;
      sourceAuthority?: string;
      projectId?: string | null;
      activityId?: string | null;
      region?: string | null;
      locale?: string | null;
      channel?: string | null;
      roleScope?: string[];
      documentType?: string;
      lifecycleStatus?: string;
      supersedesDocId?: string | null;
    }>
  > {
    if (this.enabled === false) return [];

    try {
      if (allowedDocIds != null && allowedDocIds.size === 0) return [];
      const filter: estypes.QueryDslQueryContainer[] = [];
      if (allowedDocIds != null) {
        filter.push({ terms: { docId: [...allowedDocIds] } });
      } else if (userId) {
        filter.push({ term: { userId } });
      }
      for (const [field, value] of Object.entries({
        projectId: scope.projectId,
        activityId: scope.activityId,
        region: scope.region,
        locale: scope.locale,
        channel: scope.channel,
        documentType: scope.documentType,
      })) {
        if (value) filter.push({ term: { [field]: value } });
      }
      if (scope.role) filter.push({ term: { roleScope: scope.role } });
      if (scope.fileType) {
        filter.push({
          wildcard: { 'filename.keyword': `*.${scope.fileType}` },
        });
      }
      if (scope.updatedRange) {
        const gte = {
          day: 'now-1d/d',
          week: 'now-7d/d',
          month: 'now-30d/d',
        }[scope.updatedRange];
        if (gte) filter.push({ range: { updatedAt: { gte } } });
      }
      if (scope.effectiveTime) {
        filter.push(...effectiveTimeFilters(scope.effectiveTime));
      }
      const excludeDeprecated = scope.effectiveTime
        ? scope.includeDeprecated === false
        : !scope.includeDeprecated;
      if (excludeDeprecated) {
        filter.push({
          bool: {
            must_not: [{ term: { lifecycleStatus: 'deprecated' } }],
          },
        });
      }
      // 审批/归档门禁：draft 未经审批、archived 已归档，任何检索口径都不可见
      filter.push({
        bool: {
          must_not: [
            { term: { lifecycleStatus: 'draft' } },
            { term: { lifecycleStatus: 'archived' } },
          ],
        },
      });
      const queryObj: estypes.QueryDslQueryContainer = {
        bool: {
          must: [
            {
              multi_match: {
                query,
                fields: ['content^1', 'hypotheticalQuestions^2'],
                type: 'best_fields',
              },
            },
          ],
          ...(filter.length > 0 ? { filter } : {}),
        },
      };

      const result = await this.client.search<IndexedChunk>({
        index: this.indexName,
        query: queryObj,
        size: topK,
        highlight: {
          fields: { content: { fragment_size: 180, number_of_fragments: 2 } },
          pre_tags: ['<em>'],
          post_tags: ['</em>'],
        },
      });

      return result.hits.hits.map((hit) => {
        const src = hit._source;
        return {
          id: hit._id ?? '',
          content: src?.content ?? '',
          docId: src?.docId ?? '',
          chunkIndex: src?.chunkIndex ?? 0,
          score: hit._score ?? 0,
          parentChunkId: src?.parentChunkId,
          headingPath: src?.headingPath,
          sectionId: src?.sectionId,
          clauseId: src?.clauseId,
          tableRef: src?.tableRef,
          sourceStart: src?.sourceStart,
          sourceEnd: src?.sourceEnd,
          parentContent: src?.parentContent,
          sourceMetadata: src?.sourceMetadata,
          docVersion: src?.docVersion,
          effectiveAt: src?.effectiveAt,
          expiredAt: src?.expiredAt,
          sourceAuthority: src?.sourceAuthority,
          projectId: src?.projectId,
          activityId: src?.activityId,
          region: src?.region,
          locale: src?.locale,
          channel: src?.channel,
          roleScope: src?.roleScope,
          documentType: src?.documentType,
          lifecycleStatus: src?.lifecycleStatus,
          supersedesDocId: src?.supersedesDocId,
          hypotheticalQuestions: src?.hypotheticalQuestions,
          highlightFragments: (hit.highlight?.content ?? []).map((fragment) =>
            String(fragment),
          ),
        };
      });
    } catch (err) {
      this.logger.warn(`ES search failed: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * dense_vector kNN 向量检索（rag_chunks.embedding 字段）
   *
   * - 单 ES 混合检索的向量通道：与 search()（BM25 关键词）互补，关键词与向量召回都落在 ES
   * - Milvus 故障时的向量降级通道
   * - 过滤条件挂在 knn.filter 上（在过滤后的候选集内取 top-K），
   *   而不是全局取完 top-K 再过滤，避免 top-K 被无权限/草稿文档占满导致过滤后为空
   */
  async knnSearch(
    vector: number[],
    topK: number,
    userId?: string,
    opts?: {
      includeDeprecated?: boolean;
      allowedDocIds?: ReadonlySet<string>;
      effectiveTime?: EffectiveTimeRange;
    },
  ): Promise<
    Array<{
      id: string;
      score: number;
      content: string;
      docId: string;
      chunkIndex: number;
    }>
  > {
    if (!this.enabled) return [];
    if (Array.isArray(vector) === false || vector.length === 0) return [];

    try {
      if (opts?.allowedDocIds != null && opts.allowedDocIds.size === 0)
        return [];
      const filter: estypes.QueryDslQueryContainer[] = [];
      if (opts?.allowedDocIds != null) {
        filter.push({ terms: { docId: [...opts.allowedDocIds] } });
      } else if (userId) {
        filter.push({ term: { userId } });
      }
      if (opts?.effectiveTime) {
        filter.push(...effectiveTimeFilters(opts.effectiveTime));
      }
      const excludeDeprecated = opts?.effectiveTime
        ? opts.includeDeprecated === false
        : !opts?.includeDeprecated;
      if (excludeDeprecated) {
        filter.push({
          bool: {
            must_not: [{ term: { lifecycleStatus: 'deprecated' } }],
          },
        });
      }
      // 审批/归档门禁：draft 未经审批、archived 已归档，任何检索口径都不可见
      filter.push({
        bool: {
          must_not: [
            { term: { lifecycleStatus: 'draft' } },
            { term: { lifecycleStatus: 'archived' } },
          ],
        },
      });

      const k = Math.max(1, Math.floor(topK) || 1);
      const numCandidates = Math.min(k * 4, 200);

      const result = await this.client.search<IndexedChunk>({
        index: this.indexName,
        knn: {
          field: 'embedding',
          query_vector: vector,
          k,
          num_candidates: numCandidates,
          filter,
        },
        size: k,
        _source: ['content', 'docId', 'chunkIndex'],
      });

      return result.hits.hits.map((hit) => ({
        id: hit._id ?? '',
        score: hit._score ?? 0,
        content: hit._source?.content ?? '',
        docId: hit._source?.docId ?? '',
        chunkIndex: hit._source?.chunkIndex ?? 0,
      }));
    } catch (err) {
      this.logger.warn(`ES knnSearch failed: ${(err as Error).message}`);
      return [];
    }
  }
}
