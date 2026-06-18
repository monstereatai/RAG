import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  MilvusClient,
  DataType,
  MetricType,
  IndexType,
} from '@zilliz/milvus2-sdk-node';
import { EmbeddingProvider } from '../../providers/embedding/embedding.provider';
import {
  buildFewShotExampleEntries,
  type FewShotExampleEntry,
} from '../prompts/few-shot.examples';

/**
 * 语义示例选择器
 *
 * 基于 Milvus 向量相似度检索，从示例库中动态挑选与当前 query 最相关的 few-shot 示例。
 * 对齐 agent-course/prompt-template-test/src/example-selector2.mjs 的 SemanticSimilarityExampleSelector 模式。
 *
 * 流程：
 * 1. 启动时：将 few-shot 示例 embed 后存入 `few_shot_examples` 集合（幂等，已有则跳过）
 * 2. 查询时：embed 当前 query → 在 Milvus 中检索 topK 条最相关示例 → 返回示例文本
 */
@Injectable()
export class SemanticExampleSelector implements OnModuleInit {
  private readonly logger = new Logger(SemanticExampleSelector.name);
  private client: MilvusClient | null = null;
  private readonly collectionName: string;
  private readonly dimension: number;
  private initialized = false;

  constructor(
    private readonly config: ConfigService,
    private readonly embeddingProvider: EmbeddingProvider,
  ) {
    this.collectionName =
      this.config.get<string>('vectorStore.milvus.fewShotCollection') ??
      'few_shot_examples';
    this.dimension =
      this.config.get<number>('vectorStore.milvus.dimension') ?? 1024;
  }

  async onModuleInit(): Promise<void> {
    const host =
      this.config.get<string>('vectorStore.milvus.host') ?? 'localhost';
    const port = this.config.get<number>('vectorStore.milvus.port') ?? 19530;

    try {
      this.client = new MilvusClient({
        address: `${host}:${port}`,
      });
      await this.client.connectPromise;

      await this.ensureCollection();
      await this.seedExamples();

      this.initialized = true;
      this.logger.log(
        `SemanticExampleSelector ready, collection=${this.collectionName}`,
      );
    } catch (err) {
      this.logger.warn(
        `SemanticExampleSelector init failed: ${(err as Error).message}. ` +
          'Falling back to static few-shot examples.',
      );
    }
  }

  /**
   * 选择与 query 最相关的 k 条 few-shot 示例
   *
   * @param query 当前用户问题
   * @param k 返回示例数量（默认 2）
   * @param task 可选过滤任务类型
   * @returns 示例文本列表（用于注入 prompt）
   */
  async select(
    query: string,
    k = 2,
    task?: 'query_augment' | 'answer_generation' | 'reflection',
  ): Promise<string[]> {
    if (!this.initialized || !this.client) {
      return [];
    }

    try {
      const queryVector = await this.embeddingProvider.embedQuery(query);

      const expr = task ? `task == "${task}"` : undefined;

      const searchResult = await this.client.search({
        collection_name: this.collectionName,
        vector: queryVector,
        limit: k,
        metric_type: MetricType.COSINE,
        output_fields: ['text', 'task'],
        expr,
      });

      return (searchResult.results as Array<Record<string, unknown>>)
        .filter((hit) => typeof hit['text'] === 'string')
        .map((hit) => hit['text'] as string);
    } catch (err) {
      this.logger.warn(
        `SemanticExampleSelector.select failed: ${(err as Error).message}`,
      );
      return [];
    }
  }

  /**
   * 选择示例并格式化为可直接注入 prompt 的文本块
   */
  async selectAndFormat(
    query: string,
    k = 2,
    task?: 'query_augment' | 'answer_generation' | 'reflection',
  ): Promise<string> {
    const examples = await this.select(query, k, task);
    if (examples.length === 0) {
      return '';
    }

    const header =
      task === 'query_augment'
        ? '以下是查询扩展的参考示例：'
        : task === 'answer_generation'
          ? '以下是答案生成的参考示例：'
          : task === 'reflection'
            ? '以下是反思评估的参考示例：'
            : '以下是相关参考示例：';

    return `${header}\n${examples.map((ex, i) => `示例 ${i + 1}：\n${ex}`).join('\n\n')}`;
  }

  /**
   * 检查集合是否存在
   */
  private async ensureCollection(): Promise<void> {
    if (!this.client) return;

    const has = await this.client.hasCollection({
      collection_name: this.collectionName,
    });

    if (has.value) {
      // 集合已存在，直接加载
      await this.client.loadCollection({
        collection_name: this.collectionName,
      });
      this.logger.log(`Collection ${this.collectionName} loaded`);
      return;
    }

    this.logger.log(`Creating collection ${this.collectionName}...`);
    await this.client.createCollection({
      collection_name: this.collectionName,
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
          name: 'text',
          data_type: DataType.VarChar,
          max_length: 4096,
        },
        {
          name: 'task',
          data_type: DataType.VarChar,
          max_length: 32,
        },
      ],
    });

    await this.client.createIndex({
      collection_name: this.collectionName,
      field_name: 'vector',
      index_type: IndexType.IVF_FLAT,
      metric_type: MetricType.COSINE,
      params: { nlist: 128 },
    });

    await this.client.loadCollection({ collection_name: this.collectionName });
    this.logger.log(`Collection ${this.collectionName} created`);
  }

  /**
   * 将内置的 few-shot 示例 embed 后存入 Milvus（幂等：检查数量是否一致）
   */
  private async seedExamples(): Promise<void> {
    if (!this.client) return;

    const entries = buildFewShotExampleEntries();

    // 检查已有数据量
    const stats = await this.client.getCollectionStatistics({
      collection_name: this.collectionName,
    });
    const existingCount = Number(stats.data.row_count ?? 0);

    if (existingCount >= entries.length) {
      this.logger.log(
        `Collection already has ${existingCount} examples (>= ${entries.length}), skip seeding`,
      );
      return;
    }

    // 清空旧数据并重新写入
    if (existingCount > 0) {
      await this.client.deleteEntities({
        collection_name: this.collectionName,
        expr: 'id != ""',
      });
    }

    this.logger.log(`Embedding ${entries.length} few-shot examples...`);

    // 批量 embed
    const texts = entries.map((e) => e.text);
    const vectors = await this.embeddingProvider.embedDocuments(texts);

    const data = entries.map((entry, i) => ({
      id: randomUUID().slice(0, 32),
      vector: vectors[i],
      text: entry.text,
      task: entry.task,
    }));

    await this.client.insert({
      collection_name: this.collectionName,
      data,
    });

    await this.client.flushSync({ collection_names: [this.collectionName] });
    this.logger.log(`Seeded ${entries.length} few-shot examples into Milvus`);
  }
}
