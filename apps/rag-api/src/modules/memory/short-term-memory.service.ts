/**
 * 短期记忆服务（Redis 滑动窗口）
 *
 * 基于 Redis Sorted Set 存储最近对话消息，超过本轮可用上下文预算后压缩较早内容。
 * PostgreSQL 保留完整聊天消息和结构化摘要，Redis 只保存近期热窗口与摘要缓存。
 *
 * Key 设计:
 *   stm:{conversationId}:turns  → ZSET, 每元素 JSON {messageId, role, content}
 *   stm:{conversationId}:summary → STRING, 已裁剪部分的 LLM 摘要
 *
 * 未配置 Redis 时自动静默降级，不阻断对话。
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { ConversationEntity } from '../../providers/db/entities/conversation.entity';
import { MessageEntity } from '../../providers/db/entities/message.entity';
import { SystemMessage } from '@langchain/core/messages';
import { randomUUID } from 'node:crypto';
import { AgentRuntimeEventsService } from '../agent-runtime-events/agent-runtime-events.service';
import { MetricsService } from '../metrics/metrics.service';
import {
  DEFAULT_MESSAGE_SAFETY_CAP,
  HISTORY_CACHE_LOCK_TTL_SECONDS,
  MAX_HISTORY_CONTEXT_TOKENS,
  MAX_RETRIEVAL_CONTEXT_CHARACTERS,
  SYSTEM_CONTEXT_RESERVE_TOKENS,
  TTL_SECONDS,
  type ContextCompactionAudit,
  type StoredTurn,
} from './short-term-memory.shared';
export type { ContextCompactionAudit } from './short-term-memory.shared';
import { ShortTermMemoryCompactionSupport } from './short-term-memory.compaction-support';
import type {
  ContextMessageBudgetResult,
  ContextMessageCandidate,
} from '../../rag/contracts/context-budget';

@Injectable()
export class ShortTermMemoryService extends ShortTermMemoryCompactionSupport {
  /**
   * PostgreSQL 保存完整历史和摘要；Redis 热窗口命中后先核对消息 ID，损坏或过期时从 PostgreSQL 重建。
   */
  protected readonly logger = new Logger(ShortTermMemoryService.name);

  constructor(
    protected readonly redis: RedisProvider,
    protected readonly llmProvider: LlmProvider,
    @InjectRepository(ConversationEntity)
    protected readonly conversationRepo: Repository<ConversationEntity>,
    @InjectRepository(MessageEntity)
    protected readonly messageRepo: Repository<MessageEntity>,
    @Optional() protected readonly runtimeEvents?: AgentRuntimeEventsService,
    @Optional() protected readonly metricsService?: MetricsService,
    @Optional() protected readonly config?: ConfigService,
  ) {
    super();
  }

  isEnabled(): boolean {
    return this.redis.isEnabled();
  }

  /**
   * 按 token 预算返回「摘要 + 最近轮次」；摘要缺失时从 PostgreSQL 恢复并回写 Redis，
   * 由调用方将结果并入本轮上下文，不能把原始完整历史无限制传给模型。
   */
  async getContext(
    conversationId: string,
    maxMessages = DEFAULT_MESSAGE_SAFETY_CAP,
    tokenBudget = MAX_HISTORY_CONTEXT_TOKENS,
  ): Promise<{
    systemMessage: SystemMessage | null;
    recentTurns: StoredTurn[];
    truncatedHistory: boolean;
  }> {
    if (maxMessages <= 0 || tokenBudget <= 0) {
      return { systemMessage: null, recentTurns: [], truncatedHistory: false };
    }
    if (!this.redis.isEnabled()) {
      // cd 拿摘要
      const summary = await this.resolvePersistentSummary(conversationId);
      const summaryState = summary ? this.tryParseSummary(summary) : null;
      const recovered = await this.loadRecentTurnsFromPostgres(
        conversationId,
        maxMessages,
        summaryState ?? undefined,
      );
      const formattedSummary = summary
        ? this.formatSummary(
            summary,
            Math.min(1_500, Math.max(0, tokenBudget - 12)),
          )
        : '';
      const summaryTokens = formattedSummary
        ? this.estimateTokens(formattedSummary) + 12
        : 0;
      const recentTurns = this.selectRecentTurns(
        recovered.turns,
        maxMessages,
        Math.max(0, tokenBudget - summaryTokens),
      );
      return {
        // cd 包装成langchain系统消息对象
        systemMessage: formattedSummary
          ? new SystemMessage(`【历史对话结构化变更摘要】\n${formattedSummary}`)
          : null,
        recentTurns,
        truncatedHistory:
          Boolean(summary) ||
          recovered.hasOlderMessages ||
          recentTurns.length < recovered.turns.length,
      };
    }
    // cd 拿历史轮次
    const key = this.turnsKey(conversationId);
    const raw = await this.redis.zrange(key, 0, -1);
    const summaryLookupStartedAt = process.hrtime.bigint();
    let summary = await this.redis.get(this.summaryKey(conversationId));
    this.metricsService?.observeCacheOperation(
      'short_term_summary',
      'get',
      Number(process.hrtime.bigint() - summaryLookupStartedAt) / 1e9,
    );
    this.metricsService?.observeCacheRequest(
      'short_term_summary',
      Boolean(summary),
    );
    // 摘要没有 redis拿，没有从postgre拿，回写redis
    if (!summary) {
      summary = await this.resolvePersistentSummary(conversationId);
      if (summary) {
        const summaryWriteStartedAt = process.hrtime.bigint();
        await this.redis.set(
          this.summaryKey(conversationId),
          summary,
          TTL_SECONDS,
        );
        this.metricsService?.observeCacheOperation(
          'short_term_summary',
          'set',
          Number(process.hrtime.bigint() - summaryWriteStartedAt) / 1e9,
        );
      }
    }

    let turns: StoredTurn[] = [];
    let cacheContentsAreValid = true;
    try {
      turns = raw.map((r) => {
        const turn = JSON.parse(r) as StoredTurn | null;
        if (
          !turn ||
          typeof turn !== 'object' ||
          !['user', 'assistant', 'system'].includes(turn.role) ||
          typeof turn.content !== 'string'
        ) {
          throw new Error('invalid cached message shape');
        }
        return turn;
      });
    } catch (error) {
      cacheContentsAreValid = false;
      this.logger.warn(
        `Recent history cache contains invalid data: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    let recoveredHistoryIsTruncated = false;
    let cacheMatchesPostgres = false;
    const summaryState = summary ? this.tryParseSummary(summary) : null;
    const summaryWatermark = summaryState?.compactedThroughMessageId;
    if (
      cacheContentsAreValid &&
      (turns.length > 0 || Boolean(summaryWatermark))
    ) {
      const validationStartedAt = process.hrtime.bigint();
      let recentMessageIds: { ids: string[]; hasOlderMessages: boolean };
      try {
        recentMessageIds = await this.loadRecentMessageIdsFromPostgres(
          conversationId,
          maxMessages,
          summaryState ?? undefined,
        );
      } finally {
        this.metricsService?.observeCacheOperation(
          'short_term_history',
          'get',
          Number(process.hrtime.bigint() - validationStartedAt) / 1e9,
        );
      }
      recoveredHistoryIsTruncated = recentMessageIds.hasOlderMessages;
      const cachedMessageIds = turns
        .slice(-Math.max(1, maxMessages))
        .map((turn) => turn.messageId ?? '');
      const expectedMessageIds = recentMessageIds.ids;
      cacheMatchesPostgres =
        cachedMessageIds.length === expectedMessageIds.length &&
        cachedMessageIds.every(
          (messageId, index) => messageId === expectedMessageIds[index],
        );
    }
    this.metricsService?.observeCacheRequest(
      'short_term_history',
      cacheMatchesPostgres,
    );
    if (!cacheMatchesPostgres) {
      const lockKey = this.historyCacheLockKey(conversationId);
      const lockValue = randomUUID();
      const ownsCacheLock = await this.redis.setIfAbsent(
        lockKey,
        lockValue,
        HISTORY_CACHE_LOCK_TTL_SECONDS,
      );
      try {
        const recovered = await this.loadRecentTurnsFromPostgres(
          conversationId,
          maxMessages,
          summaryState ?? undefined,
        );
        turns = recovered.turns;
        recoveredHistoryIsTruncated = recovered.hasOlderMessages;
        if (ownsCacheLock) {
          await this.redis.delRequired(key);
          if (turns.length > 0) {
            await Promise.all(
              turns.map((turn, index) =>
                this.redis.zaddRequired(
                  key,
                  (turn.ts ?? Date.now()) + index / 1_000,
                  this.serializeStoredTurn(turn),
                ),
              ),
            );
            await this.redis.expire(key, TTL_SECONDS);
          }
        }
      } catch (error) {
        this.logger.warn(
          `Recent history cache recovery failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        if (ownsCacheLock) await this.redis.releaseLock(lockKey, lockValue);
      }
    }
    const formattedSummary = summary
      ? this.formatSummary(
          summary,
          Math.min(1_500, Math.max(0, tokenBudget - 12)),
        )
      : '';
    const summaryTokens = formattedSummary
      ? this.estimateTokens(formattedSummary) + 12
      : 0;
    const recentTurns = this.selectRecentTurns(
      turns,
      maxMessages,
      Math.max(0, tokenBudget - summaryTokens),
    );
    const truncated =
      Boolean(summary) ||
      recoveredHistoryIsTruncated ||
      recentTurns.length < turns.length;

    // 构建 systemMessage
    const blocks: string[] = [];
    if (formattedSummary) {
      blocks.push(`【历史对话结构化变更摘要】\n${formattedSummary}`);
    }
    if (truncated) {
      blocks.push(
        summary
          ? '（较早的对话已压缩为摘要；本轮只带入最近的原始对话）'
          : '（本轮只带入最近的原始对话；更早的内容仍保存在会话记录中）',
      );
    }

    const systemMessage =
      blocks.length > 0 ? new SystemMessage(blocks.join('\n\n')) : null;

    return { systemMessage, recentTurns, truncatedHistory: truncated };
  }

  /**
   * 添加一轮对话到短期记忆
   */
  async addTurn(
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    messageId?: string,
  ): Promise<ContextCompactionAudit | null> {
    return this.storeTurns(
      conversationId,
      [{ role, content, messageId }],
      MAX_HISTORY_CONTEXT_TOKENS,
      false,
    );
  }

  /** 用户问题和助手回复一起写入；一轮结束后只做一次压缩判断。 */
  async addTurns(
    conversationId: string,
    turns: Array<{
      role: 'user' | 'assistant';
      content: string;
      messageId?: string;
    }>,
    tokenBudget = MAX_HISTORY_CONTEXT_TOKENS,
  ): Promise<ContextCompactionAudit | null> {
    return this.storeTurns(conversationId, turns, tokenBudget, true);
  }

  /**
   * 结合当前模型窗口、输出预算、检索上下文和问题长度，估算本轮可分给历史的 token。
   * 8k 是应用自身的上限；模型窗口由配置提供，不把供应商的输出 token 上限误当上下文窗口。
   */
  getAvailableHistoryTokenBudget(
    query: string,
    retrievalContextCharacters = MAX_RETRIEVAL_CONTEXT_CHARACTERS,
    model?: string,
  ): number {
    const configuredProvider = this.config?.get<string>('llm.provider');
    const provider = ['qwen', 'deepseek', 'zhipu'].includes(model ?? '')
      ? model
      : configuredProvider;
    const contextWindowTokens =
      this.config?.get<number>('llm.contextWindowTokens') ?? 32_768;
    const outputTokenBudget =
      (provider
        ? this.config?.get<number>(`llm.${provider}.maxTokens`)
        : undefined) ?? 4_096;
    const retrievalTokenReserve = Math.ceil(
      Math.max(0, retrievalContextCharacters) * 0.75,
    );
    const available =
      contextWindowTokens -
      outputTokenBudget -
      SYSTEM_CONTEXT_RESERVE_TOKENS -
      retrievalTokenReserve -
      this.estimateTokens(query);

    return Math.max(0, Math.min(MAX_HISTORY_CONTEXT_TOKENS, available));
  }

  /**
   * Enforce the system-context reserve without truncating policy or role rules.
   * Optional context is selected whole, by priority, so memory facts are never
   * cut mid-sentence and then presented as complete.
   */
  budgetSystemContext(
    candidates: readonly ContextMessageCandidate[],
    tokenBudget = SYSTEM_CONTEXT_RESERVE_TOKENS,
  ): ContextMessageBudgetResult {
    const budgetTokens = Math.max(0, Math.floor(tokenBudget));
    const kept = new Set<number>();
    const costs = candidates.map(
      ({ content }) => this.estimateTokens(content) + 4,
    );
    let estimatedTokens = 0;

    candidates.forEach((candidate, index) => {
      if (candidate.required) {
        kept.add(index);
        estimatedTokens += costs[index];
      }
    });

    const optional = candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => !candidate.required)
      .sort(
        (left, right) =>
          right.candidate.priority - left.candidate.priority ||
          left.index - right.index,
      );
    for (const { index } of optional) {
      if (estimatedTokens + costs[index] > budgetTokens) continue;
      kept.add(index);
      estimatedTokens += costs[index];
    }

    return {
      messages: candidates
        .map((candidate, index) => ({ candidate, index }))
        .filter(({ index }) => kept.has(index))
        .sort(
          (left, right) =>
            right.candidate.priority - left.candidate.priority ||
            left.index - right.index,
        )
        .map(({ candidate }) => ({
          source: candidate.source,
          role: candidate.role,
          content: candidate.content,
        })),
      budgetTokens,
      estimatedTokens,
      overflowTokens: Math.max(0, estimatedTokens - budgetTokens),
      retainedSources: [
        ...new Set(
          candidates.flatMap((candidate, index) =>
            kept.has(index) ? [candidate.source] : [],
          ),
        ),
      ],
      droppedSources: candidates
        .flatMap((candidate, index) =>
          kept.has(index) ? [] : [candidate.source],
        )
        .filter((source, index, sources) => sources.indexOf(source) === index),
    };
  }

  /**
   * 清理会话记忆（会话结束时调用）
   */
  async clearConversation(conversationId: string): Promise<void> {
    if (!this.redis.isConfigured()) return;
    await Promise.all([
      this.redis.delRequired(this.turnsKey(conversationId)),
      this.redis.delRequired(this.summaryKey(conversationId)),
      this.redis.delRequired(this.auditKey(conversationId)),
    ]);
  }

  /** limit 只控制审计记录列表展示，不是历史上下文的消息窗口。 */
  async getCompactionAudit(
    conversationId: string,
    limit = 20,
  ): Promise<ContextCompactionAudit[]> {
    if (!this.redis.isEnabled()) return [];
    const raw = await this.redis.zrange(
      this.auditKey(conversationId),
      -Math.max(limit, 1),
      -1,
    );
    return raw
      .map((item) => this.tryParseAudit(item))
      .filter((item): item is ContextCompactionAudit => Boolean(item));
  }
}
