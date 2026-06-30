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

interface StoredTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: number;
}

const DEFAULT_MAX_TURNS = 20;
const TTL_SECONDS = 86400; // 24 小时过期

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
      blocks.push(`【历史对话摘要】\n${summary}`);
    }
    if (truncated) {
      blocks.push(
        `（由于对话较长，仅保留最近 ${maxTurns} 轮完整对话，更早的内容已摘要记录）`,
      );
    }

    const systemMessage =
      blocks.length > 0
        ? new SystemMessage(blocks.join('\n\n'))
        : null;

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

    // 检查是否需要裁剪
    const count = (await this.redis.zrange(key, 0, -1)).length;
    if (count > DEFAULT_MAX_TURNS * 1.5) {
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

    if (all.length <= maxTurns) return;

    // 取出要裁剪掉的部分（较早的对话）
    const toTrim = all.slice(0, all.length - maxTurns);
    const toKeep = all.slice(-maxTurns);

    const trimmedContent = toTrim
      .map((r) => {
        const t = JSON.parse(r) as StoredTurn;
        return `${t.role}: ${t.content}`;
      })
      .join('\n');

    // 尝试生成摘要（失败时不阻塞）
    let summary = '';
    try {
      summary = await this.llmProvider.invoke([
        new SystemMessage(
          '你是对话摘要助手。将以下对话压缩为一段简洁的中文摘要（100 字内），保留关键事实、决策和用户偏好。',
        ),
        {
          role: 'user' as const,
          content: `请摘要这段对话：\n\n${trimmedContent}`,
        },
      ]);
    } catch (err) {
      this.logger.warn(
        `Short-term memory summarization failed: ${(err as Error).message}`,
      );
      summary = `（共 ${toTrim.length} 轮历史对话，摘要生成失败）`;
    }

    // 保留最近 maxTurns 轮：删除较早的记录
    await this.redis.zremrangebyrank(key, 0, all.length - maxTurns - 1);

    // 合并摘要到现有摘要
    const existingSummary = await this.redis.get(this.summaryKey(conversationId));
    const mergedSummary = existingSummary
      ? `${existingSummary}\n${summary}`
      : summary;

    await this.redis.set(this.summaryKey(conversationId), mergedSummary, TTL_SECONDS);

    this.logger.debug(
      `Short-term memory trimmed: removed ${all.length - maxTurns} turns, kept ${maxTurns}`,
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
}
