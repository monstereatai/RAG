import { ChatPromptTemplate } from '@langchain/core/prompts';

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
