import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { ConversationEntity } from '../../providers/db/entities/conversation.entity';
import { MessageEntity } from '../../providers/db/entities/message.entity';
import { RedisProvider } from '../../providers/redis/redis.provider';

export interface ConversationMessage {
  role: 'human' | 'ai';
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

const MESSAGE_META_PREFIX = '<!-- rag-message-meta:';
const MESSAGE_META_SUFFIX = ' -->';

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
  ) {}

  /**
   * 创建新对话，返回 threadId
   */
  async create(
    firstQuery: string,
    mode = 'auto',
    userId?: string,
  ): Promise<string> {
    const threadId = randomUUID();
    const title = firstQuery.slice(0, 50);
    const conv = this.conversationRepo.create({
      id: threadId,
      title,
      mode,
      userId,
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
  async get(threadId: string, userId?: string): Promise<Conversation | null> {
    const cacheKey = userId
      ? `conv:messages:${userId}:${threadId}`
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

    const where: { id: string; userId?: string } = { id: threadId };
    if (userId) {
      where.userId = userId;
    }

    const conv = await this.conversationRepo.findOne({ where });
    if (!conv) return null;

    const messages = await this.messageRepo.find({
      where: { conversationId: threadId },
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
  ): Promise<void> {
    const storedContent = metadata
      ? `${content}\n\n${MESSAGE_META_PREFIX}${Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64')}${MESSAGE_META_SUFFIX}`
      : content;
    const msg = this.messageRepo.create({
      id: randomUUID(),
      conversationId: threadId,
      role,
      content: storedContent,
    });
    await this.messageRepo.save(msg);
    this.logger.log(`Message saved to DB: threadId=${threadId}, role=${role}`);

    // 清除 Redis 缓存（同时清 userId 版和无 userId 版，避免脏读）
    if (this.redisProvider.isEnabled()) {
      const cacheKey = userId
        ? `conv:messages:${userId}:${threadId}`
        : `conv:messages:${threadId}`;
      await this.redisProvider.del(cacheKey);
      if (userId) {
        await this.redisProvider.del(`conv:messages:${threadId}`);
      }
    }
  }

  /**
   * 获取最近 N 轮对话（使用 get 方法，共享 Redis 缓存）
   */
  async getRecentHistory(
    threadId: string,
    maxTurns = 5,
    userId?: string,
  ): Promise<
    Array<{
      role: 'human' | 'ai';
      content: string;
      metadata?: Record<string, unknown>;
    }
  >> {
    const conv = await this.get(threadId, userId);
    if (!conv || conv.messages.length === 0) return [];

    // 取最近 maxTurns * 2 条消息
    const recent = conv.messages.slice(-maxTurns * 2);
    return recent.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.metadata ? { metadata: m.metadata } : {}),
    }));
  }

  /**
   * 列出所有对话摘要（不含消息体）
   */
  async listConversations(userId?: string): Promise<
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
  async delete(threadId: string, userId?: string): Promise<boolean> {
    const where: { id: string; userId?: string } = { id: threadId };
    if (userId) {
      where.userId = userId;
    }

    const conv = await this.conversationRepo.findOne({ where });
    if (!conv) return false;

    await this.messageRepo.delete({ conversationId: threadId });
    await this.conversationRepo.delete({ id: threadId });
    this.logger.log(`Conversation deleted from DB: threadId=${threadId}`);

    // 清除 Redis 缓存
    if (this.redisProvider.isEnabled()) {
      const cacheKey = userId
        ? `conv:messages:${userId}:${threadId}`
        : `conv:messages:${threadId}`;
      await this.redisProvider.del(cacheKey);
    }
    return true;
  }
}
