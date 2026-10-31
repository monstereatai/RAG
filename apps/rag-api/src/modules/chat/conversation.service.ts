import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { ConversationEntity } from '../../providers/db/entities/conversation.entity';
import { MessageEntity } from '../../providers/db/entities/message.entity';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { ShortTermMemoryService } from '../memory/short-term-memory.service';
import { MemoryService } from '../memory/memory.service';
import { ConversationEmbeddingService } from './conversation-embedding.service';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { DomainEventOutboxEntity } from '../../providers/db/entities/domain-event-outbox.entity';

export interface ConversationMessage {
  role: 'human' | 'ai';
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

const MESSAGE_META_PREFIX = '<!-- rag-message-meta:';
const MESSAGE_META_SUFFIX = ' -->';
const CONVERSATION_DELETED_EVENT = 'conversation.deleted';

function decodeMessage(raw: MessageEntity): ConversationMessage {
  const markerStart = raw.content.lastIndexOf(MESSAGE_META_PREFIX);
  if (markerStart < 0 || !raw.content.endsWith(MESSAGE_META_SUFFIX)) {
    return {
      role: raw.role as 'human' | 'ai',
      content: raw.content,
      createdAt: raw.createdAt.toISOString(),
    };
  }
  const encoded = raw.content.slice(
    markerStart + MESSAGE_META_PREFIX.length,
    -MESSAGE_META_SUFFIX.length,
  );
  try {
    const metadata = JSON.parse(
      Buffer.from(encoded, 'base64').toString('utf8'),
    ) as Record<string, unknown>;
    return {
      role: raw.role as 'human' | 'ai',
      content: raw.content.slice(0, markerStart).trimEnd(),
      createdAt: raw.createdAt.toISOString(),
      metadata,
    };
  } catch {
    return {
      role: raw.role as 'human' | 'ai',
      content: raw.content,
      createdAt: raw.createdAt.toISOString(),
    };
  }
}

export interface Conversation {
  threadId: string;
  title: string;
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

/**
 * 对话历史管理服务
 *
 * 集成：TypeORM 落库（PostgreSQL / MySQL 兼容） + Redis 缓存最近历史记录
 */
@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @InjectRepository(ConversationEntity)
    private readonly conversationRepo: Repository<ConversationEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: Repository<MessageEntity>,
    private readonly redisProvider: RedisProvider,
    private readonly shortTermMemory: ShortTermMemoryService,
    private readonly memoryService: MemoryService,
    private readonly conversationEmbedding: ConversationEmbeddingService,
    private readonly domainEvents: DomainEventsService,
  ) {
    this.domainEvents.registerInternalHandler(
      CONVERSATION_DELETED_EVENT,
      (event) => this.handleConversationDeleted(event),
    );
  }

  /** 在读取任何会话记忆前，先确认会话属于当前用户和租户。 */
  async assertAccessible(
    threadId: string,
    userId: string,
    tenantId?: string,
  ): Promise<void> {
    const where: { id: string; userId: string; tenantId?: string } = {
      id: threadId,
      userId,
    };
    if (tenantId?.trim()) where.tenantId = tenantId.trim();

    const conversation = await this.conversationRepo.findOne({
      where,
      select: { id: true },
    });
    if (!conversation) {
      throw new NotFoundException(`conversation ${threadId} not found`);
    }
  }

  /**
   * 创建新对话，返回 threadId
   */
  async create(
    firstQuery: string,
    mode = 'auto',
    userId?: string,
    tenantId?: string,
    threadId: string = randomUUID(),
  ): Promise<string> {
    const title = firstQuery.slice(0, 50);
    const conv = this.conversationRepo.create({
      id: threadId,
      title,
      mode,
      userId,
      tenantId: tenantId ?? 'legacy',
    });
    await this.conversationRepo.save(conv);
    this.logger.log(
      `New conversation created and saved to DB: threadId=${threadId}, userId=${userId ?? 'none'}`,
    );
    return threadId;
  }

