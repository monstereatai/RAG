import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Brackets, Repository } from 'typeorm';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { ConversationEntity } from '../../providers/db/entities/conversation.entity';
import { MessageEntity } from '../../providers/db/entities/message.entity';
import { AgentRuntimeEventsService } from '../agent-runtime-events/agent-runtime-events.service';
import { MetricsService } from '../metrics/metrics.service';
import {
  COMPACTION_TRIGGER_RATIO,
  ContextCompactionAudit,
  DEFAULT_MESSAGE_SAFETY_CAP,
  HISTORY_CACHE_LOCK_TTL_SECONDS,
  TTL_SECONDS,
  type StoredTurn,
  type StructuredMemorySummary,
} from './short-term-memory.shared';

export abstract class ShortTermMemoryStorageSupport {
  protected abstract readonly redis: RedisProvider;
  protected abstract readonly llmProvider: LlmProvider;
  protected abstract readonly conversationRepo: Repository<ConversationEntity>;
  protected abstract readonly messageRepo: Repository<MessageEntity>;
  protected abstract readonly runtimeEvents?: AgentRuntimeEventsService;
  protected abstract readonly metricsService?: MetricsService;
  protected abstract readonly config?: ConfigService;
  protected abstract readonly logger: Logger;
  protected abstract estimateStoredTurnTokens(rawTurns: string[]): number;
  protected abstract estimateTokens(text: string): number;
  protected abstract formatSummary(raw: string, tokenBudget?: number): string;
  abstract trimAndSummarize(
    conversationId: string,
    maxMessages?: number,
    reason?: ContextCompactionAudit['reason'],
    tokenBudget?: number,
  ): Promise<ContextCompactionAudit | null>;

  getMessageSafetyCap(): number {
    const configured =
      this.config?.get<number>('memory.messageSafetyCap') ??
      Number(process.env.SHORT_TERM_MESSAGE_SAFETY_CAP ?? '');
    if (Number.isFinite(configured) && configured > 0) {
      return Math.min(Math.max(Math.floor(configured), 20), 2_000);
    }
    return DEFAULT_MESSAGE_SAFETY_CAP;
  }

  protected async storeTurns(
    conversationId: string,
    turns: Array<{
      role: 'user' | 'assistant';
      content: string;
      messageId?: string;
    }>,
    tokenBudget: number,
    checkCompression: boolean,
  ): Promise<ContextCompactionAudit | null> {
    if (!this.redis.isEnabled()) return null;
    if (turns.length === 0) return null;

    const lockKey = this.historyCacheLockKey(conversationId);
    const lockValue = randomUUID();
    if (
      !(await this.redis.setIfAbsent(
        lockKey,
        lockValue,
        HISTORY_CACHE_LOCK_TTL_SECONDS,
      ))
    ) {
      return null;
    }

    const key = this.turnsKey(conversationId);
    try {
      const createdAt = Date.now();
      for (const [index, turn] of turns.entries()) {
        const storedTurn: StoredTurn = turn.messageId
          ? {
              messageId: turn.messageId,
              role: turn.role,
              content: turn.content,
            }
          : {
              role: turn.role,
              content: turn.content,
              ts: createdAt + index,
            };
        await this.redis.zadd(
          key,
          createdAt + index,
          JSON.stringify(storedTurn),
        );
      }
      await this.redis.expire(key, TTL_SECONDS);
    } finally {
      await this.redis.releaseLock(lockKey, lockValue);
    }

    if (!checkCompression) return null;

    const all = await this.redis.zrange(key, 0, -1);
    const estimatedTokens = this.estimateStoredTurnTokens(all);
    const existingSummary = await this.redis.get(
      this.summaryKey(conversationId),
    );
    const summaryTokens = existingSummary
      ? this.estimateTokens(
          this.formatSummary(
            existingSummary,
            Math.min(1_500, Math.max(0, tokenBudget - 12)),
          ),
        ) + 12
      : 0;
    const tokenThreshold = Math.floor(
      Math.max(0, tokenBudget) * COMPACTION_TRIGGER_RATIO,
    );
    const exceedsTokenThreshold =
      tokenBudget > 0 && estimatedTokens + summaryTokens > tokenThreshold;
    if (all.length > this.getMessageSafetyCap() || exceedsTokenThreshold) {
      return this.trimAndSummarize(
        conversationId,
        this.getMessageSafetyCap(),
        all.length > this.getMessageSafetyCap()
          ? 'turn_window'
          : 'token_budget',
        tokenBudget,
      );
    }
    return null;
  }

