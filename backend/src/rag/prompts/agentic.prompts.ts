import { ChatPromptTemplate, PromptTemplate } from '@langchain/core/prompts';

/**
 * Agentic RAG 专用 Prompt 集合
 *
 * 包含：问题复杂度分类、查询扩展、答案置信度评估
 */

/**
 * 问题复杂度分类 Prompt（auto 模式路由判断）
 *
 * 输出：{ complexity: 'simple' | 'complex' }
 */
export const classifyComplexityPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `判断用户问题的复杂度：
- simple：单一事实查询，如"XXX是什么"、"XXX的作者"
- complex：多跳推理、对比分析、需要综合多个信息源，如"XXX用了哪些技术，分别对应哪个章节"`,
  ],
  ['human', '{query}'],
]);

/**
 * 查询扩展 Prompt：生成 3 条多角度检索问句
 *
 * 输出：{ queries: string[3] }
 * 注入 few_shot_block（来自 few-shot.examples.ts）以提升改写质量。
 */
export const queryAugmentPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `{few_shot_block}

用户会给出一句中文问题。请另外写出恰好 3 条检索用的问句（与原意一致、角度尽量不同），便于搜索引擎或向量库分别召回。
可改写说法、换提问角度、或略加限定词；专有名词、型号、订单号等必须保留原样。
只输出结构化字段 queries（长度为 3 的字符串数组）。`,
  ],
  ['human', '{query}'],
]);

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

/**
 * DeepAgent 检索规划 System Prompt
 */
export const deepAgentQueryPlanSystemPrompt = `你是 RAG 检索规划 Agent。
你的任务是把用户问题拆成 3 条互补的中文检索问句。
不要回答用户问题，不要调用不必要的工具。
必须只输出 JSON：{"queries":["...","...","..."]}`;

export const deepAgentQueryPlanUserPrompt = PromptTemplate.fromTemplate(
  `请为下面的 RAG 问题规划 3 条中文检索问句。
只返回 JSON，不要 Markdown，不要解释。
JSON 格式：{{"queries":["问题1","问题2","问题3"]}}
原始问题：{query}`,
);
