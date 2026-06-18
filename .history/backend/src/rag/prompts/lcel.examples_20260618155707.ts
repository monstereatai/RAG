import {
  RunnableBranch,
  RunnableLambda,
  RunnableSequence,
  RunnableWithMessageHistory,
} from '@langchain/core/runnables';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';
import { InMemoryChatMessageHistory } from '@langchain/core/chat_history';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { generateAnswerPrompt } from './rag.prompts';

/**
 * LCEL Runnable 编排示例集
 *
 * 展示 LCEL 组合模式：RunnableSequence、RunnableLambda、RunnableBranch、RunnableWithMessageHistory。
 * 当前作为模板备用，核心 RAG 流程仍使用 LangGraph 编排。
 *
 * 参考实现：
 * - agent-course/runnable-test/src/runnables/RunnableBranch.mjs
 * - agent-course/runnable-test/src/runnables/RunnableWithMessageHistory.mjs
 */

// ============================================================
// 1. RunnableSequence：答案生成链（formatMessages → model.invoke → 提取文本）
// ============================================================

/**
 * 构建答案生成链
 *
 * 用 RunnableSequence 编排，等价于手动调用三步。
 */
export function buildAnswerSequence(llmProvider: LlmProvider) {
  const model = llmProvider.getModel();

  const formatStep = RunnableLambda.from(
    async (input: {
      context: string;
      query: string;
      history: Array<{ role: 'human' | 'ai'; content: string }>;
      memory: Array<{ role: string; content: string }>;
    }) => {
      return generateAnswerPrompt.formatMessages(input);
    },
  );

  const modelStep = RunnableLambda.from(async (messages: unknown) => {
    const response = await model.invoke(messages as never);
    return typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
  });

  return RunnableSequence.from([formatStep, modelStep]);
}

// ============================================================
// 2. RunnableBranch：条件路由（按问题类型分发到不同处理链）
// ============================================================

export interface RoutedInput {
  query: string;
  category: 'factual' | 'analytical' | 'creative';
  context: string;
  history: Array<{ role: 'human' | 'ai'; content: string }>;
}

/**
 * 构建条件路由链
 *
 * 根据 category 分发到不同的处理逻辑：
 * - factual（事实类）：直接基于检索片段回答
 * - analytical（分析类）：需要综合多个片段
 * - creative（创意类）：允许适当发散
 *
 * 使用 RunnableBranch.from() 静态方法，支持普通函数作为条件。
 */
export function buildRoutedChain(llmProvider: LlmProvider) {
  const model = llmProvider.getModel();

  // 事实类：简洁精确
  const factualPrompt = ChatPromptTemplate.fromMessages([
    ['system', '你是事实查询助手。只基于检索片段回答，简洁精确，不做推测。'],
    new MessagesPlaceholder('history'),
    ['human', '检索片段：\n{context}\n\n问题：{query}\n\n回答：'],
  ]);

  // 分析类：综合多源
  const analyticalPrompt = ChatPromptTemplate.fromMessages([
    [
      'system',
      '你是分析助手。综合多个检索片段进行对比分析，给出有条理的回答。',
    ],
    new MessagesPlaceholder('history'),
    ['human', '检索片段：\n{context}\n\n问题：{query}\n\n请分点分析：'],
  ]);

  // 创意类：允许发散
  const creativePrompt = ChatPromptTemplate.fromMessages([
    [
      'system',
      '你是创意助手。基于检索片段，可以适当发散和联想，给出有启发性的回答。',
    ],
    new MessagesPlaceholder('history'),
    ['human', '检索片段：\n{context}\n\n问题：{query}\n\n请创造性地回答：'],
  ]);

  const invokeWithPrompt = async (
    prompt: ChatPromptTemplate,
    input: RoutedInput,
  ): Promise<string> => {
    const messages = await prompt.formatMessages({
      context: input.context,
      query: input.query,
      history: input.history,
    });
    const response = await model.invoke(messages);
    return typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
  };

  // 使用 RunnableBranch.from() 静态方法，支持普通函数作为条件
  return RunnableBranch.from<RoutedInput, string>([
    // factual: 直接回答
    [
      (input: RoutedInput) => input.category === 'factual',
      (input: RoutedInput) => invokeWithPrompt(factualPrompt, input),
    ],
    // analytical: 分点分析
    [
      (input: RoutedInput) => input.category === 'analytical',
      (input: RoutedInput) => invokeWithPrompt(analyticalPrompt, input),
    ],
    // creative: 发散联想
    [
      (input: RoutedInput) => input.category === 'creative',
      (input: RoutedInput) => invokeWithPrompt(creativePrompt, input),
    ],
    // default: 默认用事实类
    (input: RoutedInput) => invokeWithPrompt(factualPrompt, input),
  ]);
}

// ============================================================
// 3. RunnableWithMessageHistory：带对话历史的链
// ============================================================

/**
 * 构建带对话历史的 RAG 链
 *
 * 使用 RunnableWithMessageHistory 自动管理对话历史，
 * 每次调用时自动注入历史消息，并在回答后追加新消息。
 *
 * 用法：
 * ```typescript
 * const chain = buildHistoryChain(llmProvider);
 * const answer = await chain.invoke(
 *   { context, query },
 *   { configurable: { sessionId: 'thread-123' } }
 * );
 * ```
 */
export function buildHistoryChain(llmProvider: LlmProvider) {
  const model = llmProvider.getModel();

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', '你是知识助手。基于检索片段回答问题，引用来源用 [片段N] 标注。'],
    new MessagesPlaceholder('history'),
    ['human', '检索片段：\n{context}\n\n问题：{query}\n\n回答：'],
  ]);

  const chain = RunnableSequence.from([
    RunnableLambda.from(
      async (input: {
        context: string;
        query: string;
        history: Array<{ role: string; content: string }>;
      }) => {
        return prompt.formatMessages(input);
      },
    ),
    RunnableLambda.from(async (messages: unknown) => {
      const response = await model.invoke(messages as never);
      return typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    }),
  ]);

  // 使用 InMemoryChatMessageHistory 作为存储（生产环境应替换为 Redis/PostgreSQL）
  const sessions = new Map<string, InMemoryChatMessageHistory>();

  return new RunnableWithMessageHistory({
    runnable: chain,
    getMessageHistory: (sessionId: string) => {
      if (!sessions.has(sessionId)) {
        sessions.set(sessionId, new InMemoryChatMessageHistory());
      }
      return sessions.get(sessionId)!;
    },
    inputMessagesKey: 'query',
    historyMessagesKey: 'history',
  });
}