  protected turnsKey(conversationId: string): string {
    return `stm:${conversationId}:turns`;
  }

  protected summaryKey(conversationId: string): string {
    return `stm:${conversationId}:summary`;
  }

  protected compactionLockKey(conversationId: string): string {
    return `stm:${conversationId}:compaction-lock`;
  }

  protected historyCacheLockKey(conversationId: string): string {
    return `stm:${conversationId}:history-cache-lock`;
  }

  protected auditKey(conversationId: string): string {
    return `stm:${conversationId}:compactions`;
  }

  protected async getPersistentSummary(
    conversationId: string,
  ): Promise<string | null> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
      select: {
        id: true,
        contextSummary: true,
      },
    });
    return conversation?.contextSummary ?? null;
  }

  protected async advanceCompactedPrefix(
    conversationId: string,
    currentWatermark: string | undefined,
    compactedIds: Set<string>,
  ): Promise<{
    compactedThroughMessageId?: string;
    compactedMessageIds: string[];
  }> {
    let cursor = currentWatermark
      ? await this.messageRepo.findOne({
          where: { id: currentWatermark, conversationId },
          select: { id: true, role: true, createdAt: true },
        })
      : null;
    if (currentWatermark && !cursor) {
      return {
        compactedThroughMessageId: currentWatermark,
        compactedMessageIds: [...compactedIds],
      };
    }

    let compactedThroughMessageId = currentWatermark;
    const roleRank =
      "CASE WHEN message.role = 'human' THEN 0 WHEN message.role = 'ai' THEN 1 ELSE 2 END";
    while (true) {
      const query = this.messageRepo
        .createQueryBuilder('message')
        .select(['message.id', 'message.role', 'message.createdAt'])
        .where('message.conversationId = :conversationId', { conversationId });
      if (cursor) {
        const cursorRoleRank =
          cursor.role === 'human' ? 0 : cursor.role === 'ai' ? 1 : 2;
        query.andWhere(
          new Brackets((where) => {
            where
              .where('message.createdAt > :cursorCreatedAt')
              .orWhere(
                `message.createdAt = :cursorCreatedAt AND ${roleRank} > :cursorRoleRank`,
              )
              .orWhere(
                `message.createdAt = :cursorCreatedAt AND ${roleRank} = :cursorRoleRank AND message.id > :cursorId`,
              );
          }),
        );
        query.setParameters({
          cursorCreatedAt: cursor.createdAt,
          cursorRoleRank,
          cursorId: cursor.id,
        });
      }
      const rows = await query
        .orderBy('message.createdAt', 'ASC')
        .addOrderBy(roleRank, 'ASC')
        .addOrderBy('message.id', 'ASC')
        .take(100)
        .getMany();
      if (rows.length === 0) break;

      let stoppedAtGap = false;
      for (const row of rows) {
        if (!compactedIds.has(row.id)) {
          stoppedAtGap = true;
          break;
        }
        compactedIds.delete(row.id);
        compactedThroughMessageId = row.id;
        cursor = row;
      }
      if (stoppedAtGap || rows.length < 100) break;
    }

    return {
      ...(compactedThroughMessageId ? { compactedThroughMessageId } : {}),
      compactedMessageIds: [...compactedIds],
    };
  }

  protected async loadRecentTurnsFromPostgres(
    conversationId: string,
    maxMessages: number,
    summaryState?: StructuredMemorySummary,
  ): Promise<{ turns: StoredTurn[]; hasOlderMessages: boolean }> {
    const limit = Math.max(1, maxMessages);
    const compactedMessageIds = new Set(
      summaryState?.compactedMessageIds ?? [],
    );
    const recentMessages: MessageEntity[] = [];
    const pageSize = 100;
    let offset = 0;
    let hasMoreUncompressedMessages = false;
    let reachedWatermark = false;

    while (recentMessages.length <= limit && !reachedWatermark) {
      const page = await this.messageRepo
        .createQueryBuilder('message')
        .where('message.conversationId = :conversationId', { conversationId })
        .orderBy('message.createdAt', 'DESC')
        .addOrderBy(
          "CASE WHEN message.role = 'human' THEN 0 WHEN message.role = 'ai' THEN 1 ELSE 2 END",
          'DESC',
        )
        .addOrderBy('message.id', 'DESC')
        .skip(offset)
        .take(pageSize)
        .getMany();
      if (page.length === 0) break;

      for (const message of page) {
        if (message.id === summaryState?.compactedThroughMessageId) {
          reachedWatermark = true;
          break;
        }
        if (compactedMessageIds.has(message.id)) continue;
        recentMessages.push(message);
        if (recentMessages.length > limit) {
          hasMoreUncompressedMessages = true;
          break;
        }
      }
      if (hasMoreUncompressedMessages || page.length < pageSize) break;
      offset += page.length;
    }

    const turns = recentMessages.slice(0, limit).reverse().map((message) => ({
      messageId: message.id,
      role: message.role === 'ai' ? ('assistant' as const) : ('user' as const),
      content: this.messageContent(message.content),
      ts: message.createdAt.getTime(),
    }));
    return {
      turns,
      hasOlderMessages: hasMoreUncompressedMessages,
    };
  }

  protected async loadRecentMessageIdsFromPostgres(
    conversationId: string,
    maxMessages: number,
    summaryState?: StructuredMemorySummary,
  ): Promise<{ ids: string[]; hasOlderMessages: boolean }> {
    const limit = Math.max(1, maxMessages);
    const excludedIds = new Set(summaryState?.compactedMessageIds ?? []);
    const uncompressed: MessageEntity[] = [];
    const pageSize = 100;
    let offset = 0;
    let hasMoreUncompressedMessages = false;
    let reachedWatermark = false;

    while (uncompressed.length <= limit && !reachedWatermark) {
      const page = await this.messageRepo
        .createQueryBuilder('message')
        .select(['message.id', 'message.role', 'message.createdAt'])
        .where('message.conversationId = :conversationId', { conversationId })
        .orderBy('message.createdAt', 'DESC')
        .addOrderBy(
          "CASE WHEN message.role = 'human' THEN 0 WHEN message.role = 'ai' THEN 1 ELSE 2 END",
          'DESC',
        )
        .addOrderBy('message.id', 'DESC')
        .skip(offset)
        .take(pageSize)
        .getMany();
      if (page.length === 0) break;

      for (const message of page) {
        if (message.id === summaryState?.compactedThroughMessageId) {
          reachedWatermark = true;
          break;
        }
        if (excludedIds.has(message.id)) continue;
        uncompressed.push(message);
        if (uncompressed.length > limit) {
          hasMoreUncompressedMessages = true;
          break;
        }
      }
      if (hasMoreUncompressedMessages || page.length < pageSize) break;
      offset += page.length;
    }

    return {
      ids: uncompressed.slice(0, limit).reverse().map((message) => message.id),
      hasOlderMessages: hasMoreUncompressedMessages,
    };
  }

  protected messageContent(content: string): string {
    const marker = '<!-- rag-message-meta:';
    const suffix = ' -->';
    const markerStart = content.lastIndexOf(marker);
    if (markerStart < 0 || !content.endsWith(suffix)) return content;
    const encoded = content.slice(markerStart + marker.length, -suffix.length);
    try {
      JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
      return content.slice(0, markerStart).trimEnd();
    } catch {
      return content;
    }
  }

  protected serializeStoredTurn(turn: StoredTurn): string {
    return turn.messageId
      ? JSON.stringify({
          messageId: turn.messageId,
          role: turn.role,
          content: turn.content,
        })
      : JSON.stringify(turn);
  }

  protected async persistSummary(
    conversationId: string,
    summary: StructuredMemorySummary,
  ): Promise<void> {
    await this.conversationRepo.update(conversationId, {
      contextSummary: JSON.stringify(summary),
      contextSummaryVersion: summary.schemaVersion,
      contextSummaryUpdatedAt: new Date(),
    });
  }

  protected async saveAudit(
    conversationId: string,
    audit: ContextCompactionAudit,
  ): Promise<void> {
    const key = this.auditKey(conversationId);
    await this.redis.zadd(key, Date.now(), JSON.stringify(audit));
    await this.redis.zremrangebyrank(key, 0, -51);
    await this.redis.expire(key, TTL_SECONDS);
  }

  protected async emitAuditEvent(
    conversationId: string,
    eventType: string,
    audit: ContextCompactionAudit,
  ): Promise<void> {
    try {
      await this.runtimeEvents?.emit({
        threadId: conversationId,
        eventType,
        actor: 'short_term_memory',
        payload: audit,
      });
    } catch (error) {
      this.logger.warn(
        `Short-term memory audit event failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  protected tryParseAudit(raw: string): ContextCompactionAudit | null {
    try {
      return JSON.parse(raw) as ContextCompactionAudit;
    } catch {
      return null;
    }
  }
}
