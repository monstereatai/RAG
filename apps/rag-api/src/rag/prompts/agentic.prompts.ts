import { ChatPromptTemplate } from '@langchain/core/prompts';

/**
 * Agentic RAG 专用 Prompt 集合
 *
 * 包含：检索充分性评估、答案置信度评估
 */

export const agenticPromptDefinitions = {
  directAnswer:
    '你正在回答一个可由通用知识直接判断的客观事实问题。请独立计算或依据可靠通用知识直接回答，不要使用历史对话、用户未验证的说法或知识库片段，不要声称资料不足，也不要添加引用标记。用户问题：{query}',
  reflection: {
    system: `你是一个答案质量评估器。请评估以下答案的置信度（0~1）：
- 答案是否完整回答了用户问题？
- 答案是否有检索片段支撑（非编造）？
- 答案是否标注了引用来源？

如果答案有缺漏、表达错误或引用格式问题，但检索片段足够回答，retryTarget 选 generate。
只有检索片段确实缺少回答所需事实时，retryTarget 才选 retrieval。
只输出结构化字段：confidence（0~1 数字）、reason（中文理由）和 retryTarget（generate 或 retrieval）。`,
    human: `用户问题：{query}

检索片段：
{context}

答案：
{answer}`,
  },
  sufficiency: {
    system: `你是 RAG 检索充分性评估器。
判断给定检索片段是否足够支撑后续回答用户问题。
只要片段包含直接答案、核心事实或足够上下文，就判定 sufficient=true。
如果片段明显无关、为空、只包含泛泛背景而不能回答问题，则判定 sufficient=false。
只输出结构化字段 sufficient 和 reason。`,
    human: `用户问题：{query}

检索片段：
{context}`,
  },
} as const;

/** 答案置信度评估 Prompt（Reflection 节点）。 */
export const reflectionPrompt = ChatPromptTemplate.fromMessages([
  ['system', agenticPromptDefinitions.reflection.system],
  ['human', agenticPromptDefinitions.reflection.human],
]);

/** 检索充分性评估 Prompt。 */
export const sufficiencyPrompt = ChatPromptTemplate.fromMessages([
  ['system', agenticPromptDefinitions.sufficiency.system],
  ['human', agenticPromptDefinitions.sufficiency.human],
]);
