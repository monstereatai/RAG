import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { WeeklySummaryEntity } from '../../providers/db/entities/weekly-summary.entity';
import { ConversationEntity } from '../../providers/db/entities/conversation.entity';
import { MessageEntity } from '../../providers/db/entities/message.entity';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { getPromptMetadata } from '../../rag/prompts/prompt-registry';
import { weeklySummaryPromptDefinitions } from './weekly-summary.prompts';
import { RedisProvider } from '../../providers/redis/redis.provider';

const SUMMARY_INPUT_CHARS = 12_000;
const SUMMARY_LOCK_TTL_SECONDS = 900;
const SUMMARY_LOCK_RENEW_INTERVAL_MS = 60_000;

@Injectable()
export class WeeklySummaryService {
  private readonly logger = new Logger(WeeklySummaryService.name);
  private static readonly inProgress = new Set<string>();

  constructor(
    @InjectRepository(WeeklySummaryEntity)
    private readonly summaryRepo: Repository<WeeklySummaryEntity>,
    @InjectRepository(ConversationEntity)
    private readonly conversationRepo: Repository<ConversationEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: Repository<MessageEntity>,
    private readonly llmProvider: LlmProvider,
    private readonly redisProvider: RedisProvider,
  ) {}

  /**
   * 为指定用户生成上周对话总结。未提供 userId 时生成系统级汇总。
   */
  async generateLastWeekSummary(
    userId?: string,
  ): Promise<WeeklySummaryEntity | null> {
    const { start, endExclusive, date } = this.getLastWeekUtc();
    const normalizedUserId = userId?.trim() || null;
    const scopeKey = `${normalizedUserId ? `user:${normalizedUserId}` : 'system'}:${date}`;
    const lockKey = `rag:weekly-summary:${scopeKey}:lock`;

    if (WeeklySummaryService.inProgress.has(scopeKey)) return null;
    WeeklySummaryService.inProgress.add(scopeKey);

    const hasRedis = this.redisProvider.isEnabled();
    const lockValue = randomUUID();
    let lockAcquired = false;
    let lockLost = false;
    let lockRenewal: NodeJS.Timeout | undefined;
    let renewalInFlight = Promise.resolve();

    try {
      if (hasRedis) {
        lockAcquired = await this.redisProvider.setIfAbsent(
          lockKey,
          lockValue,
          SUMMARY_LOCK_TTL_SECONDS,
        );
        if (!lockAcquired) {
          this.logger.warn(
            `Weekly summary skipped because its Redis lock is unavailable or held: week=${date}, userId=${normalizedUserId ?? 'system'}`,
          );
          return null;
        }

        lockRenewal = setInterval(() => {
          renewalInFlight = renewalInFlight.then(async () => {
            if (
              !(await this.redisProvider.renewLock(
                lockKey,
                lockValue,
                SUMMARY_LOCK_TTL_SECONDS,
              ))
            ) {
              lockLost = true;
            }
          });
        }, SUMMARY_LOCK_RENEW_INTERVAL_MS);
        lockRenewal.unref?.();
      } else {
        // Redis disabled 时只保护当前进程；多个实例之间仍可能重复生成。
        this.logger.warn(
          `Redis disabled; weekly summary lock is process-local only: week=${date}, userId=${normalizedUserId ?? 'system'}`,
        );
      }

      return await this.generateLockedSummary(
        normalizedUserId,
        start,
        endExclusive,
        date,
        async () => {
          if (!hasRedis) return true;
          if (lockRenewal) clearInterval(lockRenewal);
          await renewalInFlight;
          if (lockLost) return false;
          const renewed = await this.redisProvider.renewLock(
            lockKey,
            lockValue,
            SUMMARY_LOCK_TTL_SECONDS,
          );
          if (!renewed) lockLost = true;
          return !lockLost;
        },
      );
    } finally {
      if (lockRenewal) clearInterval(lockRenewal);
      if (lockAcquired) {
        await this.redisProvider.releaseLock(lockKey, lockValue);
      }
      WeeklySummaryService.inProgress.delete(scopeKey);
    }
  }

