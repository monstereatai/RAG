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
import { IsNull, Repository } from 'typeorm';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { ConversationEntity } from '../../providers/db/entities/conversation.entity';
import { MessageEntity } from '../../providers/db/entities/message.entity';
import { SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { AgentRuntimeEventsService } from '../agent-runtime-events/agent-runtime-events.service';
import { MetricsService } from '../metrics/metrics.service';
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
const COMPACTION_LOCK_TTL_SECONDS = 300;
const HISTORY_CACHE_LOCK_TTL_SECONDS = 30;
const SUMMARY_RECOVERY_PAGE_SIZE = 100;
const SUMMARY_RECOVERY_CHUNK_TOKEN_BUDGET = 5_000;
const SUMMARY_RECOVERY_MESSAGE_PART_CHARACTERS = 1_200;
const SUMMARY_RECOVERY_PREVIOUS_TOKEN_BUDGET = 1_500;
const SUMMARY_RECOVERY_RECENT_MESSAGE_COUNT = DEFAULT_MESSAGE_SAFETY_CAP;

const structuredMemorySummarySchema = z.object({
  schemaVersion: z.literal(1),
  compactedThroughMessageId: z.string().optional(),
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
  summaryMode?: 'llm';
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
      const recovered = await this.loadRecentTurnsFromPostgres(
        conversationId,
        maxMessages,
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
    const summaryWatermark = summary
      ? this.tryParseSummary(summary)?.compactedThroughMessageId
      : undefined;
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
      const expectedMessageIds =
        watermarkIndex >= 0
          ? recentMessageIds.ids.slice(watermarkIndex + 1)
          : recentMessageIds.ids;
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
          summary
            ? this.tryParseSummary(summary)?.compactedThroughMessageId
            : undefined,
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
      messages: candidates.flatMap((candidate, index) =>
        kept.has(index)
          ? [
              {
                source: candidate.source,
                role: candidate.role,
                content: candidate.content,
              },
            ]
          : [],
      ),
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
    if (
      all.length > this.getMessageSafetyCap() ||
      estimatedTokens + summaryTokens > tokenBudget
    ) {
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
    const rawHistoryBudget = Math.max(0, tokenBudget - summaryTokens);
    const keepStart = this.findKeepStart(
      all,
      maxMessages,
      rawHistoryBudget,
    );
    if (keepStart <= 0) return null;

    const toTrim = all.slice(0, keepStart);

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
      sourceTurnCount: keepStart,
      retainedTurnCount: all.length - keepStart,
      sourceTokenEstimate: this.estimateTokens(trimmedContent),
      createdAt: new Date().toISOString(),
    };
    await this.saveAudit(conversationId, audit);
    await this.emitAuditEvent(
      conversationId,
      'memory.compaction.started',
      audit,
    );

    let summary: StructuredMemorySummary;
    try {
      // cd 调用LLM压缩对话历史
      const raw = await this.llmProvider.invoke([
        new SystemMessage(
          `你是产研运上下文压缩器。只输出 JSON，必须符合：
{"schemaVersion":1,"changes":[{"role":"岗位","module":"模块","before":"修改前，无则写未知","after":"修改后","version":"活动或文档版本，无则写未标注","effectiveFrom":"生效时间，无则写待确认","evidence":"原对话短句"}],"decisions":["已确认决策"],"openIssues":["待确认项"],"sourceDigest":"不超过500字的事实摘要"}。
只保留产品规则、UI 参数、接口字段、测试口径、运营配置及明确决策；禁止补写输入中不存在的事实。具体接口和规则仍需从知识库召回，摘要不是权威事实源。`,
        ),
        {
          role: 'user' as const,
          content: `旧摘要：${existingSummary || '无'}\n\n待压缩对话：\n${trimmedContent}`,
        },
      ]);
      const lastTrimmedTurn = JSON.parse(toTrim[toTrim.length - 1]) as StoredTurn;
      summary = {
        ...this.parseStructuredSummary(raw),
        compactedThroughMessageId: lastTrimmedTurn.messageId,
      };
    } catch (err) {
      this.logger.warn(
        `Short-term memory summarization failed: ${(err as Error).message}`,
      );
      const failed = {
        ...audit,
        status: 'failed' as const,
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
      completedAt: new Date().toISOString(),
    };
    await this.saveAudit(conversationId, completed);
    await this.emitAuditEvent(
      conversationId,
      'memory.compaction.completed',
      completed,
    );

    this.logger.debug(
      `Short-term memory compressed: removed ${keepStart} turns, kept ${all.length - keepStart}`,
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

  private async loadRecentTurnsFromPostgres(
    conversationId: string,
    maxMessages: number,
    compactedThroughMessageId?: string,
  ): Promise<{ turns: StoredTurn[]; hasOlderMessages: boolean }> {
    const limit = Math.max(1, maxMessages);
    const messages = await this.messageRepo
      .createQueryBuilder('message')
      .where('message.conversationId = :conversationId', { conversationId })
      .orderBy('message.createdAt', 'DESC')
      .addOrderBy(
        "CASE WHEN message.role = 'human' THEN 0 WHEN message.role = 'ai' THEN 1 ELSE 2 END",
        'DESC',
      )
      .addOrderBy('message.id', 'DESC')
      .take(limit + 1)
      .getMany();
    const hasOlderMessages = messages.length > limit;
    const recentMessages = messages.slice(0, limit).reverse();
    const watermarkIndex = compactedThroughMessageId
      ? recentMessages.findIndex(
          (message) => message.id === compactedThroughMessageId,
        )
      : -1;
    const uncompressedMessages =
      watermarkIndex >= 0
        ? recentMessages.slice(watermarkIndex + 1)
        : recentMessages;
    const turns = uncompressedMessages
      .map((message) => ({
        messageId: message.id,
        role: message.role === 'ai' ? ('assistant' as const) : ('user' as const),
        content: this.messageContent(message.content),
        ts: message.createdAt.getTime(),
      }));
    return { turns, hasOlderMessages };
  }

  private async loadRecentMessageIdsFromPostgres(
    conversationId: string,
    maxMessages: number,
  ): Promise<{ ids: string[]; hasOlderMessages: boolean }> {
    const limit = Math.max(1, maxMessages);
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
      .take(limit + 1)
      .getMany();
    return {
      ids: messages.slice(0, limit).reverse().map((message) => message.id),
      hasOlderMessages: messages.length > limit,
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
      if ((result.affected ?? 0) > 0) return rawSummary;
      // 多实例同时恢复时，只允许首个结果写入；后完成的任务读取赢家，避免覆盖新摘要。
      return (await this.getPersistentSummary(conversationId)) || null;
    } catch (error) {
      this.logger.warn(
        `Persistent summary recovery could not be saved: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async summarizeRecoveryChunk(
    previous: StructuredMemorySummary | null,
    source: string,
  ): Promise<StructuredMemorySummary> {
    const previousSummary = previous
      ? this.formatSummary(
          JSON.stringify(previous),
          SUMMARY_RECOVERY_PREVIOUS_TOKEN_BUDGET,
        )
      : '无';
    const raw = await this.llmProvider.invoke([
      new SystemMessage(
        `你是产研运上下文压缩器。只输出 JSON，必须符合：
{"schemaVersion":1,"changes":[{"role":"岗位","module":"模块","before":"修改前，无则写未知","after":"修改后","version":"活动或文档版本，无则写未标注","effectiveFrom":"生效时间，无则写待确认","evidence":"原对话短句"}],"decisions":["已确认决策"],"openIssues":["待确认项"],"sourceDigest":"不超过500字的事实摘要"}。
将此前摘要与本批对话合并；保留此前仍有效的事实，有明确冲突时以较新的原文为准并记录新值。只保留产品规则、UI 参数、接口字段、测试口径、运营配置及明确决策；禁止补写输入中不存在的事实。具体接口和规则仍需从知识库召回，摘要不是权威事实源。`,
      ),
      {
        role: 'user' as const,
        content: `此前摘要：\n${previousSummary}\n\n本批早期对话：\n${source}`,
      },
    ]);
    return this.parseStructuredSummary(raw);
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

  private findKeepStart(
    all: string[],
    maxMessages: number,
    tokenBudget: number,
  ): number {
    let tokens = 0;
    let kept = 0;
    let index = all.length;
    const recentTokenBudget = Math.max(tokenBudget, 0);
    while (index > 0 && kept < maxMessages) {
      const nextTokens = this.estimateStoredTurnTokens([all[index - 1]]);
      if (tokens + nextTokens > recentTokenBudget) break;
      index -= 1;
      kept += 1;
      tokens += nextTokens;
    }
    if (index < all.length) {
      try {
        const firstKept = JSON.parse(all[index]) as StoredTurn;
        if (firstKept.role === 'assistant' && index > 0) {
          index -= 1;
        }
      } catch {
        // malformed cache entry falls back to the token boundary
      }
    }
    return index;
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
    return structuredMemorySummarySchema.parse(JSON.parse(candidate));
  }

  private tryParseSummary(raw: string): StructuredMemorySummary | null {
    try {
      return structuredMemorySummarySchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private formatSummary(raw: string, tokenBudget = 1_500): string {
    const summary = this.tryParseSummary(raw);
    if (!summary) return this.truncateToTokenBudget(raw, tokenBudget);
    const candidates = [
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
