import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, estypes } from '@elastic/elasticsearch';

type IndexedChunk = {
  content: string;
  docId: string;
  chunkIndex: number;
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
};

type IndexedDocument = {
  docId: string;
  filename: string;
  title?: string | null;
  summary?: string | null;
  content: string;
  userId?: string | null;
  sourceAuthority?: string;
  projectId?: string | null;
  activityId?: string | null;
  region?: string | null;
  locale?: string | null;
  channel?: string | null;
  roleScope?: string[];
  documentType?: string;
  lifecycleStatus?: string;
  docVersion?: string | null;
  effectiveAt?: string | null;
  expiredAt?: string | null;
};

export interface ElasticsearchSearchScope {
  projectId?: string;
  activityId?: string;
  region?: string;
  locale?: string;
  channel?: string;
  role?: string;
  documentType?: string;
  includeDeprecated?: boolean;
  /** 按文件扩展名过滤（filename.keyword wildcard `*.{fileType}`），如 'pdf' */
  fileType?: string;
  /** 按更新时间过滤：day=今天 / week=近7天 / month=近30天（updatedAt date math range） */
  updatedRange?: 'day' | 'week' | 'month';
}

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
export class ElasticsearchProvider implements OnModuleInit {
  private readonly logger = new Logger(ElasticsearchProvider.name);
  private client!: Client;
  private enabled = false;
  private readonly indexName = 'rag_chunks';
  private readonly documentIndexName = 'kh_document';
  /** dense_vector 维度：必须与嵌入模型输出维度一致（RAG_ES_EMBEDDING_DIM，默认 1024） */
  private readonly embeddingDim: number;

