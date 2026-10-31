import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MilvusClient,
  DataType,
  MetricType,
  IndexType,
  ConsistencyLevelEnum,
} from '@zilliz/milvus2-sdk-node';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EmbeddingProvider } from '../../providers/embedding/embedding.provider';
import { ConversationEntity } from '../../providers/db/entities/conversation.entity';
import { MessageEntity } from '../../providers/db/entities/message.entity';
import { DomainEventOutboxEntity } from '../../providers/db/entities/domain-event-outbox.entity';
import { DomainEventsService } from '../domain-events/domain-events.service';

const CONVERSATION_TURN_COMPLETED_EVENT = 'conversation.turn.completed';
const MESSAGE_META_PREFIX = '<!-- rag-message-meta:';
const MESSAGE_META_SUFFIX = ' -->';
const HISTORY_QUERY_BATCH_SIZE = 256;
const HISTORY_QUERY_GROUPS_PER_BATCH = 8;

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  if (!value || typeof value !== 'object') return false;
  const iteratorMethod: unknown = Reflect.get(value, Symbol.asyncIterator);
  return typeof iteratorMethod === 'function';
}

interface ConversationHistoryGroup {
  threadId: string;
  queryKey: string;
}

interface ConversationHistoryVectorRecord extends Record<string, unknown> {
  id: string;
  thread_id: string;
  query_key: string;
  content: string;
  created_at: number | string;
  version: number | string;
  vector: number[];
}

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
  private initializing?: Promise<void>;

  constructor(
    private readonly config: ConfigService,
    private readonly embeddingProvider: EmbeddingProvider,
    @InjectRepository(ConversationEntity)
    private readonly conversationRepository: Repository<ConversationEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepository: Repository<MessageEntity>,
    private readonly domainEvents: DomainEventsService,
  ) {
    this.collectionName =
      this.config.get<string>('vectorStore.milvus.conversationCollection') ??
      'conversation_chunks_v2';
    this.dimension =
      this.config.get<number>('vectorStore.milvus.dimension') ?? 1024;
    this.domainEvents.registerInternalHandler(
      CONVERSATION_TURN_COMPLETED_EVENT,
      (event) => this.handleConversationTurnCompleted(event),
    );
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureInitialized();
    } catch (err) {
      this.logger.warn(
        `ConversationEmbeddingService init failed: ${(err as Error).message}. ` +
          'Conversation history search will be disabled until an indexing retry reconnects.',
      );
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized && this.client) return;
    if (this.initializing) return this.initializing;

    const initialization = (async () => {
      const previousClient = this.client;
      this.client = null;
      this.initialized = false;
      if (previousClient) {
        await previousClient.closeConnection().catch(() => undefined);
      }

      const host =
        this.config.get<string>('vectorStore.milvus.host') ?? 'localhost';
      const port = this.config.get<number>('vectorStore.milvus.port') ?? 19530;
      const client = new MilvusClient({ address: `${host}:${port}` });
      this.client = client;

      try {
        await client.connectPromise;
        await this.ensureCollection();
        this.initialized = true;
        this.logger.log(
          `ConversationEmbeddingService ready, collection=${this.collectionName}`,
        );
      } catch (error) {
        this.client = null;
        await client.closeConnection().catch(() => undefined);
        throw error;
      }
    })();
    this.initializing = initialization;
    try {
      await initialization;
    } finally {
      if (this.initializing === initialization) this.initializing = undefined;
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
    answerCreatedAt = new Date(),
    assistantMessageId?: string,
  ): Promise<void> {
    await this.ensureInitialized();
    const client = this.client;
    if (!client)
      throw new Error('Milvus conversation vector store is unavailable.');

    try {
      const id = assistantMessageId?.trim() ?? '';
      if (!id || id.length > 64) {
        throw new Error(
          'Conversation history requires a valid assistant message ID.',
        );
      }

      const content = `Q: ${query}\nA: ${answer.slice(0, 500)}`;
      const vector = await this.embeddingProvider.embedQuery(content);
      const queryKey = this.normalizeQueryKey(query);
      const timestamp = answerCreatedAt.getTime();
      if (!Number.isFinite(timestamp)) {
        throw new Error('Conversation history answer timestamp is invalid.');
      }

      const upsertResult = await this.withTimeout(
        // Replays of one outbox event upsert the same immutable assistant-message record.
        client.upsert({
          collection_name: this.collectionName,
          data: [
            {
              id,
              vector,
              content,
              thread_id: threadId,
              query: query.slice(0, 500),
              query_key: queryKey,
              created_at: timestamp,
              version: timestamp,
              user_id: userId ?? '',
            },
          ],
        }),
        this.deleteTimeoutMs + 200,
        'Conversation history upsert',
      );
      this.assertMutationSucceeded(upsertResult, 'upsert');
      if (Number(upsertResult.upsert_cnt) !== 1) {
        throw new Error(
          `Milvus conversation upsert count mismatch: expected 1, received ${upsertResult.upsert_cnt}`,
        );
      }

      this.logger.log(
        `Indexed conversation: threadId=${threadId}, userId=${userId ?? 'none'}`,
      );
    } catch (err) {
      this.openCircuit();
      if (this.client === client) {
        this.client = null;
        this.initialized = false;
        await client.closeConnection().catch(() => undefined);
      }
      this.logger.warn(
        `Failed to index conversation: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  private async handleConversationTurnCompleted(
    event: DomainEventOutboxEntity,
  ): Promise<void> {
    const payload = this.parseEventPayload(event.payload);
    const userMessageId = payload.userMessageId;
    const assistantMessageId = payload.assistantMessageId;
    const threadId = event.aggregateId.trim();
    if (
      typeof userMessageId !== 'string' ||
      typeof assistantMessageId !== 'string' ||
      !threadId
    ) {
      throw new Error('Conversation turn event is missing message IDs.');
    }

    const [userMessage, assistantMessage, conversation] = await Promise.all([
      this.messageRepository.findOneBy({ id: userMessageId }),
      this.messageRepository.findOneBy({ id: assistantMessageId }),
      this.conversationRepository.findOneBy({ id: threadId }),
    ]);
    // A conversation deleted after this event was queued makes the turn stale.
    // The conversation.deleted outbox event owns vector cleanup in that case.
    if (!conversation) return;
    if (
      !userMessage ||
      !assistantMessage ||
      userMessage.conversationId !== threadId ||
      assistantMessage.conversationId !== threadId ||
      userMessage.role !== 'human' ||
      assistantMessage.role !== 'ai' ||
      (userMessage.tenantId || conversation.tenantId || 'legacy') !==
        (event.tenantId || 'legacy') ||
      (assistantMessage.tenantId || conversation.tenantId || 'legacy') !==
        (event.tenantId || 'legacy')
    ) {
      throw new Error('Conversation turn event references invalid messages.');
    }
    if ((conversation.tenantId || 'legacy') !== (event.tenantId || 'legacy')) {
      throw new Error(
        'Conversation turn event tenant does not match its messages.',
      );
    }

    await this.indexConversation(
      threadId,
      this.decodeStoredMessageContent(userMessage.content),
      this.decodeStoredMessageContent(assistantMessage.content),
      conversation.userId ?? undefined,
      assistantMessage.createdAt,
      assistantMessageId,
    );

    const stillExists = await this.conversationRepository.findOne({
      where: { id: threadId },
      select: { id: true },
    });
    if (!stillExists) {
      await this.deleteByThreadId(threadId);
    }
  }

  private parseEventPayload(value: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private decodeStoredMessageContent(content: string): string {
    const markerStart = content.lastIndexOf(MESSAGE_META_PREFIX);
    if (markerStart < 0 || !content.endsWith(MESSAGE_META_SUFFIX)) {
      return content;
    }
    return content.slice(0, markerStart).trimEnd();
  }

  private assertMutationSucceeded(
    result: {
      status: { error_code: string | number; reason: string; code?: number };
    },
    operation: string,
  ): void {
    const success =
      result.status.error_code === 'Success' ||
      Number(result.status.error_code) === 0 ||
      Number(result.status.code) === 0;
    if (!success) {
      throw new Error(
        `Milvus conversation ${operation} failed: ${result.status.reason || result.status.error_code}`,
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
    tenantId?: string,
  ): Promise<Array<{ content: string; threadId: string; score: number }>> {
    if (
      !userId?.trim() ||
      !this.initialized ||
      !this.client ||
      this.isCircuitOpen()
    ) {
      return [];
    }

    try {
      const client = this.client;
      if (!client) return [];
      const queryVector = await this.embeddingProvider.embedQuery(query);

      const searchResult = await this.withTimeout(
        client.search({
          collection_name: this.collectionName,
          vector: queryVector,
          // 先扩大候选集，再叠加时间衰减，避免旧记录仅因语义相似度略高而压过新记录。
          limit: Math.max(k * 10, 50),
          metric_type: MetricType.COSINE,
          params: { ef: 64 },
          consistency_level: ConsistencyLevelEnum.Strong,
          output_fields: ['thread_id', 'query', 'query_key'],
          expr: `user_id == "${escapeMilvusString(userId.trim())}"`,
          timeout: this.searchTimeoutMs,
        }),
        this.searchTimeoutMs + 200,
        'Conversation history search',
      );

      const groups = new Map<string, ConversationHistoryGroup>();
      for (const hit of searchResult.results as Array<
        Record<string, unknown>
      >) {
        const threadId =
          typeof hit['thread_id'] === 'string' ? hit['thread_id'] : '';
        const query = typeof hit['query'] === 'string' ? hit['query'] : '';
        const storedQueryKey =
          typeof hit['query_key'] === 'string' ? hit['query_key'] : '';
        const queryKey = storedQueryKey || this.normalizeQueryKey(query);
        if (!threadId || !queryKey) continue;
        groups.set(this.historyGroupKey(threadId, queryKey), {
          threadId,
          queryKey,
        });
      }
      if (groups.size === 0) return [];

      // ANN 只负责找出可能相关的 query 组；每组再走完整标量分页，避免在 topK 中挑旧版本。
      const latest = await this.readLatestHistoryRecords(
        client,
        [...groups.values()],
        userId.trim(),
      );
      const latestIds = [...latest.values()].map((record) => record.id);
      if (latestIds.length === 0) return [];

      const latestEntitiesResult = await this.withTimeout(
        client.get({
          collection_name: this.collectionName,
          ids: latestIds,
          output_fields: [
            'id',
            'content',
            'thread_id',
            'query_key',
            'created_at',
            'version',
            'user_id',
            'vector',
          ],
          consistency_level: ConsistencyLevelEnum.Strong,
        }),
        this.searchTimeoutMs + 500,
        'Latest conversation history fetch',
      );
      this.assertMutationSucceeded(
        latestEntitiesResult,
        'latest version fetch',
      );

      const now = Date.now();
      const candidates = latestEntitiesResult.data
        .filter(
          (record): record is ConversationHistoryVectorRecord =>
            typeof record['id'] === 'string' &&
            typeof record['thread_id'] === 'string' &&
            typeof record['query_key'] === 'string' &&
            typeof record['content'] === 'string' &&
            Array.isArray(record['vector']),
        )
        .map((record) => {
          const createdAt = Number(record.created_at ?? record.version ?? 0);
          const ageDays =
            createdAt > 0 ? Math.max(0, (now - createdAt) / 86_400_000) : 365;
          const recencyScore = Math.exp(-ageDays / 14);
          const semanticScore = this.cosineSimilarity(
            queryVector,
            record.vector,
          );
          return {
            content: record.content,
            threadId: record.thread_id,
            score: semanticScore * 0.85 + recencyScore * 0.15,
          };
        })
        .sort((left, right) => right.score - left.score);

      if (candidates.length === 0) return [];

      // Milvus 不存租户列；以 PostgreSQL 当前存活会话作为最终归属校验，隔离旧索引和跨租户候选。
      const liveConversations = await this.conversationRepository.find({
        select: { id: true },
        where: {
          id: In([...new Set(candidates.map((hit) => hit.threadId))]),
          userId: userId.trim(),
          ...(tenantId?.trim() ? { tenantId: tenantId.trim() } : {}),
        },
      });
      const liveThreadIds = new Set(liveConversations.map(({ id }) => id));

      return candidates
        .filter((hit) => liveThreadIds.has(hit.threadId))
        .slice(0, k);
    } catch (err) {
      this.openCircuit();
      this.logger.warn(`Failed to search history: ${(err as Error).message}`);
      return [];
    }
  }

  private async readLatestHistoryRecords(
    client: MilvusClient,
    groups: ConversationHistoryGroup[],
    userId: string,
  ): Promise<Map<string, { id: string; createdAt: number; version: number }>> {
    const latest = new Map<
      string,
      { id: string; createdAt: number; version: number }
    >();
    const batches: ConversationHistoryGroup[][] = [];
    for (
      let index = 0;
      index < groups.length;
      index += HISTORY_QUERY_GROUPS_PER_BATCH
    ) {
      batches.push(groups.slice(index, index + HISTORY_QUERY_GROUPS_PER_BATCH));
    }

    await Promise.all(
      batches.map(async (batch) => {
        const expression = batch
          .map(
            ({ threadId, queryKey }) =>
              `(thread_id == ${this.quoteMilvusString(threadId)} && ` +
              `query_key == ${this.quoteMilvusString(queryKey)} && ` +
              `user_id == ${this.quoteMilvusString(userId)})`,
          )
          .join(' || ');

        const countBefore = await this.countHistoryRecords(client, expression);
        const iterator: unknown = await client.queryIterator({
          collection_name: this.collectionName,
          expr: expression,
          output_fields: [
            'id',
            'thread_id',
            'query_key',
            'created_at',
            'version',
          ],
          batchSize: HISTORY_QUERY_BATCH_SIZE,
          consistency_level: ConsistencyLevelEnum.Strong,
        });
        if (!isAsyncIterable(iterator)) {
          throw new Error(
            'Milvus conversation history query did not return an async iterator.',
          );
        }
        let iteratedCount = 0;
        for await (const page of iterator) {
          if (!Array.isArray(page)) {
            throw new Error(
              'Milvus conversation history iterator returned an invalid page.',
            );
          }
          iteratedCount += page.length;
          for (const value of page) {
            if (!value || typeof value !== 'object') continue;
            const record = value as Record<string, unknown>;
            const id = typeof record['id'] === 'string' ? record['id'] : '';
            const threadId =
              typeof record['thread_id'] === 'string'
                ? record['thread_id']
                : '';
            const queryKey =
              typeof record['query_key'] === 'string'
                ? record['query_key']
                : '';
            if (!id || !threadId || !queryKey) continue;

            const groupKey = this.historyGroupKey(threadId, queryKey);
            const createdAt = Number(record['created_at'] ?? 0);
            const version = Number(record['version'] ?? createdAt);
            const existing = latest.get(groupKey);
            if (
              !existing ||
              version > existing.version ||
              (version === existing.version &&
                (createdAt > existing.createdAt ||
                  (createdAt === existing.createdAt && id > existing.id)))
            ) {
              latest.set(groupKey, { id, createdAt, version });
            }
          }
        }

        const countAfter = await this.countHistoryRecords(client, expression);
        if (iteratedCount !== countBefore || countAfter !== countBefore) {
          throw new Error(
            `Milvus conversation history changed or was incompletely paged during latest-version lookup (before=${countBefore}, iterated=${iteratedCount}, after=${countAfter}).`,
          );
        }
      }),
    );

    return latest;
  }

  private async countHistoryRecords(
    client: MilvusClient,
    expression: string,
  ): Promise<number> {
    const result = await this.withTimeout(
      client.query({
        collection_name: this.collectionName,
        expr: expression,
        output_fields: ['count(*)'],
        consistency_level: ConsistencyLevelEnum.Strong,
      }),
      this.searchTimeoutMs + 500,
      'Conversation history version count',
    );
    this.assertMutationSucceeded(result, 'version count');
    const count = Number(result.data[0]?.['count(*)']);
    if (!Number.isFinite(count) || count < 0) {
      throw new Error('Milvus conversation history count is invalid.');
    }
    return count;
  }

  private historyGroupKey(threadId: string, queryKey: string): string {
    return JSON.stringify([threadId, queryKey]);
  }

  private quoteMilvusString(value: string): string {
    return `"${value
      .replace(/\\/gu, '\\\\')
      .replace(/"/gu, '\\"')
      .replace(/\n/gu, '\\n')
      .replace(/\r/gu, '\\r')
      .replace(/\t/gu, '\\t')}"`;
  }

  private cosineSimilarity(left: number[], right: number[]): number {
    if (left.length === 0 || left.length !== right.length) return 0;
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let index = 0; index < left.length; index += 1) {
      const leftValue = Number(left[index]);
      const rightValue = Number(right[index]);
      if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) return 0;
      dot += leftValue * rightValue;
      leftNorm += leftValue * leftValue;
      rightNorm += rightValue * rightValue;
    }
    if (leftNorm === 0 || rightNorm === 0) return 0;
    return dot / Math.sqrt(leftNorm * rightNorm);
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
    let client: MilvusClient | null = null;
    try {
      await this.ensureInitialized();
      client = this.client;
      if (!client) throw new Error('Conversation vector store is unavailable.');

      const result = await this.withTimeout(
        client.deleteEntities({
          collection_name: this.collectionName,
          filter: `thread_id == "${escapeMilvusString(threadId)}"`,
          timeout: this.deleteTimeoutMs,
        }),
        this.deleteTimeoutMs + 200,
        'Conversation history delete',
      );
      this.assertMutationSucceeded(result, 'delete');
      this.logger.log(`Deleted conversation chunks for threadId=${threadId}`);
    } catch (err) {
      this.openCircuit();
      if (client && this.client === client) {
        this.client = null;
        this.initialized = false;
        await client.closeConnection().catch(() => undefined);
      }
      this.logger.warn(
        `Failed to delete conversation chunks: ${(err as Error).message}`,
      );
      throw err;
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

function escapeMilvusString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
