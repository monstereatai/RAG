import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { WeeklySummaryEntity } from '../../providers/db/entities/weekly-summary.entity';
import { ConversationEntity } from '../../providers/db/entities/conversation.entity';
import { MessageEntity } from '../../providers/db/entities/message.entity';
import { LlmProvider } from '../../providers/llm/llm.provider';

@Injectable()
export class WeeklySummaryService {
  private readonly logger = new Logger(WeeklySummaryService.name);

  constructor(
    @InjectRepository(WeeklySummaryEntity)
    private readonly summaryRepo: Repository<WeeklySummaryEntity>,
    @InjectRepository(ConversationEntity)
    private readonly conversationRepo: Repository<ConversationEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: Repository<MessageEntity>,
    private readonly llmProvider: LlmProvider,
  ) {}

  /**
   * 为指定用户生成上周对话总结
   */
  async generateLastWeekSummary(
    userId?: string,
  ): Promise<WeeklySummaryEntity | null> {
    // 计算上周起始（周一）和结束（周日）
    const now = new Date();
    const dayOfWeek = now.getDay();
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const lastWeekMonday = new Date(now);
    lastWeekMonday.setDate(now.getDate() - daysSinceMonday - 7);
    lastWeekMonday.setHours(0, 0, 0, 0);

    const lastWeekSunday = new Date(lastWeekMonday);
    lastWeekSunday.setDate(lastWeekMonday.getDate() + 6);
    lastWeekSunday.setHours(23, 59, 59, 999);

    const weekStartStr = lastWeekMonday.toISOString().split('T')[0];

    // 检查是否已生成
    const existing = await this.summaryRepo.findOne({
      where: { userId: userId ?? undefined, weekStart: weekStartStr },
    });
    if (existing && existing.status === 'completed') {
      this.logger.log(
        `Summary already exists for week ${weekStartStr}, userId=${userId ?? 'null'}`,
      );
      return existing;
    }

    // 查询该用户的对话和消息
    const where: any = {};
    if (userId) where.userId = userId;

    const conversations = await this.conversationRepo.find({
      where: { ...where, createdAt: Between(lastWeekMonday, lastWeekSunday) },
      order: { createdAt: 'ASC' },
    });

    if (conversations.length === 0) {
      this.logger.log(
        `No conversations found for week ${weekStartStr}, userId=${userId ?? 'null'}`,
      );
      return null;
    }
    const conversationIds = conversations.map((c) => c.id);

    // For messages, query all conversations in one go within the time range
    const messages = await this.messageRepo.find({
      where: conversationIds.map((cid) => ({
        conversationId: cid,
        createdAt: Between(lastWeekMonday, lastWeekSunday),
      })),
      order: { createdAt: 'ASC' },
    });

    // 构建对话文本给 LLM
    const conversationText = conversations
      .map((conv) => {
        const convMessages = messages.filter(
          (m) => m.conversationId === conv.id,
        );
        const msgText = convMessages
          .map(
            (m) =>
              `[${m.role === 'human' ? '用户' : 'AI'}]: ${m.content.slice(0, 300)}`,
          )
          .join('\n');
        return `对话 ${conv.title || '(无标题)'}:\n${msgText}`;
      })
      .join('\n\n---\n\n');

    try {
      const model = this.llmProvider.getModel();
      const response = await model.invoke([
        {
          role: 'system',
          content:
            '你是一个对话分析助手。根据用户本周的对话记录，生成一份简洁的总结报告。' +
            '包括：本周主要讨论了哪些话题、用户关注的核心问题、是否有未解决的事项、以及下周建议关注的方向。' +
            '使用中文，字数控制在 300 字以内。',
        },
        { role: 'human', content: conversationText.slice(0, 8000) },
      ]);

      const summaryText =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);

      const entity = this.summaryRepo.create({
        id: randomUUID(),
        userId: userId ?? undefined,
        weekStart: weekStartStr,
        summary: summaryText,
        conversationCount: conversations.length,
        messageCount: messages.length,
        status: 'completed',
      });

      const saved = await this.summaryRepo.save(entity);
      this.logger.log(
        `Weekly summary generated: week=${weekStartStr}, convs=${conversations.length}`,
      );
      return saved;
    } catch (err) {
      this.logger.error(
        `Failed to generate weekly summary: ${(err as Error).message}`,
      );
      // Record failure
      const entity = this.summaryRepo.create({
        id: randomUUID(),
        userId: userId ?? undefined,
        weekStart: weekStartStr,
        summary: '',
        conversationCount: conversations.length,
        messageCount: messages.length,
        status: 'failed',
        errorMessage: (err as Error).message,
      });
      await this.summaryRepo.save(entity);
      return entity;
    }
  }

  /**
   * 获取用户的历史总结列表
   */
  async getSummaries(
    userId?: string,
    limit = 10,
  ): Promise<WeeklySummaryEntity[]> {
    const where: any = {};
    if (userId) where.userId = userId;
    return this.summaryRepo.find({
      where,
      order: { weekStart: 'DESC' },
      take: limit,
    });
  }
}
