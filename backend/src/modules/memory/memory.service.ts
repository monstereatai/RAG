import { Injectable, Logger } from '@nestjs/common';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { z } from 'zod';
import {
  Mem0Provider,
  type Mem0MemoryResult,
} from '../../providers/mem0/mem0.provider';
import { LlmProvider } from '../../providers/llm/llm.provider';

/** 分类器输出 schema */
const memoryClassifierSchema = z.object({
  write_user: z
    .boolean()
    .describe(
      '写入用户层：换一个新会话仍应保留的长期事实（身份、居住地、长期爱好、饮食禁忌、持久偏好）。不含仅本轮任务。',
    ),
  write_session: z
    .boolean()
    .describe(
      '写入会话层：仅当前会话/thread 有效的任务、大纲、进度、待办、临时决策（如「这次先写…」「数据部分明天补」）。',
    ),
  reason: z.string().describe('分类理由，一句话'),
});

const CLASSIFIER_PROMPT = `你是记忆分层分类器。判断本轮对话是否有「新事实」需写入 Mem0，并分到正确层级。

## user 层（跨会话长期）
- 用户身份与画像：姓名、职业、居住地、长期爱好
- 长期偏好与约束：饮食过敏、回答风格、常用技术栈
- 持续数周以上的个人背景（非单次任务）

## session 层（仅当前会话）
- 当前正在做的任务、目标、文档大纲、方案草稿
- 本会话内的进度、决策、待办、临时约定
- 用户明确用「这次」「本轮」「当前会话」描述的工作上下文

## 均不写入
- 寒暄、致谢、纯确认
- 助手生成的通用内容（攻略、示例代码、建议清单），用户未明确采纳为新事实
- 无信息增量的复述

## 决策原则
1. 「这次我们先写 Q1 总结」「当前在排查 XX」→ 优先 session，不要标成 user
2. user 与 session 可同时为 true（如同时说职业+当前任务），但勿把纯会话任务只标 user
3. 一次性请求（如「帮我做旅行攻略」）且未产生需跨轮记住的约定 → 均为 false`;

export interface MemorySearchResult {
  userMemories: Mem0MemoryResult[];
  sessionMemories: Mem0MemoryResult[];
  systemMessage: SystemMessage | null;
}

export interface MemoryClassifyResult {
  written: string[];
  reason: string;
}

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    private readonly mem0Provider: Mem0Provider,
    private readonly llmProvider: LlmProvider,
  ) {}

  isEnabled(): boolean {
    return this.mem0Provider.isEnabled();
  }

  getStatus(): {
    enabled: boolean;
    scopes: Array<'user' | 'session'>;
    writePolicy: string;
  } {
    return {
      enabled: this.mem0Provider.isEnabled(),
      scopes: ['user', 'session'],
      writePolicy:
        'LLM classifier writes durable profile/preferences to user scope and temporary task context to session scope.',
    };
  }

  /**
   * 搜索用户 + 会话层记忆，构建 SystemMessage
   *
   * 在 chat 前调用，将记忆注入到 LLM 上下文中
   */
  async searchMemory(
    query: string,
    userId: string,
    conversationId?: string,
    topK = 5,
  ): Promise<MemorySearchResult> {
    if (!this.mem0Provider.isEnabled()) {
      return { userMemories: [], sessionMemories: [], systemMessage: null };
    }

    // 并行搜索 user 层和 session 层
    const [userMemories, sessionMemories] = await Promise.all([
      this.mem0Provider.search({ query, userId, topK }),
      conversationId
        ? this.mem0Provider.search({
            query,
            userId,
            runId: conversationId,
            topK,
          })
        : Promise.resolve<Mem0MemoryResult[]>([]),
    ]);

    const systemMessage = this.buildSystemMessage(
      userMemories,
      sessionMemories,
    );

    if (userMemories.length) {
      this.logger.debug(`Mem0 user memories: ${userMemories.length}`);
    }
    if (sessionMemories.length) {
      this.logger.debug(`Mem0 session memories: ${sessionMemories.length}`);
    }

    return { userMemories, sessionMemories, systemMessage };
  }

  /**
   * 分类并持久化本轮对话到 Mem0
   *
   * 在 chat 后调用，由 LLM 分类器判断是否写入
   */
  async classifyAndPersist(
    userId: string,
    conversationId: string | undefined,
    userText: string,
    assistantText: string,
  ): Promise<MemoryClassifyResult> {
    if (!this.mem0Provider.isEnabled()) {
      return { written: [], reason: 'mem0 disabled' };
    }

    try {
      const classifier = this.llmProvider
        .getModel()
        .withStructuredOutput(memoryClassifierSchema);
      const result = await classifier.invoke([
        new SystemMessage(CLASSIFIER_PROMPT),
        new HumanMessage(`用户：${userText}\n助手：${assistantText}`),
      ]);

      const turn: Array<{ role: 'user' | 'assistant'; content: string }> = [
        { role: 'user', content: userText },
        { role: 'assistant', content: assistantText },
      ];

      const written: string[] = [];

      if (result.write_user) {
        await this.mem0Provider.add({ messages: turn, userId });
        written.push('user');
      }

      if (result.write_session && conversationId) {
        await this.mem0Provider.add({
          messages: turn,
          userId,
          runId: conversationId,
        });
        written.push('session');
      }

      this.logger.log(
        `Memory classify: reason="${result.reason}", written=[${written.join(', ')}]`,
      );

      return { written, reason: result.reason };
    } catch (err) {
      this.logger.error(`Memory classify failed: ${(err as Error).message}`);
      return { written: [], reason: `error: ${(err as Error).message}` };
    }
  }

  /**
   * 列出用户所有记忆（用于管理 API）
   */
  async listMemories(userId: string): Promise<Mem0MemoryResult[]> {
    return this.mem0Provider.getAll(userId);
  }

  async listSessionMemories(
    userId: string,
    conversationId: string,
  ): Promise<Mem0MemoryResult[]> {
    return this.mem0Provider.getAll(userId, conversationId);
  }

  async searchMemories(
    query: string,
    userId: string,
    conversationId?: string,
    topK = 5,
  ): Promise<MemorySearchResult> {
    return this.searchMemory(query, userId, conversationId, topK);
  }

  /**
   * 清空用户所有记忆（用于管理 API）
   */
  async clearMemories(userId: string): Promise<void> {
    await this.mem0Provider.deleteAll(userId);
  }

  // --- private helpers ---

  private buildSystemMessage(
    user: Mem0MemoryResult[],
    session: Mem0MemoryResult[],
  ): SystemMessage | null {
    const blocks: string[] = [];

    if (user.length) {
      blocks.push(
        `【用户长期记忆】\n${user.map((m) => `- ${m.memory}`).join('\n')}`,
      );
    }

    if (session.length) {
      blocks.push(
        `【当前会话记忆】\n${session.map((m) => `- ${m.memory}`).join('\n')}`,
      );
    }

    if (!blocks.length) return null;

    return new SystemMessage(
      `${blocks.join('\n\n')}\n\n请结合以上记忆回答，勿编造。`,
    );
  }
}
