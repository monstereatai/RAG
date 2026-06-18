import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MilvusClient,
  DataType,
  MetricType,
  IndexType,
} from '@zilliz/milvus2-sdk-node';
import {
  IVectorStoreProvider,
  VectorRecord,
  VectorSearchHit,
} from './vector-store-provider.interface';

/**
 * Milvus VectorStore Provider
 * 集合 schema：id(主键) / vector / content / doc_id / chunk_index
 */
@Injectable()
export class MilvusVectorStoreProvider
  implements IVectorStoreProvider, OnModuleInit
{
  private readonly logger = new Logger(MilvusVectorStoreProvider.name);
  private client!: MilvusClient;
  private readonly collection: string;
  private readonly dimension: number;
  private readonly host: string;
  private readonly port: number;

  constructor(private readonly config: ConfigService) {
    this.host =
      this.config.get<string>('vectorStore.milvus.host') ?? 'localhost';
    this.port = this.config.get<number>('vectorStore.milvus.port') ?? 19530;
    this.collection =
      this.config.get<string>('vectorStore.milvus.collection') ?? 'rag_chunks';
    this.dimension =
      this.config.get<number>('vectorStore.milvus.dimension') ?? 1024;
  }

  async onModuleInit(): Promise<void> {
    // 对齐 agent-course/milvus-test 参考实现：不设 timeout，让 Milvus 自行管理
    this.client = new MilvusClient({
      address: `${this.host}:${this.port}`,
    });
    try {
      await this.client.connectPromise;
      this.logger.log(`Milvus connected at ${this.host}:${this.port}`);
      await this.ensureCollection();
      // 预热：触发 Milvus 加载索引到内存，避免首次 search 超时
      await this.warmup();
    } catch (err) {
      // Milvus 连接失败不阻断服务启动，相关接口调用时会抛错
      this.logger.error(
        `Milvus connection failed at ${this.host}:${this.port}: ${(err as Error).message}`,
      );
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
      });
      this.logger.log('Milvus warmup search done');
    } catch (err) {
      this.logger.warn(`Milvus warmup failed: ${(err as Error).message}`);
    }
  }

  async ensureCollection(): Promise<void> {
    const has = await this.client.hasCollection({
      collection_name: this.collection,
    });
    if (has.value) {
      this.logger.log(`Collection ${this.collection} already exists`);
      // 对齐 agent-course/milvus-test 参考实现：查询前 loadCollection（已加载会忽略错误）
      // Milvus 重启后 collection 需要重新 load 到内存才能 search
      await this.client.loadCollection({ collection_name: this.collection });
      this.logger.log(`Collection ${this.collection} loaded`);
      return;
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
      ],
    });

    await this.client.createIndex({
      collection_name: this.collection,
      field_name: 'vector',
      index_type: IndexType.IVF_FLAT,
      metric_type: MetricType.COSINE,
      params: { nlist: 1024 },
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
  ): Promise<VectorSearchHit[]> {
    // 对齐 agent-course/milvus-test 参考实现：不传 params（nprobe），使用 IVF_FLAT 默认参数
    const searchResult = await this.client.search({
      collection_name: this.collection,
      vector: queryVector,
      limit: k,
      metric_type: MetricType.COSINE,
      output_fields: ['id', 'content', 'doc_id', 'chunk_index'],
    });

    return searchResult.results.map((hit) => ({
      id: String(hit.id),
      content: String(hit.content ?? ''),
      docId: String(hit.doc_id ?? ''),
      chunkIndex: Number(hit.chunk_index ?? 0),
      score: Number(hit.score ?? 0),
    }));
  }

  async deleteByDocId(docId: string): Promise<void> {
    await this.client.deleteEntities({
      collection_name: this.collection,
      expr: `doc_id == "${docId}"`,
    });
    this.logger.log(`Deleted chunks for doc_id=${docId}`);
  }
}
