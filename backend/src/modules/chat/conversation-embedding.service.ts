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

/**
 * 对话历史向量化服务
 *
 * 将对话 QA 对嵌入 Milvus 向量库，使 RAG 系统能检索过去的对话作为上下文。
 * 当用户提出与历史对话相关的问题时，系统可以召回相关历史对话。
 *
 * 参考实现：agent-course/milvus-test 的向量存储模式
 */
@Injectable()
export class ConversationEmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(ConversationEmbeddingService.name);
  private client: MilvusClient | null = null;
  private readonly collectionName: string;
  private readonly dimension: number;
  private initialized = false;
  private readonly searchTimeoutMs = 500;
  private readonly deleteTimeoutMs = 800;
  private circuitOpenUntil = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly embeddingProvider: EmbeddingProvider,
  ) {
    this.collectionName =
      this.config.get<string>('vectorStore.milvus.conversationCollection') ??
      'conversation_chunks_v2';
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
      this.initialized = true;
      this.logger.log(
        `ConversationEmbeddingService ready, collection=${this.collectionName}`,
      );
    } catch (err) {
      this.logger.warn(
        `ConversationEmbeddingService init failed: ${(err as Error).message}. ` +
          'Conversation history search will be disabled.',
      );
    }
  }

  /**
   * 存储对话 QA 对到向量库
   *
   * @param threadId 对话 ID
   * @param query 用户问题
   * @param answer AI 回答
   * @param userId 用户 ID（多租户隔离）
   */
  async indexConversation(
    threadId: string,
    query: string,
    answer: string,
    userId?: string,
  ): Promise<void> {
    if (!this.initialized || !this.client) {
      return;
    }

    try {
      // 将问题和答案拼接为一段文本进行向量化
      const content = `Q: ${query}\nA: ${answer.slice(0, 500)}`;
      const vector = await this.embeddingProvider.embedQuery(content);
      const createdAt = Date.now();
      const queryKey = this.normalizeQueryKey(query);

      // 同一会话中的同一问题采用“最新写入覆盖”语义，避免旧答案继续参与历史召回。
      await this.withTimeout(
        this.client.deleteEntities({
          collection_name: this.collectionName,
          filter: 'thread_id == $threadId && query_key == $queryKey',
          exprValues: { threadId, queryKey },
          timeout: this.deleteTimeoutMs,
        }),
        this.deleteTimeoutMs + 200,
        'Conversation history supersede',
      );

      await this.client.insert({
        collection_name: this.collectionName,
        data: [
          {
            id: randomUUID().slice(0, 32),
            vector,
            content,
            thread_id: threadId,
            query: query.slice(0, 500),
            query_key: queryKey,
            created_at: createdAt,
            version: createdAt,
            user_id: userId ?? '',
          },
        ],
      });

      await this.client.flushSync({ collection_names: [this.collectionName] });
      this.logger.log(
        `Indexed conversation: threadId=${threadId}, userId=${userId ?? 'none'}`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to index conversation: ${(err as Error).message}`,
      );
    }
  }

  /**
   * 检索与当前查询相关的历史对话
   *
   * @param query 当前用户问题
   * @param k 返回的历史对话数量（默认 3）
   * @param userId 用户 ID（多租户隔离）
   * @returns 历史对话内容列表
   */
  async searchHistory(
    query: string,
    k = 3,
    userId?: string,
  ): Promise<Array<{ content: string; threadId: string; score: number }>> {
    if (!this.initialized || !this.client || this.isCircuitOpen()) {
      return [];
    }

    try {
      const queryVector = await this.embeddingProvider.embedQuery(query);

      const searchResult = await this.withTimeout(
        this.client.search({
          collection_name: this.collectionName,
          vector: queryVector,
          // 先扩大候选集，再叠加时间衰减，避免旧记录仅因语义相似度略高而压过新记录。
          limit: Math.max(k * 4, 10),
          metric_type: MetricType.COSINE,
          params: { ef: 64 },
          output_fields: ['content', 'thread_id', 'query', 'created_at'],
          expr: userId ? `user_id == "${userId}"` : undefined,
          timeout: this.searchTimeoutMs,
        }),
        this.searchTimeoutMs + 200,
        'Conversation history search',
      );

      const now = Date.now();
      return (searchResult.results as Array<Record<string, unknown>>)
        .filter((hit) => typeof hit['content'] === 'string')
        .map((hit) => {
          const semanticScore =
            typeof hit['score'] === 'number'
              ? hit['score']
              : Number(hit['score'] ?? 0);
          const createdAt = Number(hit['created_at'] ?? 0);
          const ageDays =
            createdAt > 0 ? Math.max(0, (now - createdAt) / 86_400_000) : 365;
          const recencyScore = Math.exp(-ageDays / 14);
          return {
            content: hit['content'] as string,
            threadId: (hit['thread_id'] as string) ?? '',
            score: semanticScore * 0.85 + recencyScore * 0.15,
            createdAt: createdAt > 0 ? new Date(createdAt).toISOString() : null,
          };
        })
        .sort((left, right) => right.score - left.score)
        .slice(0, k);
    } catch (err) {
      this.openCircuit();
      this.logger.warn(`Failed to search history: ${(err as Error).message}`);
      return [];
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

  /**
   * 格式化历史对话为上下文文本块
   */
  formatHistoryContext(
    history: Array<{ content: string; threadId: string; score: number }>,
  ): string {
    if (history.length === 0) {
      return '';
    }

    return `【相关历史对话】\n${history
      .map(
        (h, i) =>
          `历史 ${i + 1}（相关度: ${h.score.toFixed(2)}）:\n${h.content}`,
      )
      .join('\n\n')}`;
  }

  /**
   * 删除指定对话的历史向量
   */
  async deleteByThreadId(threadId: string): Promise<void> {
    if (!this.initialized || !this.client || this.isCircuitOpen()) {
      return;
    }

    try {
      await this.withTimeout(
        this.client.deleteEntities({
          collection_name: this.collectionName,
          filter: 'thread_id == $threadId',
          exprValues: { threadId },
          timeout: this.deleteTimeoutMs,
        }),
        this.deleteTimeoutMs + 200,
        'Conversation history delete',
      );
      this.logger.log(`Deleted conversation chunks for threadId=${threadId}`);
    } catch (err) {
      this.openCircuit();
      this.logger.warn(
        `Failed to delete conversation chunks: ${(err as Error).message}`,
      );
    }
  }

  private isCircuitOpen(): boolean {
    return Date.now() < this.circuitOpenUntil;
  }

  private openCircuit(): void {
    this.circuitOpenUntil = Date.now() + 30_000;
  }

  private normalizeQueryKey(query: string): string {
    return query.trim().toLocaleLowerCase().replace(/\s+/gu, ' ').slice(0, 500);
  }

  /**
   * 检查集合是否存在并创建
   */
  private async ensureCollection(): Promise<void> {
    if (!this.client) return;

    const has = await this.client.hasCollection({
      collection_name: this.collectionName,
    });

    if (has.value) {
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
          name: 'content',
          data_type: DataType.VarChar,
          max_length: 4096,
        },
        {
          name: 'thread_id',
          data_type: DataType.VarChar,
          max_length: 64,
        },
        {
          name: 'query',
          data_type: DataType.VarChar,
          max_length: 1024,
        },
        {
          name: 'query_key',
          data_type: DataType.VarChar,
          max_length: 512,
        },
        {
          name: 'created_at',
          data_type: DataType.Int64,
        },
        {
          name: 'version',
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
      collection_name: this.collectionName,
      field_name: 'vector',
      index_type: IndexType.HNSW,
      metric_type: MetricType.COSINE,
      params: { M: 16, efConstruction: 200 },
    });

    await this.client.loadCollection({ collection_name: this.collectionName });
    this.logger.log(`Collection ${this.collectionName} created`);
  }
}