  /**
   * 获取对话（带 Redis 缓存，与 userId 绑定，过期时间 30 分钟）
   */
  async get(
    threadId: string,
    userId?: string,
    tenantId?: string,
  ): Promise<Conversation | null> {
    const scopeKey = tenantId?.trim() || 'legacy';
    const cacheKey = userId
      ? `conv:messages:${scopeKey}:${userId}:${threadId}`
      : tenantId?.trim()
        ? `conv:messages:${scopeKey}:${threadId}`
        : `conv:messages:${threadId}`;

    if (this.redisProvider.isEnabled()) {
      const cached = await this.redisProvider.get(cacheKey);
      if (cached) {
        try {
          return JSON.parse(cached) as Conversation;
        } catch {
          // ignore
        }
      }
    }

    const where: { id: string; userId?: string; tenantId?: string } = {
      id: threadId,
    };
    if (userId) {
      where.userId = userId;
    }
    if (tenantId?.trim()) {
      where.tenantId = tenantId.trim();
    }

    const conv = await this.conversationRepo.findOne({ where });
    if (!conv) return null;

    const messages = await this.messageRepo.find({
      where: {
        conversationId: threadId,
        ...(tenantId?.trim() ? { tenantId: tenantId.trim() } : {}),
      },
      order: { createdAt: 'ASC' },
    });

    const conversation: Conversation = {
      threadId: conv.id,
      title: conv.title,
      messages: messages.map(decodeMessage),
      createdAt: conv.createdAt.toISOString(),
      updatedAt: (
        messages[messages.length - 1]?.createdAt ?? conv.createdAt
      ).toISOString(),
    };

    if (this.redisProvider.isEnabled()) {
      await this.redisProvider.set(
        cacheKey,
        JSON.stringify(conversation),
        30 * 60,
      ); // 30 分钟缓存
    }

    return conversation;
  }

  /**
   * 追加一条消息并使 Redis 缓存失效
   */
  async addMessage(
    threadId: string,
    role: 'human' | 'ai',
    content: string,
    userId?: string,
    metadata?: Record<string, unknown>,
    tenantId?: string,
  ): Promise<string> {
    const messageId = randomUUID();
    const persistedConversation =
      await this.conversationRepo.manager.transaction(async (manager) => {
        const conversation = await manager
          .getRepository(ConversationEntity)
          .findOne({
            where: {
              id: threadId,
              ...(userId ? { userId } : {}),
              ...(tenantId?.trim() ? { tenantId: tenantId.trim() } : {}),
            },
          });
        if (!conversation) {
          throw new NotFoundException(`conversation ${threadId} not found`);
        }

        const storedContent = metadata
          ? `${content}\n\n${MESSAGE_META_PREFIX}${Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64')}${MESSAGE_META_SUFFIX}`
          : content;
        const message = manager.getRepository(MessageEntity).create({
          id: messageId,
          conversationId: threadId,
          role,
          content: storedContent,
          tenantId: tenantId?.trim() || conversation.tenantId || 'legacy',
        });
        await manager.getRepository(MessageEntity).save(message);
        await this.domainEvents.emitInTransaction(manager, {
          tenantId: conversation.tenantId || 'legacy',
          eventType: 'conversation.cache_invalidate',
          aggregateType: 'conversation',
          aggregateId: threadId,
          payload: { userId: conversation.userId ?? null },
          idempotencyKey: `conversation-cache-invalidate:${messageId}`,
        });

        return {
          messageId,
          tenantId: conversation.tenantId || 'legacy',
          userId: conversation.userId,
        };
      });
    this.logger.log(`Message saved to DB: threadId=${threadId}, role=${role}`);

    // Outbox 负责故障重试；这里仍立即清缓存，保持原有读后写语义。
    if (this.redisProvider.isEnabled()) {
      const keys = this.conversationCacheKeys(
        threadId,
        persistedConversation.tenantId,
        persistedConversation.userId,
      );
      await Promise.all([...keys].map((key) => this.redisProvider.del(key)));
    }
    return persistedConversation.messageId;
  }

