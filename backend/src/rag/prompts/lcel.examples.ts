import { RunnableLambda, RunnableSequence } from '@langchain/core/runnables';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { generateAnswerPrompt } from './rag.prompts';

/**
 * LCEL Runnable 编排示例
 *
 * 展示 RunnableSequence（链式编排）和 RunnableLambda（自定义步骤）的用法。
 * 当前作为模板备用，核心 RAG 流程仍使用 LangGraph 编排。
 *
 * 参考实现：agent-course/runnable-test/src/runnable.mjs
 */

/**
 * 构建答案生成链：formatMessages → model.invoke → 提取文本
 *
 * 用 RunnableSequence 编排，等价于手动调用三步。
 *
 * 用法：
 * ```typescript
 * const chain = buildAnswerSequence(llmProvider);
 * const answer = await chain.invoke({ context, query, history });
 * ```
 */
export function buildAnswerSequence(llmProvider: LlmProvider) {
  const model = llmProvider.getModel();

  // 步骤1：格式化 prompt 消息
  const formatStep = RunnableLambda.from(
    async (input: {
      context: string;
      query: string;
      history: Array<{ role: 'human' | 'ai'; content: string }>;
    }) => {
      return generateAnswerPrompt.formatMessages(input);
    },
  );

  // 步骤2：调用 model
  const modelStep = RunnableLambda.from(async (messages: unknown) => {
    const response = await model.invoke(messages as never);
    return typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
  });

  // 用 RunnableSequence 编排：formatStep → modelStep
  return RunnableSequence.from([formatStep, modelStep]);
}
