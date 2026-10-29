import { ChatPromptTemplate } from '@langchain/core/prompts';

/**
 * Agentic RAG 专用 Prompt 集合
 *
 * 包含：检索充分性评估、答案置信度评估
 */

/**
 * 答案置信度评估 Prompt（Reflection 节点）
 *
 * 输出：{ confidence: number(0~1), reason: string }
 */
export const reflectionPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一个答案质量评估器。请评估以下答案的置信度（0~1）：
- 答案是否完整回答了用户问题？
- 答案是否有检索片段支撑（非编造）？
- 答案是否标注了引用来源？

只输出结构化字段：confidence（0~1 数字）和 reason（中文理由）。`,
  ],
  [
    'human',
    `用户问题：{query}

检索片段：
{context}

答案：
{answer}`,
  ],
]);
/**
 * 检索充分性评估 Prompt
 */
export const sufficiencyPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是 RAG 检索充分性评估器。
判断给定检索片段是否足够支撑后续回答用户问题。
只要片段包含直接答案、核心事实或足够上下文，就判定 sufficient=true。
如果片段明显无关、为空、只包含泛泛背景而不能回答问题，则判定 sufficient=false。
只输出结构化字段 sufficient 和 reason。`,
  ],
  [
    'human',
    `用户问题：{query}

检索片段：
{context}`,
  ],
]);