  /** 将已完成的一轮对话与向量索引任务原子写入 PostgreSQL。 */
  async addCompletedTurn(input: {
    threadId: string;
    query: string;
    answer: string;
    userId?: string;
    tenantId?: string;
    queryMetadata?: Record<string, unknown>;
    answerMetadata?: Record<string, unknown>;
    includeUserMessage?: boolean;
    indexConversation: boolean;
    persistMem0Memory: boolean;
  }): Promise<{ userMessageId?: string; assistantMessageId: string }> {
    const assistantMessageId = randomUUID();
    const userMessageId =
      input.includeUserMessage === false ? undefined : randomUUID();
    const persistedConversation =
      await this.conversationRepo.manager.transaction(async (manager) => {
        const conversation = await manager
          .getRepository(ConversationEntity)
          .findOne({
            where: {
              id: input.threadId,
              ...(input.userId ? { userId: input.userId } : {}),
              ...(input.tenantId?.trim()
                ? { tenantId: input.tenantId.trim() }
                : {}),
            },
          });
        if (!conversation) {
          throw new NotFoundException(
            `conversation ${input.threadId} not found`,
          );
        }

        const messageRepo = manager.getRepository(MessageEntity);
        let persistedUserMessageId: string | undefined = userMessageId;
        if (persistedUserMessageId) {
          const storedContent = input.queryMetadata
            ? `${input.query}\n\n${MESSAGE_META_PREFIX}${Buffer.from(JSON.stringify(input.queryMetadata), 'utf8').toString('base64')}${MESSAGE_META_SUFFIX}`
            : input.query;
          await messageRepo.save(
            messageRepo.create({
              id: persistedUserMessageId,
              conversationId: input.threadId,
              role: 'human',
              content: storedContent,
              tenantId:
                input.tenantId?.trim() || conversation.tenantId || 'legacy',
            }),
          );
        } else {
          const pendingMessage = await messageRepo.findOne({
            where: { conversationId: input.threadId, role: 'human' },
            order: { createdAt: 'DESC', id: 'DESC' },
          });
          const decoded = pendingMessage ? decodeMessage(pendingMessage) : null;
          if (
            !pendingMessage ||
            decoded?.content !== input.query ||
            decoded.metadata?.pendingApproval !== true
          ) {
            throw new ServiceUnavailableException(
              'Cannot match the resumed answer to its pending user message.',
            );
          }
          persistedUserMessageId = pendingMessage.id;
        }

        const storedAnswer = input.answerMetadata
          ? `${input.answer}\n\n${MESSAGE_META_PREFIX}${Buffer.from(JSON.stringify(input.answerMetadata), 'utf8').toString('base64')}${MESSAGE_META_SUFFIX}`
          : input.answer;
        await messageRepo.save(
          messageRepo.create({
            id: assistantMessageId,
            conversationId: input.threadId,
            role: 'ai',
            content: storedAnswer,
            tenantId:
              input.tenantId?.trim() || conversation.tenantId || 'legacy',
          }),
        );

        const tenantId = conversation.tenantId || 'legacy';
        if (persistedUserMessageId) {
          await this.domainEvents.emitInTransaction(manager, {
            tenantId,
            eventType: 'conversation.cache_invalidate',
            aggregateType: 'conversation',
            aggregateId: input.threadId,
            payload: { userId: conversation.userId ?? null },
            idempotencyKey: `conversation-cache-invalidate:${persistedUserMessageId}`,
          });
        }
        await this.domainEvents.emitInTransaction(manager, {
          tenantId,
          eventType: 'conversation.cache_invalidate',
          aggregateType: 'conversation',
          aggregateId: input.threadId,
          payload: { userId: conversation.userId ?? null },
          idempotencyKey: `conversation-cache-invalidate:${assistantMessageId}`,
        });
        if (input.indexConversation) {
          await this.domainEvents.emitInTransaction(manager, {
            tenantId,
            eventType: 'conversation.turn.completed',
            aggregateType: 'conversation',
            aggregateId: input.threadId,
            payload: {
              userMessageId: persistedUserMessageId,
              assistantMessageId,
            },
            idempotencyKey: `conversation-turn-completed:${assistantMessageId}`,
          });
        }
        if (input.persistMem0Memory && persistedUserMessageId) {
          await this.domainEvents.emitInTransaction(manager, {
            tenantId,
            eventType: 'conversation.memory.persist',
            aggregateType: 'conversation',
            aggregateId: input.threadId,
            payload: {
              userId: input.userId ?? conversation.userId,
              userMessageId: persistedUserMessageId,
              assistantMessageId,
            },
            idempotencyKey: `conversation-memory-persist:${assistantMessageId}`,
          });
        }

        return {
          userMessageId: persistedUserMessageId,
          assistantMessageId,
          tenantId,
          userId: conversation.userId,
        };
      });

    if (this.redisProvider.isEnabled()) {
      const keys = this.conversationCacheKeys(
        input.threadId,
        persistedConversation.tenantId,
        persistedConversation.userId,
      );
      await Promise.all([...keys].map((key) => this.redisProvider.del(key)));
    }
    return {
      userMessageId: persistedConversation.userMessageId,
      assistantMessageId: persistedConversation.assistantMessageId,
    };
  }