  constructor(private readonly config: ConfigService) {
    const rawDim = this.config.get<string | number>('RAG_ES_EMBEDDING_DIM');
    const parsedDim =
      typeof rawDim === 'string' ? Number.parseInt(rawDim, 10) : rawDim;
    this.embeddingDim =
      typeof parsedDim === 'number' && Number.isFinite(parsedDim) && parsedDim > 0
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
          this.logger.warn(
            `ES mapping outdated (missing userId property). Re-creating...`,
          );
          await this.client.indices.delete({ index: this.indexName });
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
            if (existingDims !== undefined && existingDims !== this.embeddingDim) {
              this.logger.warn(
                `ES index "${this.indexName}" embedding dims=${existingDims} != RAG_ES_EMBEDDING_DIM=${this.embeddingDim}, kNN 检索将不可用；请统一配置或重建索引`,
              );
            }
          }
          return;
        }
      } catch (err) {
        this.logger.warn(
          `Failed to inspect ES index: ${(err as Error).message}. Re-creating...`,
        );
        await this.client.indices
          .delete({ index: this.indexName })
          .catch(() => {});
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
          userId: { type: 'keyword' },
          parentChunkId: { type: 'keyword' },
          headingPath: { type: 'keyword' },
          sectionId: { type: 'keyword' },
          clauseId: { type: 'keyword' },
          tableRef: { type: 'keyword' },
          sourceStart: { type: 'integer' },
          sourceEnd: { type: 'integer' },
          docVersion: { type: 'keyword' },
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

  /** 独立文档全文索引：只服务文档搜索，不参与 RAG 分块召回。 */
  private async ensureDocumentIndex(): Promise<void> {
    const exists = await this.client.indices.exists({ index: this.documentIndexName });
    if (exists) {
      // 幂等补字段：为存量 kh_document 索引补齐 updatedAt（更新时间筛选依赖此字段）
      // ES 支持给现有索引新增字段；失败仅告警，不阻塞启动，也绝不删除存量索引
      try {
        const mapping = await this.client.indices.getMapping({ index: this.documentIndexName });
        const properties = mapping[this.documentIndexName]?.mappings?.properties as
          | Record<string, unknown>
          | undefined;
        if (properties && !properties.updatedAt) {
          try {
            await this.client.indices.putMapping({
              index: this.documentIndexName,
              properties: { updatedAt: { type: 'date' } },
            });
            this.logger.log(`ES mapping patched for "${this.documentIndexName}": added updatedAt`);
          } catch (patchErr) {
            this.logger.warn(
              `ES putMapping (updatedAt) for "${this.documentIndexName}" failed, updatedRange filter unavailable until patched, startup continues: ${(patchErr as Error).message}`,
            );
          }
        }
      } catch (err) {
        this.logger.warn(
          `Failed to inspect ES index "${this.documentIndexName}": ${(err as Error).message}`,
        );
      }
      return;
    }

    await this.client.indices.create({
      index: this.documentIndexName,
      settings: {
        analysis: {
          analyzer: {
            ik_smart_analyzer: { type: 'custom', tokenizer: 'ik_smart' },
          },
        },
      },
      mappings: {
        properties: {
          docId: { type: 'keyword' },
          filename: { type: 'text', analyzer: 'ik_smart_analyzer', fields: { keyword: { type: 'keyword' } } },
          title: { type: 'text', analyzer: 'ik_smart_analyzer' },
          summary: { type: 'text', analyzer: 'ik_smart_analyzer' },
          content: { type: 'text', analyzer: 'ik_smart_analyzer' },
          userId: { type: 'keyword' },
          sourceAuthority: { type: 'keyword' },
          projectId: { type: 'keyword' },
          activityId: { type: 'keyword' },
          region: { type: 'keyword' },
          locale: { type: 'keyword' },
          channel: { type: 'keyword' },
          roleScope: { type: 'keyword' },
          documentType: { type: 'keyword' },
          lifecycleStatus: { type: 'keyword' },
          docVersion: { type: 'keyword' },
          effectiveAt: { type: 'date' },
          expiredAt: { type: 'date' },
          updatedAt: { type: 'date' },
        },
      },
    });
    this.logger.log(`ES document index "${this.documentIndexName}" created`);
  }

  async indexDocument(document: {
    docId: string;
    filename: string;
    content: string;
    userId?: string | null;
    title?: string | null;
    summary?: string | null;
    sourceAuthority?: string;
    projectId?: string | null;
    activityId?: string | null;
    region?: string | null;
    locale?: string | null;
    channel?: string | null;
    roleScope?: string[];
    documentType?: string;
    lifecycleStatus?: string;
    docVersion?: string | null;
    effectiveAt?: Date | null;
    expiredAt?: Date | null;
  }): Promise<void> {
    if (!this.enabled || !document.content.trim()) return;
    try {
      await this.client.index({
        index: this.documentIndexName,
        id: document.docId,
        refresh: true,
        document: {
          ...document,
          effectiveAt: document.effectiveAt?.toISOString() ?? null,
          expiredAt: document.expiredAt?.toISOString() ?? null,
          // 每次写入都刷新 updatedAt，供搜索的更新时间筛选使用
          updatedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      this.logger.warn(`ES indexDocument failed: ${(err as Error).message}`);
    }
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
      parentChunkId?: string | null;
      headingPath?: string[];
      sectionId?: string | null;
      clauseId?: string | null;
      tableRef?: string | null;
      sourceStart?: number | null;
      sourceEnd?: number | null;
      docVersion?: string | null;
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
      highlightFragments?: string[];
    }>,
    userId?: string,
    vectors?: Array<number[] | null>,
  ): Promise<void> {
    if (!this.enabled || chunks.length === 0) return;

    try {
      let dimMismatchWarned = false;
      const operations = chunks.flatMap((c, i) => {
        const rawVector = vectors?.[i] ?? null;
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
            userId: c.userId || userId,
            parentChunkId: c.parentChunkId,
            headingPath: c.headingPath,
            sectionId: c.sectionId,
            clauseId: c.clauseId,
            tableRef: c.tableRef,
            sourceStart: c.sourceStart,
            sourceEnd: c.sourceEnd,
            docVersion: c.docVersion,
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

      const result = await this.client.bulk({ operations, refresh: true });
      if (result.errors) {
        this.logger.warn(
          `ES bulk index had errors for docId=${chunks[0]?.docId}`,
        );
      } else {
        this.logger.log(
          `ES indexed ${chunks.length} chunks for docId=${chunks[0]?.docId}`,
        );
      }
    } catch (err) {
      this.logger.warn(`ES indexChunks failed: ${(err as Error).message}`);
    }
  }

  /**
   * 按 docId 删除所有 chunks
   */
  async deleteByDocId(docId: string, _userId?: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.client.deleteByQuery({
        index: this.indexName,
        query: { term: { docId } },
      });
      await this.client.delete({ index: this.documentIndexName, id: docId, refresh: true }).catch(() => undefined);
      this.logger.log(
        `ES deleted chunks for docId=${docId} and userId=${_userId ?? 'none'}`,
      );
    } catch (err) {
      this.logger.warn(`ES deleteByDocId failed: ${(err as Error).message}`);
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
      await this.client.updateByQuery({
        index: this.indexName,
        query: { bool: { filter } },
        script: {
          source: 'ctx._source.lifecycleStatus = params.status',
          params: { status: lifecycleStatus },
        },
        refresh: true,
      });
      await this.client.updateByQuery({
        index: this.documentIndexName,
        query: { bool: { filter } },
        script: {
          source: 'ctx._source.lifecycleStatus = params.status',
          params: { status: lifecycleStatus },
        },
        refresh: true,
      });
    } catch (error) {
      this.logger.warn(
        `ES lifecycle update failed for docId=${docId}: ${(error as Error).message}`,
      );
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
    if (!this.enabled) return [];

    try {
      const filter: estypes.QueryDslQueryContainer[] = userId
        ? [{ term: { userId } }]
        : [];
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
        filter.push({ wildcard: { 'filename.keyword': `*.${scope.fileType}` } });
      }
      if (scope.updatedRange) {
        const gte = {
          day: 'now-1d/d',
          week: 'now-7d/d',
          month: 'now-30d/d',
        }[scope.updatedRange];
        if (gte) filter.push({ range: { updatedAt: { gte } } });
      }
      if (!scope.includeDeprecated) {
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
                fields: ['content'],
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
          highlightFragments: (hit.highlight?.content ?? []).map((fragment) => String(fragment)),
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
    opts?: { includeDeprecated?: boolean },
  ): Promise<Array<{ id: string; score: number }>> {
    if (!this.enabled) return [];
    if (!Array.isArray(vector) || vector.length === 0) return [];

    try {
      const filter: estypes.QueryDslQueryContainer[] = userId
        ? [{ term: { userId } }]
        : [];
      if (!opts?.includeDeprecated) {
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
        _source: false,
      });

      return result.hits.hits.map((hit) => ({
        id: hit._id ?? '',
        score: hit._score ?? 0,
      }));
    } catch (err) {
      this.logger.warn(`ES knnSearch failed: ${(err as Error).message}`);
      return [];
    }
  }

  /** 独立文档全文检索，返回 ES highlight 片段，不与分块 RAG 检索混用。 */
  async searchDocuments(
    query: string,
    topK = 20,
    userId?: string,
    scope: ElasticsearchSearchScope = {},
  ): Promise<Array<{
    docId: string;
    filename: string;
    title?: string | null;
    summary?: string | null;
    score: number;
    highlightFragments: string[];
    docVersion?: string | null;
    lifecycleStatus?: string;
    sourceAuthority?: string;
  }>> {
    if (!this.enabled || !query.trim()) return [];
    try {
      const filter: estypes.QueryDslQueryContainer[] = userId ? [{ term: { userId } }] : [];
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
      // 高级筛选：文件类型（filename.keyword 后缀匹配）与更新时间（updatedAt date math range）
      if (scope.fileType) {
        filter.push({ wildcard: { 'filename.keyword': `*.${scope.fileType}` } });
      }
      if (scope.updatedRange) {
        const gte = {
          day: 'now-1d/d',
          week: 'now-7d/d',
          month: 'now-30d/d',
        }[scope.updatedRange];
        if (gte) filter.push({ range: { updatedAt: { gte } } });
      }
      if (!scope.includeDeprecated) {
        filter.push({ bool: { must_not: [{ term: { lifecycleStatus: 'deprecated' } }] } });
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
      const result = await this.client.search<IndexedDocument>({
        index: this.documentIndexName,
        query: {
          bool: {
            must: [{ multi_match: { query, fields: ['title^3', 'filename^2', 'summary', 'content'], type: 'best_fields' } }],
            ...(filter.length ? { filter } : {}),
          },
        },
        size: Math.min(Math.max(topK, 1), 50),
        highlight: {
          fields: {
            content: { fragment_size: 220, number_of_fragments: 3 },
            title: { number_of_fragments: 1 },
            summary: { fragment_size: 180, number_of_fragments: 1 },
          },
          pre_tags: ['<em>'],
          post_tags: ['</em>'],
        },
      });
      return result.hits.hits.map((hit) => {
        const source = hit._source;
        const highlights = [
          ...(hit.highlight?.title ?? []),
          ...(hit.highlight?.summary ?? []),
          ...(hit.highlight?.content ?? []),
        ].map(String);
        return {
          docId: source?.docId ?? hit._id ?? '',
          filename: source?.filename ?? '',
          title: source?.title ?? null,
          summary: source?.summary ?? null,
          score: hit._score ?? 0,
          highlightFragments: highlights,
          docVersion: source?.docVersion,
          lifecycleStatus: source?.lifecycleStatus,
          sourceAuthority: source?.sourceAuthority,
        };
      });
    } catch (err) {
      this.logger.warn(`ES document search failed: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * 文档搜索筛选面板的 facets：对 kh_document 做 terms 聚合，
   * 返回可筛的文档分类（documentType）与权限范围（roleScope）。
   * 聚合与检索同口径（排除 draft / deprecated），size 20；ES 未启用或查询失败返回空数组。
   */
  async getDocumentSearchFacets(): Promise<{ documentTypes: string[]; roles: string[] }> {
    const empty: { documentTypes: string[]; roles: string[] } = {
      documentTypes: [],
      roles: [],
    };
    if (!this.enabled) return empty;
    try {
      const result = await this.client.search<IndexedDocument>({
        index: this.documentIndexName,
        size: 0,
        query: {
          bool: {
            must_not: [
              { term: { lifecycleStatus: 'draft' } },
              { term: { lifecycleStatus: 'deprecated' } },
            ],
          },
        },
        aggs: {
          documentTypes: { terms: { field: 'documentType', size: 20 } },
          roles: { terms: { field: 'roleScope', size: 20 } },
        },
      });
      const toKeys = (aggregate: unknown): string[] => {
        const buckets = (aggregate as { buckets?: Array<{ key: unknown }> } | undefined)?.buckets ?? [];
        return buckets.map((bucket) => String(bucket.key));
      };
      const aggs = result.aggregations as
        | { documentTypes?: unknown; roles?: unknown }
        | undefined;
      return {
        documentTypes: toKeys(aggs?.documentTypes),
        roles: toKeys(aggs?.roles),
      };
    } catch (err) {
      this.logger.warn(`ES document facets failed: ${(err as Error).message}`);
      return empty;
    }
  }
}
