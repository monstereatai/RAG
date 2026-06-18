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
      messages: messages.map((m) => ({
        role: m.role as 'human' | 'ai',
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
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
  ): Promise<void> {
    const msg = this.messageRepo.create({
      id: randomUUID(),
      conversationId: threadId,
      role,
      content,
    });
    await this.messageRepo.save(msg);
    this.logger.log(`Message saved to DB: threadId=${threadId}, role=${role}`);

    // 清除 Redis 缓存
    if (this.redisProvider.isEnabled()) {
      const cacheKey = userId
        ? `conv:messages:${userId}:${threadId}`
        : `conv:messages:${threadId}`;
      await this.redisProvider.del(cacheKey);
    }
  }

  /**
   * 获取最近 N 轮对话（使用 get 方法，共享 Redis 缓存）
   */
  async getRecentHistory(
    threadId: string,
    maxTurns = 5,
    userId?: string,
  ): Promise<Array<{ role: 'human' | 'ai'; content: string }>> {
    const conv = await this.get(threadId, userId);
    if (!conv || conv.messages.length === 0) return [];

    // 取最近 maxTurns * 2 条消息
    const recent = conv.messages.slice(-maxTurns * 2);
    return recent.map((m) => ({ role: m.role, content: m.content }));
  }

  /**
   * 列出所有对话摘要（不含消息体）
   */
  async listConversations(userId?: string): Promise<
    Array<{
      threadId: string;
      title: string;
      messageCount: number;
      createdAt: string;
      updatedAt: string;
    }>
  > {
    const where: { userId?: string } = {};
    if (userId) {
      where.userId = userId;
    }

    const conversations = await this.conversationRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });

    const results = [];
    for (const conv of conversations) {
      const messageCount = await this.messageRepo.count({
        where: { conversationId: conv.id },
      });

      const lastMsg = await this.messageRepo.findOne({
        where: { conversationId: conv.id },
        order: { createdAt: 'DESC' },
      });

      results.push({
        threadId: conv.id,
        title: conv.title,
        messageCount,
        createdAt: conv.createdAt.toISOString(),
        updatedAt: (lastMsg?.createdAt ?? conv.createdAt).toISOString(),
      });
    }
    return results;
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