  private conversationCacheKeys(
    threadId: string,
    tenantId: string,
    userId: string | null,
  ): Set<string> {
    const tenantScope = tenantId.trim() || 'legacy';
    const tenantScopes = new Set([tenantScope, 'legacy']);
    const keys = new Set([`conv:messages:${threadId}`]);
    for (const scope of tenantScopes) {
      keys.add(`conv:messages:${scope}:${threadId}`);
      if (userId?.trim()) {
        keys.add(`conv:messages:${scope}:${userId}:${threadId}`);
      }
    }
    return keys;
  }

  /**
   * 获取最近 N 轮对话（使用 get 方法，共享 Redis 缓存）
   */
  async getRecentHistory(
    threadId: string,
    maxTurns = 5,
    userId?: string,
    tenantId?: string,
  ): Promise<
    Array<{
      role: 'human' | 'ai';
      content: string;
      metadata?: Record<string, unknown>;
    }>
  > {
    const messageLimit = Math.max(0, Math.floor(maxTurns * 2));
    if (messageLimit === 0) return [];

    const conversation = await this.conversationRepo.findOne({
      where: {
        id: threadId,
        ...(userId ? { userId } : {}),
        ...(tenantId?.trim() ? { tenantId: tenantId.trim() } : {}),
      },
      select: { id: true },
    });
    if (!conversation) return [];

    const recent = await this.messageRepo.find({
      where: {
        conversationId: threadId,
        ...(tenantId?.trim() ? { tenantId: tenantId.trim() } : {}),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: messageLimit,
    });
    return recent.reverse().map((message) => {
      const decoded = decodeMessage(message);
      return {
        role: decoded.role,
        content: decoded.content,
        ...(decoded.metadata ? { metadata: decoded.metadata } : {}),
      };
    });
  }

  /**
   * 列出所有对话摘要（不含消息体）
   */
  async listConversations(
    userId?: string,
    tenantId?: string,
  ): Promise<
    Array<{
      threadId: string;
      title: string;
      mode: string;
      messageCount: number;
      createdAt: string;
      updatedAt: string;
    }>
  > {
    // 一次聚合消息数量和最后更新时间，避免逐会话执行 count + findOne
    // 导致会话列表出现 N+1 查询，在数据量较大时超过管理接口超时。
    const query = this.conversationRepo
      .createQueryBuilder('conversation')
      .leftJoin(
        MessageEntity,
        'message',
        '"message"."conversationId" = "conversation"."id"',
      )
      .select('conversation.id', 'threadId')
      .addSelect('conversation.title', 'title')
      .addSelect('conversation.mode', 'mode')
      .addSelect('COUNT(message.id)', 'messageCount')
      .addSelect('conversation.createdAt', 'createdAt')
      .addSelect(
        'COALESCE(MAX(message.createdAt), conversation.createdAt)',
        'updatedAt',
      )
      .groupBy('conversation.id')
      .addGroupBy('conversation.title')
      .addGroupBy('conversation.mode')
      .addGroupBy('conversation.createdAt')
      .orderBy(
        'COALESCE(MAX(message.createdAt), conversation.createdAt)',
        'DESC',
      );

    if (userId) {
      query.where('conversation.userId = :userId', { userId });
    }
    if (tenantId?.trim()) {
      query.andWhere('conversation.tenantId = :tenantId', {
        tenantId: tenantId.trim(),
      });
    }

    const rows = await query.getRawMany<{
      threadId: string;
      title: string;
      mode: string;
      messageCount: string | number;
      createdAt: Date | string;
      updatedAt: Date | string;
    }>();

    return rows.map((row) => ({
      threadId: row.threadId,
      title: row.title,
      mode: row.mode,
      messageCount: Number(row.messageCount),
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    }));
  }

  /**
   * 删除对话并清理 Redis 缓存
   */
  async delete(
    threadId: string,
    userId?: string,
    tenantId?: string,
  ): Promise<boolean> {
    const where: { id: string; userId?: string; tenantId?: string } = {
      id: threadId,
    };
    if (userId) {
      where.userId = userId;
    }
    if (tenantId?.trim()) {
      where.tenantId = tenantId.trim();
    }

    const conv = await this.conversationRepo.findOne({ where });
    if (!conv) return false;

    // 先清派生数据；失败时保留 PostgreSQL 原文，让用户可以重试删除。
    try {
      await this.cleanupConversationArtifacts(
        threadId,
        conv.tenantId || 'legacy',
        conv.userId ?? null,
      );
    } catch {
      throw new ServiceUnavailableException(
        'Conversation cleanup failed; the conversation is still stored. Retry after the affected services recover.',
      );
    }

    const deleted = await this.conversationRepo.manager.transaction(
      async (manager) => {
        const conversation = await manager
          .getRepository(ConversationEntity)
          .findOne({ where });
        if (!conversation) return false;

        await manager.getRepository(MessageEntity).delete({
          conversationId: threadId,
          ...(tenantId?.trim() ? { tenantId: tenantId.trim() } : {}),
        });
        await manager.getRepository(ConversationEntity).delete(where);

        const eventTenantId = conversation.tenantId || 'legacy';
        await this.domainEvents.emitInTransaction(manager, {
          tenantId: eventTenantId,
          eventType: 'conversation.cache_invalidate',
          aggregateType: 'conversation',
          aggregateId: threadId,
          payload: { userId: conversation.userId ?? null },
          idempotencyKey: `conversation-delete-cache-invalidate:${threadId}`,
        });
        await this.domainEvents.emitInTransaction(manager, {
          tenantId: eventTenantId,
          eventType: CONVERSATION_DELETED_EVENT,
          aggregateType: 'conversation',
          aggregateId: threadId,
          payload: { userId: conversation.userId ?? null },
          idempotencyKey: `conversation-deleted:${threadId}`,
        });
        return true;
      },
    );
    if (!deleted) return false;
    this.logger.log(`Conversation deleted from DB: threadId=${threadId}`);
    return true;
  }

  private async handleConversationDeleted(
    event: DomainEventOutboxEntity,
  ): Promise<void> {
    const threadId = event.aggregateId.trim();
    if (!threadId)
      throw new Error('Conversation deletion event is missing threadId.');

    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(event.payload);
      payload =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      payload = {};
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'userId')) {
      throw new Error('Conversation deletion event is missing userId.');
    }
    const userId = payload.userId;
    if (userId !== null && typeof userId !== 'string') {
      throw new Error('Conversation deletion event has invalid userId.');
    }

