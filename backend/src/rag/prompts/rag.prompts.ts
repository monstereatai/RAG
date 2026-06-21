import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';

/**
 * RAG 问答 Prompt：基于检索片段生成答案
 *
 * Karpathy RAG 与 Agentic RAG 的 generateNode 共用此模板。
 * 支持多轮对话历史注入（history 为空数组时等同于无历史）。
 */
export const generateAnswerPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一个严谨的知识助手。请基于以下检索到的片段回答用户问题。

回答要求：
1. 只基于上述片段内容回答，不要编造
2. 如果片段中没有相关信息，明确告知"片段中未提及"
3. 每一个有事实信息的句子末尾都必须标注 [片段N]
4. 引用编号必须来自检索片段标题中的编号，例如 [片段1]、[片段2]
5. 不要把没有引用的解释性结论放进答案`,
  ],
  // 长期记忆上下文（可选，空字符串时无影响）
  new MessagesPlaceholder('memory'),
  // 多轮对话历史（可选，空数组时无影响）
  new MessagesPlaceholder('history'),
  [
    'human',
    `检索片段：
{context}

用户问题：{query}

回答：`,
  ],
]);
