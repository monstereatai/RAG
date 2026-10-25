import { FewShotPromptTemplate, PromptTemplate } from '@langchain/core/prompts';

/**
 * Few-shot 示例库
 *
 * 为特定场景提供 few-shot 示例，提升 LLM 输出质量和稳定性。
 * 覆盖：查询规划、答案生成、反思评估、对比分析。
 *
 * 参考实现：agent-course/prompt-template-test/src/example-selector2.mjs
 */

/** 查询规划边界样本：用于 QueryPlanner Prompt 与离线路由评测共用。 */
export const queryRoutingExamples = [
  {
    query: '1+1 等于多少',
    action: 'direct',
    domain: 'public',
    contextMode: 'independent',
    taskType: 'lookup',
    needsGraph: false,
    entities: [],
  },
  {
    query: '李思是谁',
    action: 'retrieve',
    domain: 'internal',
    contextMode: 'independent',
    taskType: 'lookup',
    needsGraph: false,
    entities: ['李思'],
  },
  {
    query: '公司有李思，李四是谁',
    action: 'retrieve',
    domain: 'internal',
    contextMode: 'independent',
    taskType: 'lookup',
    needsGraph: false,
    entities: ['李思', '李四'],
  },
  {
    query: '这个项目上次的接口怎么改',
    action: 'retrieve',
    domain: 'internal',
    contextMode: 'follow_up',
    taskType: 'procedure',
    needsGraph: false,
    entities: [],
  },
  {
    query: 'React 和 Vue 的区别是什么',
    action: 'direct',
    domain: 'public',
    contextMode: 'independent',
    taskType: 'comparison',
    needsGraph: false,
    entities: [],
  },
  {
    query: '小红书是什么',
    action: 'direct',
    domain: 'public',
    contextMode: 'independent',
    taskType: 'lookup',
    needsGraph: false,
    entities: [],
  },
  {
    query: '小红书',
    action: 'direct',
    domain: 'public',
    contextMode: 'independent',
    taskType: 'lookup',
    needsGraph: false,
    entities: [],
  },
  {
    query: '公司里的小红书运营规范是什么',
    action: 'retrieve',
    domain: 'internal',
    contextMode: 'independent',
    taskType: 'lookup',
    needsGraph: false,
    entities: [],
  },
  {
    query: '公司的研发流程是什么',
    action: 'retrieve',
    domain: 'internal',
    contextMode: 'independent',
    taskType: 'procedure',
    needsGraph: false,
    entities: [],
  },
  {
    query: '项目发布流程怎么走',
    action: 'retrieve',
    domain: 'internal',
    contextMode: 'independent',
    taskType: 'procedure',
    needsGraph: false,
    entities: [],
  },
  {
    query: '资料库当中，帮我总结下李逵',
    action: 'retrieve',
    domain: 'internal',
    contextMode: 'independent',
    taskType: 'synthesis',
    needsGraph: false,
    entities: ['李逵'],
  },
  {
    query: '根据附件列出项目负责人、预算、交付日期和风险等级，并标明出处',
    action: 'retrieve',
    domain: 'internal',
    contextMode: 'independent',
    taskType: 'synthesis',
    needsGraph: false,
    entities: [],
    subQueries: ['项目负责人和预算', '项目交付日期和风险等级'],
  },
  {
    query: '帮我概括一下这个项目的技术方案',
    action: 'retrieve',
    domain: 'internal',
    contextMode: 'follow_up',
    taskType: 'synthesis',
    needsGraph: false,
    entities: [],
  },
] as const;

export function formatQueryRoutingFewShots(): string {
  return queryRoutingExamples
    .map((example, index) => `${index + 1}. ${JSON.stringify(example)}`)
    .join('\n');
}

// ============================================================
// 1. 答案生成（Answer Generation）few-shot 示例
//
// 教 LLM 如何基于检索片段生成带引用的回答。
// ============================================================

