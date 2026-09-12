/**
 * 短期记忆服务（Redis 滑动窗口）
 *
 * 基于 Redis LIST 存储最近 N 轮对话。
 * 超出窗口时自动裁剪旧消息；可选 LLM 摘要压缩（通过 MemoryService 回调）。
 *
 * Key 设计:
 *   stm:{conversationId}:turns  → LIST, 每元素 JSON {role, content, ts}
 *   stm:{conversationId}:summary → STRING, 已裁剪部分的 LLM 摘要
 *
 * 未配置 Redis 时自动静默降级，不阻断对话。
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { ConversationEntity } from '../../providers/db/entities/conversation.entity';
import { MessageEntity } from '../../providers/db/entities/message.entity';
import { SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { AgentRuntimeEventsService } from '../agent-runtime-events/agent-runtime-events.service';
import { MetricsService } from '../metrics/metrics.service';

interface StoredTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: number;
}

const DEFAULT_MAX_TURNS = 20;
const TTL_SECONDS = 86400; // 24 小时过期
const COMPRESSION_TRIGGER_TOKENS = 2000;
const RECENT_CONTEXT_TOKEN_BUDGET = 1200;

const structuredMemorySummarySchema = z.object({
  schemaVersion: z.literal(1),
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
  summaryMode?: 'llm' | 'fallback';
  error?: string;
  createdAt: string;
  completedAt?: string;
}

@Injectable()
export class ShortTermMemoryService {
  /**
   * 会话短期上下文：Redis 保存热窗口，PostgreSQL 保存摘要持久副本。
   * Redis 不可用时仅回退摘要而不阻断问答，确保缓存不是业务事实的唯一来源。
   */
  private readonly logger = new Logger(ShortTermMemoryService.name);

  constructor(
    private readonly redis: RedisProvider,
    private readonly llmProvider: LlmProvider,
    @InjectRepository(ConversationEntity)
    private readonly conversationRepo: Repository<ConversationEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: Repository<MessageEntity>,
    @Optional() private readonly runtimeEvents?: AgentRuntimeEventsService,
    @Optional() private readonly metricsService?: MetricsService,
  ) {}

  isEnabled(): boolean {
    return this.redis.isEnabled();
  }

  /**
   * 获取当前会话的短期记忆上下文
   * 返回：历史摘要（如有）+ 最近 N 轮对话
   */
  /**
   * 按 token 预算返回「摘要 + 最近轮次」；摘要缺失时从 PostgreSQL 恢复并回写 Redis，
   * 由调用方将结果并入本轮上下文，不能把原始完整历史无限制传给模型。
   */
  async getContext(
    conversationId: string,
    maxTurns = DEFAULT_MAX_TURNS,
  ): Promise<{
    systemMessage: SystemMessage | null;
    recentTurns: StoredTurn[];
    truncatedHistory: boolean;
  }> {
    if (!this.redis.isEnabled()) {
      const summary = await this.resolvePersistentSummary(conversationId);
      return {
        systemMessage: summary ? this.toSummarySystemMessage(summary) : null,
        recentTurns: [],
        truncatedHistory: Boolean(summary),
      };
    }

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

    const turns: StoredTurn[] = raw.map((r) => JSON.parse(r) as StoredTurn);

    // 保留最近 maxTurns 条
    const truncated = turns.length > maxTurns;
    const recentTurns = turns.slice(-maxTurns);

    // 构建 systemMessage
    const blocks: string[] = [];
    if (summary) {
      blocks.push(`【历史对话结构化变更摘要】\n${this.formatSummary(summary)}`);
    }
    if (truncated) {
      blocks.push(
        `（由于对话较长，仅保留最近 ${maxTurns} 轮完整对话，更早的内容已摘要记录）`,
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
  ): Promise<ContextCompactionAudit | null> {
    if (!this.redis.isEnabled()) return null;

    const key = this.turnsKey(conversationId);
    const turn: StoredTurn = { role, content, ts: Date.now() };

    await this.redis.zadd(key, turn.ts, JSON.stringify(turn));
    await this.redis.expire(key, TTL_SECONDS);

    const all = await this.redis.zrange(key, 0, -1);
    const estimatedTokens = this.estimateTokens(all.join('\n'));
    if (
      all.length > DEFAULT_MAX_TURNS * 1.5 ||
      estimatedTokens > COMPRESSION_TRIGGER_TOKENS
    ) {
      return this.trimAndSummarize(
        conversationId,
        DEFAULT_MAX_TURNS,
        all.length > DEFAULT_MAX_TURNS * 1.5 ? 'turn_window' : 'token_budget',
      );
    }
    return null;
  }

  /**
   * 裁剪对话历史并生成摘要
   */
  async trimAndSummarize(
    conversationId: string,
    maxTurns = DEFAULT_MAX_TURNS,
    reason: ContextCompactionAudit['reason'] = 'manual',
  ): Promise<ContextCompactionAudit | null> {
    if (!this.redis.isEnabled()) return null;

    const key = this.turnsKey(conversationId);
    const all = await this.redis.zrange(key, 0, -1);

    const keepStart = this.findKeepStart(all, maxTurns);
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

    const existingSummary = await this.redis.get(
      this.summaryKey(conversationId),
    );
    let summary: StructuredMemorySummary;
    let summaryMode: ContextCompactionAudit['summaryMode'] = 'llm';
    try {
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
      summary = this.parseStructuredSummary(raw);
    } catch (err) {
      this.logger.warn(
        `Short-term memory summarization failed: ${(err as Error).message}`,
      );
      summary = this.fallbackSummary(existingSummary, trimmedContent);
      summaryMode = 'fallback';
    }

    try {
      // 保留最近 maxTurns 轮：删除较早的记录
      await this.redis.zremrangebyrank(key, 0, keepStart - 1);
      await this.redis.set(
        this.summaryKey(conversationId),
        JSON.stringify(summary),
        TTL_SECONDS,
      );
      await this.persistSummary(conversationId, summary);
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
      summaryMode,
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
    if (!this.redis.isEnabled()) return;
    await this.redis.del(this.turnsKey(conversationId));
    await this.redis.del(this.summaryKey(conversationId));
    await this.redis.del(this.auditKey(conversationId));
  }

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

  private async resolvePersistentSummary(
    conversationId: string,
  ): Promise<string | null> {
    const existing = await this.getPersistentSummary(conversationId);
    if (existing) return existing;

    // 兼容摘要持久化上线前的历史会话：首次 Redis 丢失时从早期原文重建一次。
    const messages = await this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
    const recentMessageCount = 10; // 与 PostgreSQL 最近 5 轮回退窗口一致。
    if (messages.length <= recentMessageCount) return null;

    const earlierMessages = messages.slice(0, -recentMessageCount);
    const source = earlierMessages
      .map(
        (message) =>
          `${message.role === 'ai' ? 'assistant' : 'user'}: ${message.content}`,
      )
      .join('\n');
    let summary: StructuredMemorySummary;
    try {
      const raw = await this.llmProvider.invoke([
        new SystemMessage(
          `你是产研运上下文压缩器。只输出 JSON，必须符合：
{"schemaVersion":1,"changes":[{"role":"岗位","module":"模块","before":"修改前，无则写未知","after":"修改后","version":"活动或文档版本，无则写未标注","effectiveFrom":"生效时间，无则写待确认","evidence":"原对话短句"}],"decisions":["已确认决策"],"openIssues":["待确认项"],"sourceDigest":"不超过500字的事实摘要"}。
只保留产品规则、UI 参数、接口字段、测试口径、运营配置及明确决策；禁止补写输入中不存在的事实。具体接口和规则仍需从知识库召回，摘要不是权威事实源。`,
        ),
        { role: 'user' as const, content: `待恢复的早期对话：\n${source}` },
      ]);
      summary = this.parseStructuredSummary(raw);
    } catch (error) {
      this.logger.warn(
        `Persistent summary recovery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      summary = this.fallbackSummary(null, source);
    }

    const rawSummary = JSON.stringify(summary);
    await this.persistSummary(conversationId, summary);
    if (this.redis.isEnabled()) {
      await this.redis.set(
        this.summaryKey(conversationId),
        rawSummary,
        TTL_SECONDS,
      );
    }
    return rawSummary;
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

  private toSummarySystemMessage(summary: string): SystemMessage {
    return new SystemMessage(
      `【历史对话结构化变更摘要】\n${this.formatSummary(summary)}`,
    );
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

  private findKeepStart(all: string[], maxTurns: number): number {
    let tokens = 0;
    let kept = 0;
    let index = all.length;
    while (index > 0 && kept < maxTurns) {
      const nextTokens = this.estimateTokens(all[index - 1]);
      if (kept >= 6 && tokens + nextTokens > RECENT_CONTEXT_TOKEN_BUDGET) break;
      index -= 1;
      kept += 1;
      tokens += nextTokens;
    }
    return index;
  }

  private estimateTokens(text: string): number {
    const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
    return Math.ceil(cjk * 0.75 + Math.max(text.length - cjk, 0) / 4);
  }

  private parseStructuredSummary(raw: string): StructuredMemorySummary {
    const candidate = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
    return structuredMemorySummarySchema.parse(JSON.parse(candidate));
  }

  private fallbackSummary(
    existing: string | null,
    trimmedContent: string,
  ): StructuredMemorySummary {
    const previous = existing ? this.tryParseSummary(existing) : null;
    return {
      schemaVersion: 1,
      changes: previous?.changes ?? [],
      decisions: previous?.decisions ?? [],
      openIssues: [
        ...(previous?.openIssues ?? []),
        '本轮结构化压缩失败，精确事实需回查知识库或原会话。',
      ],
      sourceDigest: [previous?.sourceDigest, trimmedContent]
        .filter(Boolean)
        .join('\n')
        .slice(-4_000),
    };
  }

  private tryParseSummary(raw: string): StructuredMemorySummary | null {
    try {
      return structuredMemorySummarySchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private formatSummary(raw: string): string {
    const summary = this.tryParseSummary(raw);
    if (!summary) return raw;
    const changes = summary.changes.map(
      (item) =>
        `- [${item.role}/${item.module}/${item.version}] ${item.before} → ${item.after}；生效：${item.effectiveFrom}；证据：${item.evidence}`,
    );
    return [
      ...changes,
      ...summary.decisions.map((item) => `- 决策：${item}`),
      ...summary.openIssues.map((item) => `- 待确认：${item}`),
      summary.sourceDigest ? `- 摘要：${summary.sourceDigest}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
}