    const existing = await this.conversationRepo.findOne({
      where: { id: threadId },
      select: { id: true },
    });
    if (existing) {
      throw new Error(
        'Conversation still exists; deletion cleanup is premature.',
      );
    }

    await this.cleanupConversationArtifacts(
      threadId,
      event.tenantId?.trim() || 'legacy',
      userId,
    );
  }

  private async cleanupConversationArtifacts(
    threadId: string,
    tenantId: string,
    userId: string | null,
  ): Promise<void> {
    const cacheKeys = this.conversationCacheKeys(threadId, tenantId, userId);
    const cleanupTargets = [
      'short-term memory',
      'session memory',
      'conversation vectors',
      'conversation cache',
    ];
    const cleanupResults = await Promise.allSettled([
      this.shortTermMemory.clearConversation(threadId),
      this.memoryService.deleteSessionMemory(userId, threadId),
      this.conversationEmbedding.deleteByThreadId(threadId),
      this.clearConversationCache(cacheKeys),
    ]);
    const failedTargets: string[] = [];
    cleanupResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        failedTargets.push(cleanupTargets[index]);
        this.logger.warn(
          `Conversation cleanup failed (${cleanupTargets[index]}): threadId=${threadId}, errorType=${result.reason instanceof Error ? result.reason.name : 'UnknownError'}`,
        );
      }
    });
    if (failedTargets.length > 0) {
      throw new Error(
        `Conversation cleanup failed for: ${failedTargets.join(', ')}`,
      );
    }
  }

  private async clearConversationCache(
    keys: ReadonlySet<string>,
  ): Promise<void> {
    if (!this.redisProvider.isConfigured()) return;
    await Promise.all(
      [...keys].map((key) => this.redisProvider.delRequired(key)),
    );
  }
}