  private async generateLockedSummary(
    userId: string | null,
    weekStart: Date,
    weekEndExclusive: Date,
    weekStartStr: string,
    canPersist: () => Promise<boolean>,
  ): Promise<WeeklySummaryEntity | null> {
    const existing = await this.summaryRepo.findOne({
      where: {
        userId: userId ?? IsNull(),
        weekStart: weekStartStr,
      },
    });
    if (existing?.status === 'completed') {
      this.logger.log(
        `Summary already exists for week ${weekStartStr}, userId=${userId ?? 'system'}`,
      );
      return existing;
    }

    // 先按消息发生时间找会话，避免漏掉更早创建、但本周仍有消息的会话。
    const messageConversations = await this.messageRepo
      .createQueryBuilder('message')
      .select('message.conversationId', 'conversationId')
      .distinct(true)
      .where('message.createdAt >= :weekStart', { weekStart })
      .andWhere('message.createdAt < :weekEndExclusive', {
        weekEndExclusive,
      })
      .getRawMany<{ conversationId: string }>();
    const conversationIds = messageConversations.map(
      ({ conversationId }) => conversationId,
    );
    if (conversationIds.length === 0) {
      this.logger.log(
        `No conversations found for week ${weekStartStr}, userId=${userId ?? 'system'}`,
      );
      return null;
    }

    const conversations = await this.conversationRepo.find({
      where: {
        id: In(conversationIds),
        ...(userId ? { userId } : {}),
      },
      order: { createdAt: 'ASC' },
    });
    if (conversations.length === 0) return null;

    const scopedConversationIds = conversations.map(({ id }) => id);
    const messages = await this.messageRepo
      .createQueryBuilder('message')
      .where('message.conversationId IN (:...conversationIds)', {
        conversationIds: scopedConversationIds,
      })
      .andWhere('message.createdAt >= :weekStart', { weekStart })
      .andWhere('message.createdAt < :weekEndExclusive', {
        weekEndExclusive,
      })
      .orderBy('message.createdAt', 'ASC')
      .getMany();

    const messagesByConversation = new Map<string, MessageEntity[]>();
    for (const message of messages) {
      const group = messagesByConversation.get(message.conversationId) ?? [];
      group.push(message);
      messagesByConversation.set(message.conversationId, group);
    }
    const conversationText = conversations
      .map((conversation) => {
        const messageText = (messagesByConversation.get(conversation.id) ?? [])
          .map(
            (message) =>
              `[${message.role === 'human' ? '用户' : 'AI'}]: ${message.content}`,
          )
          .join('\n');
        return `对话 ${conversation.title || '(无标题)'}:\n${messageText}`;
      })
      .join('\n\n---\n\n');

    try {
      const summaryText = await this.summarizeCompleteInput(conversationText);
      if (!(await canPersist())) {
        this.logger.warn(
          `Weekly summary lock was lost; result was not saved: week=${weekStartStr}, userId=${userId ?? 'system'}`,
        );
        return null;
      }

      const entity = this.summaryRepo.create({
        ...(existing ?? {}),
        id: existing?.id ?? randomUUID(),
        userId,
        weekStart: weekStartStr,
        summary: summaryText,
        conversationCount: conversations.length,
        messageCount: messages.length,
        status: 'completed',
        errorMessage: null,
      });
      const saved = await this.summaryRepo.save(entity);
      this.logger.log(
        `Weekly summary generated: week=${weekStartStr}, convs=${conversations.length}`,
      );
      return saved;
    } catch (err) {
      if (!(await canPersist())) {
        this.logger.warn(
          `Weekly summary lock was lost; failure was not saved: week=${weekStartStr}, userId=${userId ?? 'system'}`,
        );
        return null;
      }
      this.logger.error(
        `Failed to generate weekly summary: ${(err as Error).message}`,
      );
      const entity = this.summaryRepo.create({
        ...(existing ?? {}),
        id: existing?.id ?? randomUUID(),
        userId,
        weekStart: weekStartStr,
        summary: '',
        conversationCount: conversations.length,
        messageCount: messages.length,
        status: 'failed',
        errorMessage: (err as Error).message,
      });
      return this.summaryRepo.save(entity);
    }
  }