export const answerGenerationExamples: Array<{
  context: string;
  query: string;
  answer: string;
}> = [
  {
    context: `[片段 1]
LangChain.js 是 LangChain 的 JavaScript/TypeScript 实现，提供 LLM 应用开发框架。
[片段 2]
LangChain.js 核心模块包括：Models、Prompts、Chains、Memory、Agents。`,
    query: 'LangChain.js 有哪些核心模块？',
    answer:
      'LangChain.js 的核心模块包括 Models（模型封装）、Prompts（提示词模板）、Chains（链式编排）、Memory（记忆管理）和 Agents（智能体）[片段 2]。它是 LangChain 的 JavaScript/TypeScript 实现，专为 LLM 应用开发设计 [片段 1]。',
  },
  {
    context: `[片段 1]
Milvus 支持多种索引类型：IVF_FLAT、IVF_SQ8、IVF_PQ、HNSW、ANNOY 等。
[片段 2]
IVF_FLAT 适合中小数据集，HNSW 适合大规模高召回场景。`,
    query: 'Milvus 应该选择什么索引类型？',
    answer:
      'Milvus 支持多种索引类型 [片段 1]，选型建议：\n- **IVF_FLAT**：适合中小数据集，实现简单，召回率高 [片段 2]\n- **HNSW**：适合大规模数据，查询速度快，召回率高 [片段 2]\n\n如果数据量在百万级以下，推荐 IVF_FLAT；百万级以上推荐 HNSW。',
  },
];

const answerExamplePrompt = PromptTemplate.fromTemplate(
  `检索片段：
{context}

用户问题：{query}

参考回答：
{answer}`,
);

/**
 * 答案生成 few-shot prompt
 *
 * 教 LLM 如何基于检索片段生成带 [片段N] 引用的回答。
 */
export const answerFewShotPrompt = new FewShotPromptTemplate({
  examples: answerGenerationExamples,
  examplePrompt: answerExamplePrompt,
  prefix: '以下是基于检索片段生成回答的示例，注意引用标注格式：',
  suffix: '请参考上述风格，回答下面的用户问题。',
  inputVariables: [],
});

// ============================================================
// 2. 反思评估（Reflection）few-shot 示例
//
// 教 LLM 如何评估答案的置信度。
// ============================================================

export const reflectionExamples = [
  {
    query: 'NestJS 的依赖注入原理是什么？',
    answer:
      'NestJS 使用 TypeScript 装饰器实现依赖注入，通过 @Injectable() 标记 Provider，@Module 注册依赖关系 [片段 1]。运行时 IoC 容器自动解析和注入依赖 [片段 2]。',
    confidence: '0.95',
    reason: '答案完整回答了原理，有 2 个检索片段支撑，引用标注清晰。',
  },
  {
    query: '项目的部署流程是什么？',
    answer: '片段中未提及具体的部署流程。',
    confidence: '0.15',
    reason: '检索片段中没有部署相关内容，答案无法给出有效信息。',
  },
  {
    query: '对比 Redis 和 Memcached 的优劣',
    answer:
      'Redis 支持更多数据结构（String/Hash/List/Set/ZSet）[片段 1]，且支持持久化和集群 [片段 2]。Memcached 仅支持简单 Key-Value 存储，但单机性能更高。',
    confidence: '0.75',
    reason:
      '答案覆盖了 Redis 优势并有引用，但 Memcached 部分缺乏片段支撑，属于通用知识。',
  },
];

// ============================================================
// 3. 全量示例索引（用于 SemanticExampleSelector）
//
// 每条示例包含 task（任务类型标签）+ text（示例全文），
// 存入 Milvus 后按语义相似度检索最相关的示例。
// ============================================================

export interface FewShotExampleEntry {
  id: string;
  task: 'answer_generation' | 'reflection';
  text: string;
}

/**
 * 将各类 few-shot 示例展开为扁平文本，用于语义检索。
 *
 * 在 SemanticExampleSelector 中，先 embed 这些文本存入 Milvus，
 * 查询时按当前 query 检索答案和反思示例。
 */
export function buildFewShotExampleEntries(): FewShotExampleEntry[] {
  const entries: FewShotExampleEntry[] = [];

  // 答案生成示例
  for (const ex of answerGenerationExamples) {
    entries.push({
      id: `ag_${ex.query.slice(0, 20)}`,
      task: 'answer_generation',
      text: `问题：${ex.query}\n回答：${ex.answer}`,
    });
  }

  // 反思评估示例
  for (const ex of reflectionExamples) {
    entries.push({
      id: `rf_${ex.query.slice(0, 20)}`,
      task: 'reflection',
      text: `问题：${ex.query}\n答案：${ex.answer}\n置信度：${ex.confidence}，${ex.reason}`,
    });
  }

  return entries;
}
