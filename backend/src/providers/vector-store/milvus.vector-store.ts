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
  VectorIndexInfo,
  VectorRecord,
  VectorSearchHit,
  VectorStoreRuntimeStatus,
} from './vector-store-provider.interface';

/**
 * Milvus VectorStore Provider
 * 集合 schema：id(主键) / vector / content / doc_id / chunk_index
 * 图片集合 schema（rag_images）：id(主键) / vector / doc_id / user_id / url / meta
 */
@Injectable()
export class MilvusVectorStoreProvider
  implements IVectorStoreProvider, OnModuleInit
{
  private readonly logger = new Logger(MilvusVectorStoreProvider.name);
  private client!: MilvusClient;
  private readonly collection: string;
  private readonly dimension: number;
  private readonly imageCollection: string;
  private readonly imageDimension: number;
  private readonly host: string;
  private readonly port: number;
  private readonly indexType: IndexType;
  private readonly hnswM: number;
  private readonly hnswEfConstruction: number;
  private readonly hnswEfSearch: number;
  private readonly searchTimeoutMs: number;
  private readonly deleteTimeoutMs: number;
  private readonly warmupTimeoutMs: number;
  private readonly circuitOpenMs: number;
  private readonly circuitFailureThreshold: number;
  private circuitOpenUntil = 0;
  private connected = false;
  private consecutiveFailures = 0;
  private lastFailureAt: Date | null = null;
  private lastFailureMessage: string | null = null;

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly dingTalk?: DingTalkProvider,
  ) {
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

  async onModuleInit(): Promise<void> {
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
          max_length: 8192,
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
    const data = records.map((r) => ({
      id: r.id,
      vector: r.vector,
      content: r.content,
      doc_id: r.docId,
      chunk_index: r.chunkIndex,
      user_id: r.userId ?? '',
    }));
    const result = await this.client.insert({
      collection_name: this.collection,
      data,
    });
    await this.client.flushSync({ collection_names: [this.collection] });
    this.logger.log(`Inserted ${result.insert_cnt} records`);
  }

  async similaritySearch(
    queryVector: number[],
    k: number,
    userId?: string,
  ): Promise<VectorSearchHit[]> {
    if (this.isCircuitOpen()) {
      throw new Error('Milvus similarity search circuit is open');
    }

    // 对齐 agent-course/milvus-test 参考实现：使用 HNSW 参数
    const searchParams = {
      collection_name: this.collection,
      vector: queryVector,
      limit: k,
      metric_type: MetricType.COSINE,
      params: this.getSearchParams(),
      output_fields: ['id', 'content', 'doc_id', 'chunk_index'],
      expr: userId ? `user_id == "${userId}"` : undefined,
      timeout: this.searchTimeoutMs,
    };

    let searchResult: Awaited<ReturnType<MilvusClient['search']>>;
    try {
      searchResult = await this.withTimeout(
        this.client.search(searchParams),
        this.searchTimeoutMs + 200,
        'Milvus similarity search',
      );
      this.recordSuccess();
    } catch (err) {
      this.recordFailure(err);
      throw err;
    }

    return (searchResult.results as Array<Record<string, unknown>>).map(
      (hit) => ({
        id:
          typeof hit['id'] === 'string' || typeof hit['id'] === 'number'
            ? String(hit['id'])
            : '',
        content: typeof hit['content'] === 'string' ? hit['content'] : '',
        docId:
          typeof hit['doc_id'] === 'string' || typeof hit['doc_id'] === 'number'
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
    );
  }

  async deleteByDocId(docId: string): Promise<void> {
    try {
      await this.withTimeout(
        this.client.deleteEntities({
          collection_name: this.collection,
          filter: 'doc_id == $docId',
          exprValues: { docId },
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
    const filters = ['doc_id == $docId'];
    const exprValues: Record<string, string> = { docId };
    if (userId) {
      filters.push('user_id == $userId');
      exprValues.userId = userId;
    }
    try {
      const result = await this.withTimeout(
        this.client.query({
          collection_name: this.collection,
          filter: filters.join(' && '),
          exprValues,
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

  getIndexInfo(): VectorIndexInfo {
    return {
      provider: 'milvus',
      collection: this.collection,
      dimension: this.dimension,
      indexType: this.indexType,
      metricType: MetricType.COSINE,
      params: {
        M: this.hnswM,
        efConstruction: this.hnswEfConstruction,
        ef: this.hnswEfSearch,
        searchTimeoutMs: this.searchTimeoutMs,
        deleteTimeoutMs: this.deleteTimeoutMs,
        warmupTimeoutMs: this.warmupTimeoutMs,
        circuitOpenMs: this.circuitOpenMs,
        circuitFailureThreshold: this.circuitFailureThreshold,
      },
    };
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
  ): Promise<ImageSearchHit[]> {
    if (this.isCircuitOpen()) {
      throw new Error('Milvus image search circuit is open');
    }

    const searchParams = {
      collection_name: this.imageCollection,
      vector: queryVector,
      limit: k,
      metric_type: MetricType.COSINE,
      params: this.getSearchParams(),
      output_fields: ['id', 'doc_id', 'user_id', 'url', 'meta'],
      expr: userId ? `user_id == "${userId}"` : undefined,
      timeout: this.searchTimeoutMs,
    };

    let searchResult: Awaited<ReturnType<MilvusClient['search']>>;
    try {
      searchResult = await this.withTimeout(
        this.client.search(searchParams),
        this.searchTimeoutMs + 200,
        'Milvus image search',
      );
      this.recordSuccess();
    } catch (err) {
      this.recordFailure(err);
      throw err;
    }

    return (searchResult.results as Array<Record<string, unknown>>).map(
      (hit) => ({
        id:
          typeof hit['id'] === 'string' || typeof hit['id'] === 'number'
            ? String(hit['id'])
            : '',
        docId:
          typeof hit['doc_id'] === 'string' || typeof hit['doc_id'] === 'number'
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
    );
  }

  async deleteImagesByDocId(docId: string, userId?: string): Promise<void> {
    try {
      await this.withTimeout(
        this.client.deleteEntities({
          collection_name: this.imageCollection,
          filter:
            userId !== undefined
              ? 'doc_id == $docId && user_id == $userId'
              : 'doc_id == $docId',
          exprValues: userId !== undefined ? { docId, userId } : { docId },
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

  getImageCollectionInfo(): {
    collection: string;
    dimension: number;
    indexType: IndexType;
  } {
    return {
      collection: this.imageCollection,
      dimension: this.imageDimension,
      indexType: this.indexType,
    };
  }

  getRuntimeStatus(): VectorStoreRuntimeStatus {
    const circuitState = this.getCircuitState();
    const available = this.connected && circuitState !== 'open';
    const status = !this.connected
      ? 'unavailable'
      : circuitState === 'open' || this.consecutiveFailures > 0
        ? 'degraded'
        : 'healthy';

    return {
      status,
      available,
      circuitState,
      consecutiveFailures: this.consecutiveFailures,
      lastFailureAt: this.lastFailureAt?.toISOString() ?? null,
      lastFailureMessage: this.lastFailureMessage,
      circuitOpenUntil:
        this.circuitOpenUntil > Date.now()
          ? new Date(this.circuitOpenUntil).toISOString()
          : null,
    };
  }

  private resolveIndexType(value: string): IndexType {
    const normalized = value.trim().toUpperCase();
    if (normalized === 'HNSW') {
      return IndexType.HNSW;
    }
    this.logger.warn(
      `Unsupported MILVUS_INDEX_TYPE="${value}", fallback to HNSW`,
    );
    return IndexType.HNSW;
  }

  private getCreateIndexParams(): Record<string, number> {
    return {
      M: this.hnswM,
      efConstruction: this.hnswEfConstruction,
    };
  }

  private getSearchParams(): Record<string, number> {
    return { ef: this.hnswEfSearch };
  }

  private isCircuitOpen(): boolean {
    return Date.now() < this.circuitOpenUntil;
  }

  private getCircuitState(): 'closed' | 'open' | 'half_open' {
    if (this.circuitOpenUntil === 0) return 'closed';
    return this.isCircuitOpen() ? 'open' : 'half_open';
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitOpenUntil = 0;
  }

  private recordFailure(err: unknown): void {
    this.consecutiveFailures += 1;
    this.lastFailureAt = new Date();
    this.lastFailureMessage = this.formatErrorMessage(err);
    if (this.consecutiveFailures >= this.circuitFailureThreshold) {
      this.openCircuit();
    }
  }

  private formatErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    if (err === null || err === undefined) return 'unknown error';
    try {
      return JSON.stringify(err);
    } catch {
      return 'unserializable error';
    }
  }

  private openCircuit(): void {
    this.circuitOpenUntil = Date.now() + this.circuitOpenMs;
    // 钉钉告警（fire-and-forget，节流窗口内同 key 只发一次）
    void this.dingTalk?.notifyAlert(
      'milvus.circuit',
      `**Milvus 熔断打开**（连续失败 ${this.consecutiveFailures} 次，暂停 ${this.circuitOpenMs}ms）\n\n最近错误：${this.lastFailureMessage ?? 'unknown'}`,
    );
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
