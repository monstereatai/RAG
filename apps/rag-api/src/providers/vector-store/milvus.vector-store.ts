import { Injectable, OnModuleInit, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DingTalkProvider } from '../notify/dingtalk.provider';
import {
  MilvusClient,
  DataType,
  MetricType,
  IndexType,
} from '@zilliz/milvus2-sdk-node';
import {
  IVectorStoreProvider,
  ImageSearchHit,
  ImageVectorRecord,
  RetrievalDescriptionVectorHit,
  RetrievalDescriptionVectorRecord,
  StoredVectorRecord,
  VectorRecord,
  VectorSearchHit,
} from './vector-store-provider.interface';
import { MilvusVectorStoreDiagnosticsBase } from './milvus.vector-store.diagnostics';

const MAX_VECTOR_CONTENT_BYTES = 8_192;

function readMilvusString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  if (typeof value === 'string') return value;
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : '';
}

/**
 * Milvus VectorStore Provider
 * 集合 schema：id(主键) / vector / content / doc_id / chunk_index
 * 图片集合 schema（rag_images）：id(主键) / vector / doc_id / user_id / url / meta
 */
@Injectable()
export class MilvusVectorStoreProvider
  extends MilvusVectorStoreDiagnosticsBase
  implements IVectorStoreProvider, OnModuleInit
{
  protected readonly logger = new Logger(MilvusVectorStoreProvider.name);
  private client!: MilvusClient;
  protected readonly collection: string;
  protected readonly dimension: number;
  protected readonly imageCollection: string;
  protected readonly imageDimension: number;
  protected readonly descriptionCollection: string;
  private readonly host: string;
  private readonly port: number;
  protected readonly indexType: IndexType;
  protected readonly hnswM: number;
  protected readonly hnswEfConstruction: number;
  protected readonly hnswEfSearch: number;
  protected readonly searchTimeoutMs: number;
  protected readonly deleteTimeoutMs: number;
  protected readonly warmupTimeoutMs: number;
  protected readonly circuitOpenMs: number;
  protected readonly circuitFailureThreshold: number;
  protected connected = false;

  constructor(
    private readonly config: ConfigService,
    @Optional() protected readonly dingTalk?: DingTalkProvider,
  ) {
    super();
    this.host =
      this.config.get<string>('vectorStore.milvus.host') ?? 'localhost';
    this.port = this.config.get<number>('vectorStore.milvus.port') ?? 19530;
    this.collection =
      this.config.get<string>('vectorStore.milvus.collection') ?? 'rag_chunks';
    this.dimension =
      this.config.get<number>('vectorStore.milvus.dimension') ?? 1024;
    // 图片独立集合：MILVUS_IMAGE_DIMENSION > MULTIMODAL_EMBEDDING_DIM > 主集合维度
    // （读取惯例与 getCapabilities 中 RERANK_PROVIDER 一致：ConfigService 回落 process.env）
    const imageDimEnv =
      this.config.get<string>('MILVUS_IMAGE_DIMENSION') ??
      this.config.get<string>('MULTIMODAL_EMBEDDING_DIM');
    this.imageCollection =
      this.config.get<string>('MILVUS_IMAGE_COLLECTION') ?? 'rag_images';
    this.imageDimension = imageDimEnv
      ? parseInt(imageDimEnv, 10)
      : this.dimension;
    this.descriptionCollection =
      this.config.get<string>('MILVUS_DESCRIPTION_COLLECTION') ??
      this.config.get<string>('vectorStore.milvus.descriptionCollection') ??
      'rag_retrieval_descriptions';
    this.indexType = this.resolveIndexType(
      this.config.get<string>('vectorStore.milvus.indexType') ?? 'HNSW',
    );
    this.hnswM = this.config.get<number>('vectorStore.milvus.hnswM') ?? 16;
    this.hnswEfConstruction =
      this.config.get<number>('vectorStore.milvus.hnswEfConstruction') ?? 200;
    this.hnswEfSearch =
      this.config.get<number>('vectorStore.milvus.hnswEfSearch') ?? 64;
    this.searchTimeoutMs =
      this.config.get<number>('vectorStore.milvus.searchTimeoutMs') ?? 800;
    this.deleteTimeoutMs =
      this.config.get<number>('vectorStore.milvus.deleteTimeoutMs') ?? 1_000;
    this.warmupTimeoutMs =
      this.config.get<number>('vectorStore.milvus.warmupTimeoutMs') ?? 1_500;
    this.circuitOpenMs =
      this.config.get<number>('vectorStore.milvus.circuitOpenMs') ?? 30_000;
    this.circuitFailureThreshold =
      this.config.get<number>('vectorStore.milvus.circuitFailureThreshold') ??
      2;
  }

  onModuleInit(): void {
    void this.initialize();
  }

  private async initialize(): Promise<void> {
    // 对齐 agent-course/milvus-test 参考实现：不设 timeout，让 Milvus 自行管理
    this.client = new MilvusClient({
      address: `${this.host}:${this.port}`,
    });
    try {
      await this.client.connectPromise;
      this.connected = true;
      this.recordSuccess();
      this.logger.log(`Milvus connected at ${this.host}:${this.port}`);
      await this.ensureCollection();
      // 图片集合独立初始化：失败仅降级图片检索，不影响文本 RAG 启动
      try {
        await this.ensureImageCollection();
      } catch (imageErr) {
        this.logger.error(
          `Milvus image collection init failed (${this.imageCollection}): ${(imageErr as Error).message}. Image search APIs will degrade.`,
        );
      }
      try {
        await this.ensureDescriptionCollection();
      } catch (descriptionErr) {
        this.logger.error(
          `Milvus description collection init failed (${this.descriptionCollection}): ${(descriptionErr as Error).message}. Description retrieval will degrade.`,
        );
      }
      // 预热：触发 Milvus 加载索引到内存，避免首次 search 超时
      await this.warmup();
    } catch (err) {
      // Milvus 连接失败不阻断服务启动，相关接口调用时会抛错
      this.logger.error(
        `Milvus connection failed at ${this.host}:${this.port}: ${(err as Error).message}`,
      );
      this.connected = false;
      this.recordFailure(err);
      this.logger.warn(
        'Service will start but Milvus-related APIs will fail until Milvus is available',
      );
    }
  }

  /**
   * 预热：用随机向量做一次 search，触发 Milvus 加载索引到内存。
   * 避免 agentic 首次 search 因索引未加载而超时。
   */
  private async warmup(): Promise<void> {
    try {
      const warmupVector = Array(this.dimension)
        .fill(0)
        .map(() => Math.random());
      await this.client.search({
        collection_name: this.collection,
        vector: warmupVector,
        limit: 1,
        metric_type: MetricType.COSINE,
        output_fields: ['id'],
        timeout: this.warmupTimeoutMs,
      });
      this.recordSuccess();
      this.logger.log('Milvus warmup search done');
    } catch (err) {
      this.recordFailure(err);
      this.logger.warn(`Milvus warmup failed: ${(err as Error).message}`);
    }
  }

  async ensureCollection(): Promise<void> {
    const has = await this.client.hasCollection({
      collection_name: this.collection,
    });
    if (has.value) {
      this.logger.log(
        `Collection ${this.collection} already exists, checking schema...`,
      );
      try {
        const desc = await this.client.describeCollection({
          collection_name: this.collection,
        });
        const hasUserIdField = desc.schema.fields.some(
          (f) => f.name === 'user_id',
        );
        if (!hasUserIdField) {
          this.logger.warn(
            `Collection schema outdated (missing user_id field). Re-creating...`,
          );
          await this.client.dropCollection({
            collection_name: this.collection,
          });
        } else {
          // 对齐 agent-course/milvus-test 参考实现：查询前 loadCollection（已加载会忽略错误）
          await this.client.loadCollection({
            collection_name: this.collection,
          });
          this.logger.log(`Collection ${this.collection} loaded`);
          return;
        }
      } catch (err) {
        this.logger.warn(
          `Failed to describe collection: ${(err as Error).message}. Retrying recreate...`,
        );
        await this.client
          .dropCollection({ collection_name: this.collection })
          .catch(() => {});
      }
    }

    this.logger.log(`Creating collection ${this.collection}...`);
    await this.client.createCollection({
      collection_name: this.collection,
      fields: [
        {
          name: 'id',
          data_type: DataType.VarChar,
          max_length: 64,
          is_primary_key: true,
        },
        {
          name: 'vector',
          data_type: DataType.FloatVector,
          dim: this.dimension,
        },
        {
          name: 'content',
          data_type: DataType.VarChar,
          max_length: MAX_VECTOR_CONTENT_BYTES,
        },
        {
          name: 'doc_id',
          data_type: DataType.VarChar,
          max_length: 64,
        },
        {
          name: 'chunk_index',
          data_type: DataType.Int64,
        },
        {
          name: 'user_id',
          data_type: DataType.VarChar,
          max_length: 64,
        },
      ],
    });

    await this.client.createIndex({
      collection_name: this.collection,
      field_name: 'vector',
      index_type: this.indexType,
      metric_type: MetricType.COSINE,
      params: this.getCreateIndexParams(),
    });

    await this.client.loadCollection({ collection_name: this.collection });
    this.logger.log(`Collection ${this.collection} created and loaded`);
  }

  async insert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;
    // 向量由入库服务预先生成；此处只持久化 Milvus 检索所需字段并等待 flush 完成。
    // VarChar 内容最多存 8192 字节；完整片段仍保存在 PostgreSQL/BM25，召回后会取完整来源文本。
    const data = records.map((r) => ({
      id: r.id,
      vector: r.vector,
      content: truncateUtf8(r.content, MAX_VECTOR_CONTENT_BYTES),
      doc_id: r.docId,
      chunk_index: r.chunkIndex,
      user_id: r.userId ?? '',
    }));
    const result = await this.client.insert({
      collection_name: this.collection,
      data,
    });
    if (
      result.status.error_code !== 'Success' &&
      Number(result.status.code) !== 0
    ) {
      throw new Error(
        `Milvus insert failed: ${result.status.reason || result.status.error_code}`,
      );
    }
    const insertedCount = Number(result.insert_cnt);
    if (!Number.isFinite(insertedCount) || insertedCount !== records.length) {
      throw new Error(
        `Milvus insert count mismatch: expected ${records.length}, received ${result.insert_cnt}`,
      );
    }
    const flushResult = await this.client.flushSync({
      collection_names: [this.collection],
    });
    if (
      flushResult.status.error_code !== 'Success' &&
      Number(flushResult.status.code) !== 0
    ) {
      throw new Error(
        `Milvus flush failed: ${flushResult.status.reason || flushResult.status.error_code}`,
      );
    }
    this.logger.log(`Inserted ${result.insert_cnt} records`);
  }

  async similaritySearch(
    queryVector: number[],
    k: number,
    userId?: string,
    allowedDocIds?: ReadonlySet<string>,
  ): Promise<VectorSearchHit[]> {
    // ACL 在 Milvus 查询内部完成，避免先取全局 topK 再过滤造成越权或召回损失。
    if (this.isCircuitOpen()) {
      throw new Error('Milvus similarity search circuit is open');
    }
    if (allowedDocIds != null && allowedDocIds.size === 0) return [];

    const ids = allowedDocIds == null ? undefined : [...allowedDocIds];
    const batches = ids == null ? [undefined] : chunkArray(ids, 200);
    const hits: VectorSearchHit[] = [];

    try {
      for (const batch of batches) {
        const expr =
          batch == null
            ? userId
              ? `user_id == "${escapeMilvusString(userId)}"`
              : undefined
            : `doc_id in [${batch
                .map((id) => `"${escapeMilvusString(id)}"`)
                .join(',')}]`;
        const searchParams = {
          collection_name: this.collection,
          vector: queryVector,
          limit: k,
          metric_type: MetricType.COSINE,
          params: this.getSearchParams(),
          output_fields: ['id', 'content', 'doc_id', 'chunk_index'],
          expr,
          timeout: this.searchTimeoutMs,
        };
        const searchResult = await this.withTimeout(
          this.client.search(searchParams),
          this.searchTimeoutMs + 200,
          'Milvus similarity search',
        );
        hits.push(
          ...(searchResult.results as Array<Record<string, unknown>>).map(
            (hit) => ({
              id:
                typeof hit['id'] === 'string' || typeof hit['id'] === 'number'
                  ? String(hit['id'])
                  : '',
              content: typeof hit['content'] === 'string' ? hit['content'] : '',
              docId:
                typeof hit['doc_id'] === 'string' ||
                typeof hit['doc_id'] === 'number'
                  ? String(hit['doc_id'])
                  : '',
              chunkIndex:
                typeof hit['chunk_index'] === 'number'
                  ? hit['chunk_index']
                  : Number(hit['chunk_index'] ?? 0),
              score:
                typeof hit['score'] === 'number'
                  ? hit['score']
                  : Number(hit['score'] ?? 0),
            }),
          ),
        );
      }
      this.recordSuccess();
      return hits.sort((left, right) => right.score - left.score).slice(0, k);
    } catch (err) {
      this.recordFailure(err);
      throw err;
    }
  }

  async deleteByIds(ids: string[]): Promise<void> {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) return;
    try {
      for (const batch of chunkArray(uniqueIds, 200)) {
        const filter = `id in [${batch
          .map((id) => `"${escapeMilvusString(id)}"`)
          .join(',')}]`;
        await this.withTimeout(
          this.client.deleteEntities({
            collection_name: this.collection,
            filter,
            timeout: this.deleteTimeoutMs,
          }),
          this.deleteTimeoutMs + 200,
          'Milvus delete by chunk ids',
        );
      }
      this.recordSuccess();
      this.logger.log(`Deleted ${uniqueIds.length} chunk vectors by id`);
    } catch (err) {
      this.recordFailure(err);
      this.logger.warn(
        `Milvus delete by ids failed: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  async deleteByDocId(docId: string): Promise<void> {
    try {
      await this.withTimeout(
        this.client.deleteEntities({
          collection_name: this.collection,
          filter: `doc_id == "${escapeMilvusString(docId)}"`,
          timeout: this.deleteTimeoutMs,
        }),
        this.deleteTimeoutMs + 200,
        'Milvus delete by docId',
      );
      this.recordSuccess();
      this.logger.log(`Deleted chunks for doc_id=${docId}`);
    } catch (err) {
      this.recordFailure(err);
      this.logger.warn(
        `Milvus delete timed out for doc_id=${docId}; continuing with other indexes: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  async countByDocId(docId: string, userId?: string): Promise<number> {
    if (!this.connected || !this.client) {
      throw new Error('Milvus is unavailable');
    }
    const filters = [`doc_id == "${escapeMilvusString(docId)}"`];
    if (userId) {
      filters.push(`user_id == "${escapeMilvusString(userId)}"`);
    }
    try {
      const result = await this.withTimeout(
        this.client.query({
          collection_name: this.collection,
          filter: filters.join(' && '),
          output_fields: ['id'],
          limit: 16_384,
        }),
        this.searchTimeoutMs + 200,
        'Milvus count by docId',
      );
      this.recordSuccess();
      return Array.isArray(result.data) ? result.data.length : 0;
    } catch (err) {
      this.recordFailure(err);
      throw err;
    }
  }

  async getVectorsByIds(ids: string[]): Promise<StoredVectorRecord[]> {
    if (!this.connected || !this.client) {
      throw new Error('Milvus is unavailable');
    }
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) return [];

    try {
      const records: StoredVectorRecord[] = [];
      for (const batch of chunkArray(uniqueIds, 200)) {
        const result = await this.withTimeout(
          this.client.get({
            collection_name: this.collection,
            ids: batch,
            output_fields: ['id', 'content', 'vector'],
            timeout: this.searchTimeoutMs,
          }),
          this.searchTimeoutMs + 200,
          'Milvus get vectors by ids',
        );
        for (const row of result.data as Array<Record<string, unknown>>) {
          const id = readMilvusString(row, 'id');
          const content = row['content'];
          const vector = row['vector'];
          if (
            id &&
            typeof content === 'string' &&
            Array.isArray(vector) &&
            vector.length === this.dimension &&
            vector.every((value) => typeof value === 'number')
          ) {
            records.push({ id, content, vector });
          }
        }
      }
      this.recordSuccess();
      return records;
    } catch (err) {
      this.recordFailure(err);
      throw err;
    }
  }

  // ─── 图片集合（rag_images，以图搜图 / 文搜图）──────────────────

  /**
   * 初始化图片独立集合：不存在则创建 + 建索引 + load；
   * schema 缺少必要字段（如历史脏集合）时重建。
   */
  async ensureImageCollection(): Promise<void> {
    const has = await this.client.hasCollection({
      collection_name: this.imageCollection,
    });
    if (has.value) {
      this.logger.log(
        `Image collection ${this.imageCollection} already exists, checking schema...`,
      );
      try {
        const desc = await this.client.describeCollection({
          collection_name: this.imageCollection,
        });
        const fieldNames = new Set(desc.schema.fields.map((f) => f.name));
        const requiredFields = ['id', 'vector', 'doc_id', 'user_id', 'url'];
        const outdated = requiredFields.some((f) => !fieldNames.has(f));
        if (outdated) {
          this.logger.warn(
            `Image collection schema outdated (missing required fields). Re-creating...`,
          );
          await this.client.dropCollection({
            collection_name: this.imageCollection,
          });
        } else {
          await this.client.loadCollection({
            collection_name: this.imageCollection,
          });
          this.logger.log(`Image collection ${this.imageCollection} loaded`);
          return;
        }
      } catch (err) {
        this.logger.warn(
          `Failed to describe image collection: ${(err as Error).message}. Retrying recreate...`,
        );
        await this.client
          .dropCollection({ collection_name: this.imageCollection })
          .catch(() => {});
      }
    }

    this.logger.log(`Creating image collection ${this.imageCollection}...`);
    await this.client.createCollection({
      collection_name: this.imageCollection,
      fields: [
        {
          name: 'id',
          data_type: DataType.VarChar,
          max_length: 64,
          is_primary_key: true,
        },
        {
          name: 'vector',
          data_type: DataType.FloatVector,
          dim: this.imageDimension,
        },
        {
          name: 'doc_id',
          data_type: DataType.VarChar,
          max_length: 64,
        },
        {
          name: 'user_id',
          data_type: DataType.VarChar,
          max_length: 64,
        },
        {
          name: 'url',
          data_type: DataType.VarChar,
          max_length: 4096,
        },
        {
          name: 'meta',
          data_type: DataType.VarChar,
          max_length: 8192,
        },
      ],
    });

    await this.client.createIndex({
      collection_name: this.imageCollection,
      field_name: 'vector',
      index_type: this.indexType,
      metric_type: MetricType.COSINE,
      params: this.getCreateIndexParams(),
    });

    await this.client.loadCollection({
      collection_name: this.imageCollection,
    });
    this.logger.log(
      `Image collection ${this.imageCollection} created (dim=${this.imageDimension}) and loaded`,
    );
  }

  async insertImages(records: ImageVectorRecord[]): Promise<void> {
    if (records.length === 0) return;
    const data = records.map((r) => ({
      id: r.id,
      vector: r.vector,
      doc_id: r.docId,
      user_id: r.userId ?? '',
      url: r.url,
      meta: r.meta ?? '',
    }));
    const result = await this.client.insert({
      collection_name: this.imageCollection,
      data,
    });
    await this.client.flushSync({ collection_names: [this.imageCollection] });
    this.logger.log(
      `Inserted ${result.insert_cnt} image records into ${this.imageCollection}`,
    );
  }

  async searchImages(
    queryVector: number[],
    k: number,
    userId?: string,
    allowedDocIds?: ReadonlySet<string>,
  ): Promise<ImageSearchHit[]> {
    if (this.isCircuitOpen()) {
      throw new Error('Milvus image search circuit is open');
    }
    if (allowedDocIds?.size === 0) return [];

    const searchParams = {
      collection_name: this.imageCollection,
      vector: queryVector,
      limit: k,
      metric_type: MetricType.COSINE,
      params: this.getSearchParams(),
      output_fields: ['id', 'doc_id', 'user_id', 'url', 'meta'],
      timeout: this.searchTimeoutMs,
    };

    const docIds = allowedDocIds ? [...allowedDocIds] : [];
    const batches = allowedDocIds
      ? Array.from({ length: Math.ceil(docIds.length / 100) }, (_, index) =>
          docIds.slice(index * 100, (index + 1) * 100),
        )
      : [undefined];
    const hits: ImageSearchHit[] = [];
    try {
      for (const batch of batches) {
        const searchResult = await this.withTimeout(
          this.client.search({
            ...searchParams,
            ...(batch
              ? {
                  filter: `doc_id in [${batch
                    .map((id) => `"${escapeMilvusString(id)}"`)
                    .join(',')}]`,
                }
              : userId
                ? {
                    filter: `user_id == "${escapeMilvusString(userId)}"`,
                  }
                : {}),
          }),
          this.searchTimeoutMs + 200,
          'Milvus image search',
        );
        hits.push(
          ...(searchResult.results as Array<Record<string, unknown>>).map(
            (hit) => ({
              id:
                typeof hit['id'] === 'string' || typeof hit['id'] === 'number'
                  ? String(hit['id'])
                  : '',
              docId:
                typeof hit['doc_id'] === 'string' ||
                typeof hit['doc_id'] === 'number'
                  ? String(hit['doc_id'])
                  : '',
              userId: typeof hit['user_id'] === 'string' ? hit['user_id'] : '',
              url: typeof hit['url'] === 'string' ? hit['url'] : '',
              meta:
                typeof hit['meta'] === 'string' && hit['meta'] !== ''
                  ? hit['meta']
                  : undefined,
              score:
                typeof hit['score'] === 'number'
                  ? hit['score']
                  : Number(hit['score'] ?? 0),
            }),
          ),
        );
      }
      this.recordSuccess();
    } catch (err) {
      this.recordFailure(err);
      throw err;
    }
    return hits.sort((left, right) => right.score - left.score).slice(0, k);
  }

  async deleteImagesByDocId(docId: string, userId?: string): Promise<void> {
    try {
      await this.withTimeout(
        this.client.deleteEntities({
          collection_name: this.imageCollection,
          filter:
            userId !== undefined
              ? `doc_id == "${escapeMilvusString(docId)}" && user_id == "${escapeMilvusString(userId)}"`
              : `doc_id == "${escapeMilvusString(docId)}"`,
          timeout: this.deleteTimeoutMs,
        }),
        this.deleteTimeoutMs + 200,
        'Milvus delete images by docId',
      );
      this.recordSuccess();
      this.logger.log(
        `Deleted image records for doc_id=${docId}${userId ? ` user_id=${userId}` : ''}`,
      );
    } catch (err) {
      this.recordFailure(err);
      this.logger.warn(
        `Milvus image delete failed for doc_id=${docId}: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  async countImagesByDocId(docId: string, userId?: string): Promise<number> {
    if (!this.connected || !this.client) {
      throw new Error('Milvus is unavailable');
    }
    const filters = [`doc_id == "${escapeMilvusString(docId)}"`];
    if (userId !== undefined) {
      filters.push(`user_id == "${escapeMilvusString(userId)}"`);
    }
    try {
      const result = await this.withTimeout(
        this.client.query({
          collection_name: this.imageCollection,
          filter: filters.join(' && '),
          output_fields: ['id'],
          limit: 16_384,
        }),
        this.searchTimeoutMs + 200,
        'Milvus count images by docId',
      );
      this.recordSuccess();
      return Array.isArray(result.data) ? result.data.length : 0;
    } catch (err) {
      this.recordFailure(err);
      throw err;
    }
  }

  /** 创建或加载专用描述集合；遇到已有不兼容 schema 时失败关闭，不删旧集合。 */
  async ensureDescriptionCollection(): Promise<void> {
    const has = await this.client.hasCollection({
      collection_name: this.descriptionCollection,
    });
    if (has.value) {
      const desc = await this.client.describeCollection({
        collection_name: this.descriptionCollection,
      });
      const fieldNames = new Set(desc.schema.fields.map((field) => field.name));
      const requiredFields = [
        'id',
        'vector',
        'doc_id',
        'tenant_id',
        'user_id',
        'content',
      ];
      const missing = requiredFields.filter((field) => !fieldNames.has(field));
      if (missing.length > 0) {
        throw new Error(
          `Description collection schema is missing fields: ${missing.join(', ')}`,
        );
      }
      await this.client.loadCollection({
        collection_name: this.descriptionCollection,
      });
      return;
    }

    await this.client.createCollection({
      collection_name: this.descriptionCollection,
      fields: [
        {
          name: 'id',
          data_type: DataType.VarChar,
          max_length: 64,
          is_primary_key: true,
        },
        {
          name: 'vector',
          data_type: DataType.FloatVector,
          dim: this.dimension,
        },
        {
          name: 'doc_id',
          data_type: DataType.VarChar,
          max_length: 64,
        },
        {
          name: 'tenant_id',
          data_type: DataType.VarChar,
          max_length: 64,
        },
        {
          name: 'user_id',
          data_type: DataType.VarChar,
          max_length: 64,
        },
        {
          name: 'content',
          data_type: DataType.VarChar,
          max_length: 8192,
        },
      ],
    });
    await this.client.createIndex({
      collection_name: this.descriptionCollection,
      field_name: 'vector',
      index_type: this.indexType,
      metric_type: MetricType.COSINE,
      params: this.getCreateIndexParams(),
    });
    await this.client.loadCollection({
      collection_name: this.descriptionCollection,
    });
  }

  async upsertDescriptions(
    records: RetrievalDescriptionVectorRecord[],
  ): Promise<void> {
    if (records.length === 0) return;
    await this.client.upsert({
      collection_name: this.descriptionCollection,
      data: records.map((record) => ({
        id: record.id,
        vector: record.vector,
        doc_id: record.docId,
        tenant_id: record.tenantId,
        user_id: record.userId ?? '',
        content: record.content,
      })),
    });
    await this.client.flushSync({
      collection_names: [this.descriptionCollection],
    });
  }

  async searchDescriptions(
    queryVector: number[],
    options: { tenantId: string; topK: number },
  ): Promise<RetrievalDescriptionVectorHit[]> {
    if (this.isCircuitOpen()) {
      throw new Error('Milvus description search circuit is open');
    }
    try {
      const result = await this.withTimeout(
        this.client.search({
          collection_name: this.descriptionCollection,
          vector: queryVector,
          limit: options.topK,
          metric_type: MetricType.COSINE,
          params: this.getSearchParams(),
          output_fields: ['id', 'doc_id', 'tenant_id', 'user_id', 'content'],
          filter: `tenant_id == "${escapeMilvusString(options.tenantId)}"`,
          timeout: this.searchTimeoutMs,
        }),
        this.searchTimeoutMs + 200,
        'Milvus description search',
      );
      this.recordSuccess();
      return (result.results as Array<Record<string, unknown>>).map((hit) => ({
        id: readMilvusString(hit, 'id'),
        docId: readMilvusString(hit, 'doc_id'),
        tenantId: readMilvusString(hit, 'tenant_id'),
        userId: readMilvusString(hit, 'user_id'),
        content: readMilvusString(hit, 'content'),
        score: Number(hit['score'] ?? 0),
      }));
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  async deleteDescriptionsByDocId(
    tenantId: string,
    docId: string,
  ): Promise<void> {
    try {
      await this.withTimeout(
        this.client.deleteEntities({
          collection_name: this.descriptionCollection,
          filter: `tenant_id == "${escapeMilvusString(tenantId)}" && doc_id == "${escapeMilvusString(docId)}"`,
          timeout: this.deleteTimeoutMs,
        }),
        this.deleteTimeoutMs + 200,
        'Milvus delete descriptions by docId',
      );
      this.recordSuccess();
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  async listDescriptionIds(tenantId: string, docId: string): Promise<string[]> {
    if (!this.connected || !this.client) {
      throw new Error('Milvus is unavailable');
    }
    try {
      const result = await this.withTimeout(
        this.client.query({
          collection_name: this.descriptionCollection,
          filter: `tenant_id == "${escapeMilvusString(tenantId)}" && doc_id == "${escapeMilvusString(docId)}"`,
          output_fields: ['id'],
          limit: 16_384,
        }),
        this.searchTimeoutMs + 200,
        'Milvus list description IDs',
      );
      this.recordSuccess();
      return Array.isArray(result.data)
        ? result.data.map((row) => String(row['id'] ?? ''))
        : [];
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    label: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timeout after ${ms}ms`)),
        ms,
      );
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function escapeMilvusString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function truncateUtf8(value: string, maxBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > maxBytes) break;
    bytes += characterBytes;
    end += character.length;
  }
  return value.slice(0, end);
}
