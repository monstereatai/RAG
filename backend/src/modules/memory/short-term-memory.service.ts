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

import { Injectable, Logger } from '@nestjs/common';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';

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

@Injectable()
export class ShortTermMemoryService {
  private readonly logger = new Logger(ShortTermMemoryService.name);

  constructor(
    private readonly redis: RedisProvider,
    private readonly llmProvider: LlmProvider,
  ) {}

  isEnabled(): boolean {
    return this.redis.isEnabled();
  }

  /**
   * 获取当前会话的短期记忆上下文
   * 返回：历史摘要（如有）+ 最近 N 轮对话
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
      return { systemMessage: null, recentTurns: [], truncatedHistory: false };
    }

    const key = this.turnsKey(conversationId);
    const raw = await this.redis.zrange(key, 0, -1);
    const summary = await this.redis.get(this.summaryKey(conversationId));

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
  ): Promise<void> {
    if (!this.redis.isEnabled()) return;

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
      await this.trimAndSummarize(conversationId);
    }
  }

  /**
   * 裁剪对话历史并生成摘要
   */
  async trimAndSummarize(
    conversationId: string,
    maxTurns = DEFAULT_MAX_TURNS,
  ): Promise<void> {
    if (!this.redis.isEnabled()) return;

    const key = this.turnsKey(conversationId);
    const all = await this.redis.zrange(key, 0, -1);

    const keepStart = this.findKeepStart(all, maxTurns);
    if (keepStart <= 0) return;

    const toTrim = all.slice(0, keepStart);

    const trimmedContent = toTrim
      .map((r) => {
        const t = JSON.parse(r) as StoredTurn;
        return `${t.role}: ${t.content}`;
      })
      .join('\n');

    const existingSummary = await this.redis.get(
      this.summaryKey(conversationId),
    );
    let summary: StructuredMemorySummary;
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
    }

    // 保留最近 maxTurns 轮：删除较早的记录
    await this.redis.zremrangebyrank(key, 0, keepStart - 1);
    await this.redis.set(
      this.summaryKey(conversationId),
      JSON.stringify(summary),
      TTL_SECONDS,
    );

    this.logger.debug(
      `Short-term memory compressed: removed ${keepStart} turns, kept ${all.length - keepStart}`,
    );
  }

  /**
   * 清理会话记忆（会话结束时调用）
   */
  async clearConversation(conversationId: string): Promise<void> {
    if (!this.redis.isEnabled()) return;
    await this.redis.del(this.turnsKey(conversationId));
    await this.redis.del(this.summaryKey(conversationId));
  }

  // --- helpers ---

  private turnsKey(conversationId: string): string {
    return `stm:${conversationId}:turns`;
  }

  private summaryKey(conversationId: string): string {
    return `stm:${conversationId}:summary`;
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