  private async summarizeCompleteInput(input: string): Promise<string> {
    const chunks = this.splitText(input, SUMMARY_INPUT_CHARS);
    let summaries: string[] = [];

    for (const chunk of chunks) {
      summaries.push(await this.invokeSummaryModel('chunk', chunk));
    }

    // 逐层归并分块结果，确保每次发给模型的内容都有明确上限。
    let level = 0;
    while (summaries.length > 1) {
      if (++level > 24) {
        throw new Error(
          'Weekly summary exceeded the supported hierarchy depth',
        );
      }
      const batches = this.batchByCharBudget(summaries, SUMMARY_INPUT_CHARS);
      const next: string[] = [];
      for (const batch of batches) {
        if (batch.length === 1 && batch[0].length <= 300) {
          next.push(batch[0]);
          continue;
        }
        next.push(
          await this.invokeSummaryModel('merge', batch.join('\n\n---\n\n')),
        );
      }
      const previousChars = summaries.reduce(
        (sum, item) => sum + item.length,
        0,
      );
      const nextChars = next.reduce((sum, item) => sum + item.length, 0);
      if (next.length >= summaries.length && nextChars >= previousChars) {
        throw new Error('Weekly summary hierarchy did not reduce its input');
      }
      summaries = next;
    }
    return summaries[0] ?? '';
  }

  private async invokeSummaryModel(
    promptKind: keyof typeof weeklySummaryPromptDefinitions,
    input: string,
  ): Promise<string> {
    const response = await this.llmProvider.getModel().invoke(
      [
        { role: 'system', content: weeklySummaryPromptDefinitions[promptKind] },
        { role: 'human', content: input },
      ],
      { metadata: getPromptMetadata(`weekly_summary.${promptKind}`) },
    );
    const content =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    if (!content.trim())
      throw new Error('Weekly summary model returned empty content');
    return content;
  }

  private splitText(text: string, maxChars: number): string[] {
    const chunks: string[] = [];
    let offset = 0;
    while (offset < text.length) {
      let end = Math.min(offset + maxChars, text.length);
      if (end < text.length) {
        const newline = text.lastIndexOf('\n', end - 1);
        if (newline > offset + Math.floor(maxChars / 2)) end = newline + 1;
        if (
          end < text.length &&
          text.charCodeAt(end - 1) >= 0xd800 &&
          text.charCodeAt(end - 1) <= 0xdbff &&
          text.charCodeAt(end) >= 0xdc00 &&
          text.charCodeAt(end) <= 0xdfff
        ) {
          end--;
        }
      }
      chunks.push(text.slice(offset, end));
      offset = end;
    }
    return chunks;
  }

  private batchByCharBudget(items: string[], maxChars: number): string[][] {
    const batches: string[][] = [];
    let batch: string[] = [];
    let batchChars = 0;
    for (const item of items) {
      const parts = this.splitText(item, maxChars);
      for (const part of parts) {
        const separatorChars = batch.length ? '\n\n---\n\n'.length : 0;
        if (
          batch.length &&
          batchChars + separatorChars + part.length > maxChars
        ) {
          batches.push(batch);
          batch = [];
          batchChars = 0;
        }
        batchChars += (batch.length ? '\n\n---\n\n'.length : 0) + part.length;
        batch.push(part);
      }
    }
    if (batch.length) batches.push(batch);
    return batches;
  }

  private getLastWeekUtc(): {
    start: Date;
    endExclusive: Date;
    date: string;
  } {
    const now = new Date();
    const currentWeekStart = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - ((now.getUTCDay() + 6) % 7),
      ),
    );
    const start = new Date(currentWeekStart);
    start.setUTCDate(start.getUTCDate() - 7);
    const endExclusive = new Date(start);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 7);
    return { start, endExclusive, date: start.toISOString().slice(0, 10) };
  }

  /**
   * 获取用户的历史总结列表
   */
  async getSummaries(
    userId?: string,
    limit = 10,
  ): Promise<WeeklySummaryEntity[]> {
    const normalizedUserId = userId?.trim() || null;
    return this.summaryRepo.find({
      where: { userId: normalizedUserId ?? IsNull() },
      order: { weekStart: 'DESC' },
      take: limit,
    });
  }
}
