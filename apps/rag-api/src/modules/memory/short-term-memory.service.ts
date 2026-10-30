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
import { Brackets, IsNull, Repository } from 'typeorm';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { ConversationEntity } from '../../providers/db/entities/conversation.entity';
import { MessageEntity } from '../../providers/db/entities/message.entity';
import { SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { AgentRuntimeEventsService } from '../agent-runtime-events/agent-runtime-events.service';
import { MetricsService } from '../metrics/metrics.service';
import { countTextTokens } from '../document/chunking.util';
import { getPromptVersion } from '../../rag/prompts/prompt-registry';
import {
  shortTermSummaryCompactionSystemPrompt,
  shortTermSummaryRecoverySystemPrompt,
} from './memory.prompts';
import type {
  ContextMessageBudgetResult,
  ContextMessageCandidate,
} from '../../rag/contracts/context-budget';

interface StoredTurn {
  messageId?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts?: number;
}

const DEFAULT_MESSAGE_SAFETY_CAP = 200;
const TTL_SECONDS = 86400; // 24 小时过期
const MAX_HISTORY_CONTEXT_TOKENS = 8_000;
const SYSTEM_CONTEXT_RESERVE_TOKENS = 2_048;
const MAX_RETRIEVAL_CONTEXT_CHARACTERS = 10_000;
const COMPACTION_TRIGGER_RATIO = 0.9;
const COMPACTION_TARGET_TOKEN_RATIO = 0.7;
const COMPACTION_RETAINED_MESSAGE_RATIO = 0.3;
const COMPACTION_LOCK_TTL_SECONDS = 300;
const HISTORY_CACHE_LOCK_TTL_SECONDS = 30;
const SUMMARY_RECOVERY_PAGE_SIZE = 100;
const SUMMARY_RECOVERY_CHUNK_TOKEN_BUDGET = 5_000;
const SUMMARY_RECOVERY_MESSAGE_PART_CHARACTERS = 1_200;
const SUMMARY_RECOVERY_PREVIOUS_TOKEN_BUDGET = 1_500;
const SUMMARY_RECOVERY_RECENT_MESSAGE_COUNT = DEFAULT_MESSAGE_SAFETY_CAP;
const COMPACTION_STRATEGY_CONFIDENCE_THRESHOLD = 0.6;
const SUMMARY_MAX_LIST_ITEMS = 12;
const SUMMARY_MAX_ITEM_CHARACTERS = 160;
const SUMMARY_MAX_GOAL_CHARACTERS = 240;
const SUMMARY_MAX_DIGEST_CHARACTERS = 500;

type CompactionStrategy = 'middle-removal' | 'oldest-removal' | 'hybrid';
type RemovalStrategy = Exclude<CompactionStrategy, 'hybrid'>;

const structuredMemorySummarySchema = z.object({
  schemaVersion: z.literal(1),
  compactedThroughMessageId: z.string().optional(),
  compactedMessageIds: z.array(z.string()).optional(),
  currentGoal: z.string().default(''),
  constraints: z.array(z.string()).default([]),
  nextActions: z.array(z.string()).default([]),
  changes: z.array(
    z.object({
      role: z.string(),
      module: z.string(),
      before: z.string(),
      after: z.string(),
      version: z.string(),
      effectiveFrom: z.string(),
      evidence: z.string(),
    }),
  ),
  decisions: z.array(z.string()),
  openIssues: z.array(z.string()),
  sourceDigest: z.string(),
});

type StructuredMemorySummary = z.infer<typeof structuredMemorySummarySchema>;

export interface ContextCompactionAudit {
  id: string;
  status: 'started' | 'completed' | 'failed';
  reason: 'turn_window' | 'token_budget' | 'manual';
  sourceTurnCount: number;
  retainedTurnCount: number;
  sourceTokenEstimate: number;
  baseStrategy?: CompactionStrategy;
  selectedStrategy?: RemovalStrategy;
  strategyConfidence?: number;
  adaptiveComparison?: Record<string, number>;
  summaryMode?: 'llm';
  promptVersion?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

@Injectable()
export class ShortTermMemoryService {
  /**
   * PostgreSQL 保存完整历史和摘要；Redis 热窗口命中后先核对消息 ID，损坏或过期时从 PostgreSQL 重建。
   */
  private readonly logger = new Logger(ShortTermMemoryService.name);
  private readonly summaryRecoveryInFlight = new Map<
    string,
    Promise<string | null>
  >();

  constructor(
    private readonly redis: RedisProvider,
    private readonly llmProvider: LlmProvider,
    @InjectRepository(ConversationEntity)
    private readonly conversationRepo: Repository<ConversationEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: Repository<MessageEntity>,
    @Optional() private readonly runtimeEvents?: AgentRuntimeEventsService,
    @Optional() private readonly metricsService?: MetricsService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  /** 消息条数只是安全阀，不是上下文窗口的主策略；主策略是 token 预算。 */
  getMessageSafetyCap(): number {
    const configured =
      this.config?.get<number>('memory.messageSafetyCap') ??
      Number(process.env.SHORT_TERM_MESSAGE_SAFETY_CAP ?? '');
    if (Number.isFinite(configured) && configured > 0) {
      return Math.min(Math.max(Math.floor(configured), 20), 2_000);
    }
    return DEFAULT_MESSAGE_SAFETY_CAP;
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
    let raw = await this.redis.zrange(key, 0, -1);
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
    const compactedMessageIds = summaryState?.compactedMessageIds ?? [];
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
          compactedMessageIds,
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
      const watermarkIndex = summaryWatermark
        ? recentMessageIds.ids.indexOf(summaryWatermark)
        : -1;
      const expectedMessageIdsWithWatermark =
        watermarkIndex >= 0
          ? recentMessageIds.ids.slice(watermarkIndex + 1)
          : recentMessageIds.ids;
      const compactedMessageIdSet = new Set(compactedMessageIds);
      const expectedMessageIds = expectedMessageIdsWithWatermark.filter(
        (messageId) => !compactedMessageIdSet.has(messageId),
      );
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
      droppedSources: candidates.flatMap((candidate, index) =>
        kept.has(index) ? [] : [candidate.source],
      ).filter((source, index, sources) => sources.indexOf(source) === index),
    };
  }

  limitHistoryToTokenBudget<T extends { content: string; role?: string }>(
    turns: T[],
    tokenBudget: number,
    maxMessages = DEFAULT_MESSAGE_SAFETY_CAP,
  ): T[] {
    let usedTokens = 0;
    let start = turns.length;
    while (start > 0 && turns.length - start < maxMessages) {
      const nextTokens = this.estimateTokens(turns[start - 1].content) + 4;
      if (usedTokens + nextTokens > tokenBudget) break;
      usedTokens += nextTokens;
      start -= 1;
    }
    // 不把 assistant 回复和它的 user 问题拆开；宁可少带一条 assistant。
    while (start < turns.length && turns[start].role === 'assistant') {
      start += 1;
    }
    return turns.slice(start);
  }

  private async storeTurns(
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
        all.length > this.getMessageSafetyCap() ? 'turn_window' : 'token_budget',
        tokenBudget,
      );
    }
    return null;
  }

  /**
   * 裁剪对话历史并生成摘要
   */
  async trimAndSummarize(
    conversationId: string,
    maxMessages = DEFAULT_MESSAGE_SAFETY_CAP,
    reason: ContextCompactionAudit['reason'] = 'manual',
    tokenBudget = MAX_HISTORY_CONTEXT_TOKENS,
  ): Promise<ContextCompactionAudit | null> {
    if (!this.redis.isEnabled()) return null;

    const lockKey = this.compactionLockKey(conversationId);
    const lockValue = randomUUID();
    if (
      !(await this.redis.setIfAbsent(
        lockKey,
        lockValue,
        COMPACTION_LOCK_TTL_SECONDS,
      ))
    ) {
      return null;
    }

    const lockRenewal = setInterval(() => {
      void this.redis.renewLock(
        lockKey,
        lockValue,
        COMPACTION_LOCK_TTL_SECONDS,
      );
    }, 60_000);
    lockRenewal.unref?.();
    try {
      return await this.trimAndSummarizeLocked(
        conversationId,
        maxMessages,
        reason,
        tokenBudget,
      );
    } finally {
      clearInterval(lockRenewal);
      await this.redis.releaseLock(lockKey, lockValue);
    }
  }

  private async trimAndSummarizeLocked(
    conversationId: string,
    maxMessages: number,
    reason: ContextCompactionAudit['reason'],
    tokenBudget: number,
  ): Promise<ContextCompactionAudit | null> {

    const key = this.turnsKey(conversationId);
    const all = await this.redis.zrange(key, 0, -1);

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
    const targetTokenBudget = Math.floor(
      Math.max(0, tokenBudget) * COMPACTION_TARGET_TOKEN_RATIO,
    );
    const rawHistoryBudget = Math.max(0, targetTokenBudget - summaryTokens);
    const retainedMessageLimit = Math.min(
      maxMessages,
      Math.max(2, Math.ceil(all.length * COMPACTION_RETAINED_MESSAGE_RATIO)),
    );
    const turns = all.map((raw) => JSON.parse(raw) as StoredTurn);
    const selection = this.selectCompactionMessages(
      turns,
      retainedMessageLimit,
      rawHistoryBudget,
    );
    if (selection.removeIndexes.length === 0) return null;

    const toTrim = selection.removeIndexes.map((index) => all[index]);
    const retainedCount = all.length - toTrim.length;

    const trimmedContent = toTrim
      .map((r) => {
        const t = JSON.parse(r) as StoredTurn;
        return `${t.role}: ${t.content}`;
      })
      .join('\n');

    const audit: ContextCompactionAudit = {
      id: randomUUID(),
      status: 'started',
      reason,
      sourceTurnCount: toTrim.length,
      retainedTurnCount: retainedCount,
      sourceTokenEstimate: this.estimateTokens(trimmedContent),
      baseStrategy: selection.baseStrategy,
      selectedStrategy: selection.strategy,
      strategyConfidence: selection.confidence,
      ...(selection.adaptiveComparison
        ? { adaptiveComparison: selection.adaptiveComparison }
        : {}),
      createdAt: new Date().toISOString(),
    };
    await this.saveAudit(conversationId, audit);
    await this.emitAuditEvent(
      conversationId,
      'memory.compaction.started',
      audit,
    );

    let summary: StructuredMemorySummary;
    let promptVersion: string | undefined;
    try {
      const previousSummary = existingSummary
        ? this.tryParseSummary(existingSummary)
        : null;
      // cd 调用LLM压缩对话历史
      const summaryMessages = [
        new SystemMessage(shortTermSummaryCompactionSystemPrompt),
        {
          role: 'user' as const,
          content: `旧摘要：${existingSummary ? this.formatSummary(existingSummary, SUMMARY_RECOVERY_PREVIOUS_TOKEN_BUDGET) : '无'}\n\n待压缩对话：\n${trimmedContent}`,
        },
      ];
      await this.assertPromptWithinBudget(summaryMessages, '会话摘要压缩');
      promptVersion = getPromptVersion('memory.summary_compaction');
      const raw = await this.llmProvider.invoke(summaryMessages);
      const compactedIds = new Set([
        ...(previousSummary?.compactedMessageIds ?? []),
        ...toTrim.flatMap((rawTurn) => {
          const turn = JSON.parse(rawTurn) as StoredTurn;
          return turn.messageId ? [turn.messageId] : [];
        }),
      ]);
      const watermark = await this.advanceCompactedPrefix(
        conversationId,
        previousSummary?.compactedThroughMessageId,
        compactedIds,
      );
      summary = {
        ...this.parseStructuredSummary(raw),
        ...(watermark.compactedThroughMessageId
          ? { compactedThroughMessageId: watermark.compactedThroughMessageId }
          : {}),
        compactedMessageIds: watermark.compactedMessageIds,
      };
    } catch (err) {
      this.logger.warn(
        `Short-term memory summarization failed: ${(err as Error).message}`,
      );
      const failed = {
        ...audit,
        status: 'failed' as const,
        ...(promptVersion ? { promptVersion } : {}),
        error: err instanceof Error ? err.message : String(err),
        completedAt: new Date().toISOString(),
      };
      await this.saveAudit(conversationId, failed);
      await this.emitAuditEvent(
        conversationId,
        'memory.compaction.failed',
        failed,
      );
      return failed;
    }

    try {
      // 先落 PostgreSQL，再更新 Redis；删除本次压缩的原始项时按 member 精确删，
      // 避免压缩期间新写入的消息被按排名误删。
      await this.persistSummary(conversationId, summary);
      await this.redis.setRequiredOrThrow(
        this.summaryKey(conversationId),
        JSON.stringify(summary),
        TTL_SECONDS,
      );
      await this.redis.zremRequired(key, ...toTrim);
    } catch (error) {
      const failed = {
        ...audit,
        status: 'failed' as const,
        ...(promptVersion ? { promptVersion } : {}),
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString(),
      };
      await this.saveAudit(conversationId, failed);
      await this.emitAuditEvent(
        conversationId,
        'memory.compaction.failed',
        failed,
      );
      throw error;
    }

    const completed = {
      ...audit,
      status: 'completed' as const,
      summaryMode: 'llm' as const,
      ...(promptVersion ? { promptVersion } : {}),
      completedAt: new Date().toISOString(),
    };
    await this.saveAudit(conversationId, completed);
    await this.emitAuditEvent(
      conversationId,
      'memory.compaction.completed',
      completed,
    );

    this.logger.debug(
      `Short-term memory compressed: strategy=${selection.strategy}, removed ${toTrim.length} turns, kept ${retainedCount}`,
    );
    return completed;
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

  // --- helpers ---

  private turnsKey(conversationId: string): string {
    return `stm:${conversationId}:turns`;
  }

  private summaryKey(conversationId: string): string {
    return `stm:${conversationId}:summary`;
  }

  private compactionLockKey(conversationId: string): string {
    return `stm:${conversationId}:compaction-lock`;
  }

  private historyCacheLockKey(conversationId: string): string {
    return `stm:${conversationId}:history-cache-lock`;
  }

  private auditKey(conversationId: string): string {
    return `stm:${conversationId}:compactions`;
  }

  private async getPersistentSummary(
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

  private async advanceCompactedPrefix(
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
      ...(compactedThroughMessageId
        ? { compactedThroughMessageId }
        : {}),
      compactedMessageIds: [...compactedIds],
    };
  }

  private async loadRecentTurnsFromPostgres(
    conversationId: string,
    maxMessages: number,
    summaryState?: StructuredMemorySummary,
  ): Promise<{ turns: StoredTurn[]; hasOlderMessages: boolean }> {
    const limit = Math.max(1, maxMessages);
    const compactedMessageIds = new Set(summaryState?.compactedMessageIds ?? []);
    const fetchLimit = limit + compactedMessageIds.size + 1;
    const messages = await this.messageRepo
      .createQueryBuilder('message')
      .where('message.conversationId = :conversationId', { conversationId })
      .orderBy('message.createdAt', 'DESC')
      .addOrderBy(
        "CASE WHEN message.role = 'human' THEN 0 WHEN message.role = 'ai' THEN 1 ELSE 2 END",
        'DESC',
      )
      .addOrderBy('message.id', 'DESC')
      .take(fetchLimit)
      .getMany();
    const recentMessages = messages.slice(0, fetchLimit - 1).reverse();
    const watermarkIndex = summaryState?.compactedThroughMessageId
      ? recentMessages.findIndex(
          (message) => message.id === summaryState.compactedThroughMessageId,
        )
      : -1;
    const afterWatermarkMessages =
      watermarkIndex >= 0
        ? recentMessages.slice(watermarkIndex + 1)
        : recentMessages;
    const uncompressedMessages = afterWatermarkMessages.filter(
      (message) => !compactedMessageIds.has(message.id),
    );
    const turns = uncompressedMessages
      .slice(-limit)
      .map((message) => ({
        messageId: message.id,
        role: message.role === 'ai' ? ('assistant' as const) : ('user' as const),
        content: this.messageContent(message.content),
        ts: message.createdAt.getTime(),
      }));
    return {
      turns,
      hasOlderMessages:
        uncompressedMessages.length > limit || messages.length >= fetchLimit,
    };
  }

  private async loadRecentMessageIdsFromPostgres(
    conversationId: string,
    maxMessages: number,
    compactedMessageIds: string[] = [],
  ): Promise<{ ids: string[]; hasOlderMessages: boolean }> {
    const limit = Math.max(1, maxMessages);
    const excludedIds = new Set(compactedMessageIds);
    const fetchLimit = limit + excludedIds.size + 1;
    const messages = await this.messageRepo
      .createQueryBuilder('message')
      .select(['message.id', 'message.role'])
      .where('message.conversationId = :conversationId', { conversationId })
      .orderBy('message.createdAt', 'DESC')
      .addOrderBy(
        "CASE WHEN message.role = 'human' THEN 0 WHEN message.role = 'ai' THEN 1 ELSE 2 END",
        'DESC',
      )
      .addOrderBy('message.id', 'DESC')
      .take(fetchLimit)
      .getMany();
    const uncompressed = messages
      .slice(0, fetchLimit - 1)
      .reverse()
      .filter((message) => !excludedIds.has(message.id));
    return {
      ids: uncompressed.slice(-limit).map((message) => message.id),
      hasOlderMessages:
        uncompressed.length > limit || messages.length >= fetchLimit,
    };
  }

  private messageContent(content: string): string {
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

  private serializeStoredTurn(turn: StoredTurn): string {
    return turn.messageId
      ? JSON.stringify({
          messageId: turn.messageId,
          role: turn.role,
          content: turn.content,
        })
      : JSON.stringify(turn);
  }

  private async resolvePersistentSummary(
    conversationId: string,
  ): Promise<string | null> {
    const existing = await this.getPersistentSummary(conversationId);
    if (existing) return existing;

    const inFlight = this.summaryRecoveryInFlight.get(conversationId);
    if (inFlight) return inFlight;

    const recovery = this.rebuildPersistentSummary(conversationId);
    this.summaryRecoveryInFlight.set(conversationId, recovery);
    try {
      return await recovery;
    } finally {
      if (this.summaryRecoveryInFlight.get(conversationId) === recovery) {
        this.summaryRecoveryInFlight.delete(conversationId);
      }
    }
  }

  private async rebuildPersistentSummary(
    conversationId: string,
  ): Promise<string | null> {
    let summary: StructuredMemorySummary | null = null;
    let compactedThroughMessageId: string | undefined;
    let sourceParts: string[] = [];
    let sourceTokens = 0;
    const promptVersions = new Set<string>();

    try {
      const messageCount = await this.messageRepo.count({
        where: { conversationId },
      });
      const historicalMessageCount =
        messageCount - SUMMARY_RECOVERY_RECENT_MESSAGE_COUNT;
      if (historicalMessageCount <= 0) return null;

      // 分页读取旧会话，控制单次数据库查询的行数和内存占用。
      for (
        let offset = 0;
        offset < historicalMessageCount;
        offset += SUMMARY_RECOVERY_PAGE_SIZE
      ) {
        const messages = await this.messageRepo
          .createQueryBuilder('message')
          .select([
            'message.role',
            'message.content',
            'message.createdAt',
            'message.id',
          ])
          .where('message.conversationId = :conversationId', {
            conversationId,
          })
          .orderBy('message.createdAt', 'ASC')
          .addOrderBy(
            "CASE WHEN message.role = 'human' THEN 0 WHEN message.role = 'ai' THEN 1 ELSE 2 END",
            'ASC',
          )
          .addOrderBy('message.id', 'ASC')
          .skip(offset)
          .take(
            Math.min(
              SUMMARY_RECOVERY_PAGE_SIZE,
              historicalMessageCount - offset,
            ),
          )
          .getMany();

        for (const message of messages) {
          compactedThroughMessageId = message.id;
          const role = message.role === 'ai' ? 'assistant' : 'user';
          for (const part of this.splitRecoveryMessage(
            this.messageContent(message.content ?? ''),
          )) {
            const sourceLine = `${role}: ${part}`;
            const partTokens = this.estimateTokens(sourceLine) + 4;
            if (
              sourceParts.length > 0 &&
              sourceTokens + partTokens > SUMMARY_RECOVERY_CHUNK_TOKEN_BUDGET
            ) {
              summary = await this.summarizeRecoveryChunk(
                summary,
                sourceParts.join('\n'),
                promptVersions,
              );
              sourceParts = [];
              sourceTokens = 0;
            }
            sourceParts.push(sourceLine);
            sourceTokens += partTokens;
          }
        }
      }

      if (sourceParts.length > 0) {
        summary = await this.summarizeRecoveryChunk(
          summary,
          sourceParts.join('\n'),
          promptVersions,
        );
      }
      if (!summary) return null;
      if (compactedThroughMessageId) {
        summary = { ...summary, compactedThroughMessageId };
      }
    } catch (error) {
      this.logger.warn(
        `Persistent summary recovery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.emitSummaryRecoveryAudit(conversationId, 'failed', promptVersions, {
        error: error instanceof Error ? error.message : String(error),
      });
      // 恢复失败时不保存兜底文本；下次读取仍可重试，原始消息继续保留在 PostgreSQL。
      return null;
    }

    const rawSummary = JSON.stringify(summary);
    try {
      const result = await this.conversationRepo.update(
        { id: conversationId, contextSummary: IsNull() },
        {
          contextSummary: rawSummary,
          contextSummaryVersion: summary.schemaVersion,
          contextSummaryUpdatedAt: new Date(),
        },
      );
      if ((result.affected ?? 0) > 0) {
        await this.emitSummaryRecoveryAudit(conversationId, 'completed', promptVersions, {
          persistedByThisRequest: true,
        });
        return rawSummary;
      }
      // 多实例同时恢复时，只允许首个结果写入；后完成的任务读取赢家，避免覆盖新摘要。
      const winner = (await this.getPersistentSummary(conversationId)) || null;
      await this.emitSummaryRecoveryAudit(conversationId, 'completed', promptVersions, {
        persistedByThisRequest: false,
      });
      return winner;
    } catch (error) {
      this.logger.warn(
        `Persistent summary recovery could not be saved: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.emitSummaryRecoveryAudit(conversationId, 'failed', promptVersions, {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async summarizeRecoveryChunk(
    previous: StructuredMemorySummary | null,
    source: string,
    promptVersions: Set<string>,
  ): Promise<StructuredMemorySummary> {
    const previousSummary = previous
      ? this.formatSummary(
          JSON.stringify(previous),
          SUMMARY_RECOVERY_PREVIOUS_TOKEN_BUDGET,
        )
      : '无';
    const summaryMessages = [
      new SystemMessage(shortTermSummaryRecoverySystemPrompt),
      {
        role: 'user' as const,
        content: `此前摘要：\n${previousSummary}\n\n本批早期对话：\n${source}`,
      },
    ];
    await this.assertPromptWithinBudget(summaryMessages, '会话摘要恢复');
    promptVersions.add(getPromptVersion('memory.summary_recovery'));
    const raw = await this.llmProvider.invoke(summaryMessages);
    return this.parseStructuredSummary(raw);
  }

  private async emitSummaryRecoveryAudit(
    conversationId: string,
    status: 'completed' | 'failed',
    promptVersions: Set<string>,
    details: Record<string, unknown>,
  ): Promise<void> {
    if (promptVersions.size === 0) return;
    try {
      await this.runtimeEvents?.emit({
        threadId: conversationId,
        eventType: `memory.summary.recovery.${status}`,
        actor: 'short_term_memory',
        payload: {
          promptVersions: [...promptVersions],
          ...details,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Short-term memory recovery audit event failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async assertPromptWithinBudget(
    messages: Array<{ content: unknown }>,
    operation: string,
  ): Promise<void> {
    const promptText = messages
      .map(({ content }) =>
        typeof content === 'string' ? content : JSON.stringify(content),
      )
      .join('\n');
    const estimatedInputTokens =
      (await countTextTokens(promptText)) + messages.length * 4;
    const maxInputTokens = this.getMaxInputTokens();
    if (estimatedInputTokens > maxInputTokens) {
      throw new Error(
        `${operation}固定指令与原始输入超过模型输入预算：${estimatedInputTokens}/${maxInputTokens} tokens`,
      );
    }
  }

  private getMaxInputTokens(): number {
    const configuredWindow = Number(
      this.config?.get<number>('llm.contextWindowTokens'),
    );
    const contextWindow =
      Number.isFinite(configuredWindow) && configuredWindow > 0
        ? configuredWindow
        : 32_768;
    const activeProvider = this.llmProvider.getActiveProviderName();
    const providers = [
      activeProvider,
      this.llmProvider.getRoutePolicy('fast', activeProvider).fallback,
    ].filter(
      (provider): provider is NonNullable<typeof provider> => Boolean(provider),
    );
    const outputBudget = Math.max(
      4_096,
      ...providers.map((provider) => {
        const configuredOutput = Number(
          this.config?.get<number>(`llm.${provider}.maxTokens`),
        );
        return Math.max(
          Number.isFinite(configuredOutput) && configuredOutput > 0
            ? configuredOutput
            : 4_096,
          this.llmProvider.getRoutePolicy('fast', provider).maxTokens,
        );
      }),
    );
    const safetyMargin = Math.max(256, Math.ceil(contextWindow * 0.1));
    return Math.max(1, contextWindow - outputBudget - safetyMargin);
  }

  private *splitRecoveryMessage(content: string): Generator<string> {
    if (!content) return;
    let offset = 0;
    while (offset < content.length) {
      let end = Math.min(
        offset + SUMMARY_RECOVERY_MESSAGE_PART_CHARACTERS,
        content.length,
      );
      // 不在 UTF-16 代理对中间切开字符。
      const lastCharacter = content.charCodeAt(end - 1);
      const nextCharacter = content.charCodeAt(end);
      if (
        end < content.length &&
        lastCharacter >= 0xd800 &&
        lastCharacter <= 0xdbff &&
        nextCharacter >= 0xdc00 &&
        nextCharacter <= 0xdfff
      ) {
        end -= 1;
      }
      yield content.slice(offset, end);
      offset = end;
    }
  }

  private async persistSummary(
    conversationId: string,
    summary: StructuredMemorySummary,
  ): Promise<void> {
    await this.conversationRepo.update(conversationId, {
      contextSummary: JSON.stringify(summary),
      contextSummaryVersion: summary.schemaVersion,
      contextSummaryUpdatedAt: new Date(),
    });
  }

  private toSummarySystemMessage(
    summary: string,
    tokenBudget: number,
  ): SystemMessage | null {
    const formattedSummary = this.formatSummary(summary, tokenBudget);
    return formattedSummary
      ? new SystemMessage(`【历史对话结构化变更摘要】\n${formattedSummary}`)
      : null;
  }

  private async saveAudit(
    conversationId: string,
    audit: ContextCompactionAudit,
  ): Promise<void> {
    const key = this.auditKey(conversationId);
    await this.redis.zadd(key, Date.now(), JSON.stringify(audit));
    await this.redis.zremrangebyrank(key, 0, -51);
    await this.redis.expire(key, TTL_SECONDS);
  }

  private async emitAuditEvent(
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

  private tryParseAudit(raw: string): ContextCompactionAudit | null {
    try {
      return JSON.parse(raw) as ContextCompactionAudit;
    } catch {
      return null;
    }
  }

  private selectCompactionMessages(
    turns: StoredTurn[],
    maxRetained: number,
    targetTokens: number,
  ): {
    removeIndexes: number[];
    baseStrategy: CompactionStrategy;
    strategy: RemovalStrategy;
    confidence: number;
    adaptiveComparison?: Record<string, number>;
  } {
    const tokens = turns.map(
      (turn) => this.estimateTokens(`${turn.role}: ${turn.content}`) + 4,
    );
    const totalTokens = tokens.reduce((total, value) => total + value, 0);
    const baseStrategy = this.getBaseCompactionStrategy();
    let strategy: RemovalStrategy;
    let confidence = 1;
    let adaptiveComparison: Record<string, number> | undefined;

    if (baseStrategy === 'hybrid') {
      const recommendation = this.recommendRemovalStrategy(
        turns,
        tokens,
        totalTokens,
        targetTokens,
      );
      confidence = recommendation.confidence;
      if (confidence >= COMPACTION_STRATEGY_CONFIDENCE_THRESHOLD) {
        strategy = recommendation.strategy;
      } else {
        const middle = this.runRemovalStrategy(
          turns,
          tokens,
          maxRetained,
          targetTokens,
          'middle-removal',
        );
        const oldest = this.runRemovalStrategy(
          turns,
          tokens,
          maxRetained,
          targetTokens,
          'oldest-removal',
        );
        const middleScore = this.removalEfficiencyScore(middle, totalTokens, turns.length);
        const oldestScore = this.removalEfficiencyScore(oldest, totalTokens, turns.length);
        strategy = middleScore >= oldestScore ? 'middle-removal' : 'oldest-removal';
        adaptiveComparison = {
          middleRemoval: middleScore,
          oldestRemoval: oldestScore,
        };
      }
    } else {
      strategy = baseStrategy;
    }

    const selected = this.runRemovalStrategy(
      turns,
      tokens,
      maxRetained,
      targetTokens,
      strategy,
    );
    return {
      removeIndexes: [...selected.removeIndexes].sort((left, right) => left - right),
      baseStrategy,
      strategy,
      confidence,
      ...(adaptiveComparison ? { adaptiveComparison } : {}),
    };
  }

  private getBaseCompactionStrategy(): CompactionStrategy {
    const provider = this.llmProvider.getActiveProviderName().toLowerCase();
    const model = this.config?.get<string>(`llm.${provider}.model`)?.toLowerCase() ?? '';
    if (provider === 'openai') return /\bo1(?:-|$)/.test(model) ? 'middle-removal' : 'hybrid';
    if (provider === 'anthropic') return 'oldest-removal';
    if (provider === 'google' && /1\.5/.test(model)) return 'middle-removal';
    if (['lmstudio', 'ollama', 'local'].includes(provider)) return 'hybrid';
    // 参考文档未给 Qwen、DeepSeek、GLM 等模型的映射，沿用项目原有的最旧优先策略。
    return 'oldest-removal';
  }

  private recommendRemovalStrategy(
    turns: StoredTurn[],
    tokens: number[],
    totalTokens: number,
    targetTokens: number,
  ): { strategy: RemovalStrategy; confidence: number } {
    const compressionRatio = totalTokens > 0 ? targetTokens / totalTokens : 1;
    const severity =
      compressionRatio > 0.8
        ? 'light'
        : compressionRatio > 0.6
          ? 'moderate'
          : 'heavy';
    const recentTokens = tokens.slice(-5).reduce((total, value) => total + value, 0);
    const recentRatio = totalTokens > 0 ? recentTokens / totalTokens : 0;
    const hasLongMessages = tokens.some((value) => value > 300);
    const hasSystemMessages = turns.some((turn) => turn.role === 'system');

    if (severity === 'light' && turns.length < 20) {
      return { strategy: 'middle-removal', confidence: 0.8 };
    }
    if (severity === 'heavy' && turns.length > 30) {
      return { strategy: 'oldest-removal', confidence: 0.9 };
    }
    if (recentRatio > 0.4) {
      return { strategy: 'middle-removal', confidence: 0.7 };
    }
    if (hasLongMessages && severity !== 'light') {
      return { strategy: 'oldest-removal', confidence: 0.6 };
    }
    if (hasSystemMessages) {
      return { strategy: 'middle-removal', confidence: 0.7 };
    }
    return { strategy: 'oldest-removal', confidence: 0.5 };
  }

  private runRemovalStrategy(
    turns: StoredTurn[],
    tokens: number[],
    maxRetained: number,
    targetTokens: number,
    strategy: RemovalStrategy,
  ): { removeIndexes: Set<number>; remainingTokens: number; retainedCount: number } {
    const removable = turns
      .map((turn, index) => ({ turn, index }))
      .filter(({ turn }) => turn.role !== 'system');
    const priorities = turns.map((turn, index) =>
      this.messagePriority(turn, index, turns.length, tokens[index]),
    );
    const byPriorityThenAge = (left: number, right: number) =>
      priorities[left] - priorities[right] || left - right;
    let candidates: number[];

    if (strategy === 'oldest-removal') {
      candidates = removable.map(({ index }) => index).sort(byPriorityThenAge);
    } else {
      const preserveStart = Math.min(2, Math.ceil(turns.length * 0.2));
      const preserveEnd = Math.min(4, Math.max(2, Math.ceil(turns.length * 0.3)));
      const middleEnd = Math.max(preserveStart, turns.length - preserveEnd);
      const middle = removable
        .map(({ index }) => index)
        .filter((index) => index >= preserveStart && index < middleEnd)
        .sort(
          (left, right) =>
            priorities[left] - priorities[right] ||
            Math.abs((left + 0.5) - turns.length / 2) -
              Math.abs((right + 0.5) - turns.length / 2),
        );
      const edges = removable
        .map(({ index }) => index)
        .filter((index) => index < preserveStart || index >= middleEnd)
        .sort(byPriorityThenAge);
      candidates = [...middle, ...edges];
    }

    const removeIndexes = new Set<number>();
    let remainingTokens = tokens.reduce((total, value) => total + value, 0);
    let retainedCount = turns.length;
    for (const index of candidates) {
      if (remainingTokens <= targetTokens && retainedCount <= maxRetained) break;
      removeIndexes.add(index);
      remainingTokens -= tokens[index];
      retainedCount -= 1;
    }
    return { removeIndexes, remainingTokens, retainedCount };
  }

  private messagePriority(
    turn: StoredTurn,
    index: number,
    total: number,
    tokens: number,
  ): number {
    if (turn.role === 'system') return 4;
    if (index < 2 || index >= total - 2 || tokens > 800) return 3;
    if (tokens < 20 && !/[?？]/.test(turn.content)) return 0;
    return 1;
  }

  private removalEfficiencyScore(
    result: { remainingTokens: number; retainedCount: number },
    originalTokens: number,
    originalCount: number,
  ): number {
    const tokenReduction =
      originalTokens > 0
        ? (originalTokens - result.remainingTokens) / originalTokens
        : 0;
    const messagePreservation =
      originalCount > 0 ? result.retainedCount / originalCount : 1;
    return tokenReduction * 0.6 + messagePreservation * 0.4;
  }

  private selectRecentTurns(
    turns: StoredTurn[],
    maxMessages: number,
    tokenBudget: number,
  ): StoredTurn[] {
    return this.limitHistoryToTokenBudget(turns, tokenBudget, maxMessages);
  }

  private estimateStoredTurnTokens(rawTurns: string[]): number {
    return rawTurns.reduce((total, raw) => {
      try {
        const turn = JSON.parse(raw) as StoredTurn;
        return total + this.estimateTokens(`${turn.role}: ${turn.content}`) + 4;
      } catch {
        return total + this.estimateTokens(raw);
      }
    }, 0);
  }

  private estimateTokens(text: string): number {
    const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
    return Math.ceil(cjk * 0.75 + Math.max(text.length - cjk, 0) / 4);
  }

  private parseStructuredSummary(raw: string): StructuredMemorySummary {
    const candidate = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
    return this.normalizeSummary(
      structuredMemorySummarySchema.parse(JSON.parse(candidate)),
    );
  }

  private tryParseSummary(raw: string): StructuredMemorySummary | null {
    try {
      return this.normalizeSummary(
        structuredMemorySummarySchema.parse(JSON.parse(raw)),
      );
    } catch {
      return null;
    }
  }

  private normalizeSummary(
    summary: StructuredMemorySummary,
  ): StructuredMemorySummary {
    const boundedText = (value: string, limit: number) =>
      value.trim().slice(0, limit);
    const boundedList = (values: string[]) =>
      [...new Set(values.map((value) => boundedText(value, SUMMARY_MAX_ITEM_CHARACTERS)).filter(Boolean))]
        .slice(-SUMMARY_MAX_LIST_ITEMS);

    return {
      ...summary,
      currentGoal: boundedText(
        summary.currentGoal,
        SUMMARY_MAX_GOAL_CHARACTERS,
      ),
      constraints: boundedList(summary.constraints),
      nextActions: boundedList(summary.nextActions),
      changes: summary.changes
        .slice(-8)
        .map((change) => ({
          role: boundedText(change.role, 40),
          module: boundedText(change.module, 60),
          before: boundedText(change.before, 120),
          after: boundedText(change.after, 120),
          version: boundedText(change.version, 40),
          effectiveFrom: boundedText(change.effectiveFrom, 40),
          evidence: boundedText(change.evidence, 120),
        })),
      decisions: boundedList(summary.decisions),
      openIssues: boundedList(summary.openIssues),
      sourceDigest: boundedText(summary.sourceDigest, SUMMARY_MAX_DIGEST_CHARACTERS),
      ...(summary.compactedMessageIds
        ? { compactedMessageIds: [...new Set(summary.compactedMessageIds)] }
        : {}),
    };
  }

  private formatSummary(raw: string, tokenBudget = 1_500): string {
    const summary = this.tryParseSummary(raw);
    if (!summary) return this.truncateToTokenBudget(raw, tokenBudget);
    const candidates = [
      summary.currentGoal ? `- 当前目标：${summary.currentGoal}` : '',
      ...summary.constraints.map((item) => `- 仍有效的约束：${item}`),
      ...summary.nextActions.map((item) => `- 下一步：${item}`),
      ...summary.changes.map(
        (item) =>
          `- [${item.role}/${item.module}/${item.version}] ${item.before} → ${item.after}；生效：${item.effectiveFrom}；证据：${item.evidence}`,
      ),
      ...summary.decisions.map((item) => `- 决策：${item}`),
      ...summary.openIssues.map((item) => `- 待确认：${item}`),
      summary.sourceDigest ? `- 摘要：${summary.sourceDigest}` : '',
    ].filter(Boolean);
    const lines: string[] = [];
    let usedTokens = 0;
    for (const candidate of candidates) {
      const lineTokens = this.estimateTokens(candidate) + 1;
      if (usedTokens + lineTokens > tokenBudget) continue;
      lines.push(candidate);
      usedTokens += lineTokens;
    }
    return lines.join('\n');
  }

  private truncateToTokenBudget(text: string, tokenBudget: number): string {
    if (tokenBudget <= 0) return '';
    if (this.estimateTokens(text) <= tokenBudget) return text;
    let low = 0;
    let high = text.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.estimateTokens(text.slice(0, middle)) <= tokenBudget) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return text.slice(0, low);
  }
}
