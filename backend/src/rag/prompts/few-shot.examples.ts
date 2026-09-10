import { FewShotPromptTemplate, PromptTemplate } from '@langchain/core/prompts';

/**
 * Few-shot 示例库
 *
 * 为特定场景提供 few-shot 示例，提升 LLM 输出质量和稳定性。
 * 覆盖：查询扩展、答案生成、反思评估、对比分析。
 *
 * 参考实现：agent-course/prompt-template-test/src/example-selector2.mjs
 */

/** 意图路由边界样本：用于 Router Prompt 与离线路由评测共用。 */
export const queryRoutingExamples = [
  {
    query: '1+1 等于多少',
    action: 'direct_answer',
    sourcePolicy: 'direct_answer',
    needsSynthesis: false,
    queryType: 'public_knowledge',
    targetKbs: ['general'],
    entities: [],
  },
  {
    query: '李思是谁',
    action: 'retrieve',
    sourcePolicy: 'local_only',
    needsSynthesis: false,
    queryType: 'private_entity',
    targetKbs: ['company', 'documents'],
    entities: ['李思'],
  },
  {
    query: '公司有李思，李四是谁',
    action: 'retrieve',
    sourcePolicy: 'local_only',
    needsSynthesis: false,
    queryType: 'private_entity',
    targetKbs: ['company', 'documents'],
    entities: ['李思', '李四'],
  },
  {
    query: '这个项目上次的接口怎么改',
    action: 'retrieve',
    sourcePolicy: 'local_only',
    needsSynthesis: false,
    queryType: 'follow_up',
    targetKbs: ['project', 'documents'],
    entities: [],
  },
  {
    query: 'React 和 Vue 的区别是什么',
    action: 'direct_answer',
    sourcePolicy: 'direct_answer',
    needsSynthesis: false,
    queryType: 'public_knowledge',
    targetKbs: ['general'],
    entities: [],
  },
  {
    query: '小红书是什么',
    action: 'direct_answer',
    sourcePolicy: 'direct_answer',
    needsSynthesis: false,
    queryType: 'public_knowledge',
    targetKbs: ['general'],
    entities: [],
  },
  {
    query: '小红书',
    action: 'direct_answer',
    sourcePolicy: 'direct_answer',
    needsSynthesis: false,
    queryType: 'public_knowledge',
    targetKbs: ['general'],
    entities: [],
  },
  {
    query: '公司里的小红书运营规范是什么',
    action: 'retrieve',
    sourcePolicy: 'local_only',
    needsSynthesis: false,
    queryType: 'project_knowledge',
    targetKbs: ['company', 'documents'],
    entities: [],
  },
  {
    query: '公司的研发流程是什么',
    action: 'retrieve',
    sourcePolicy: 'local_only',
    needsSynthesis: true,
    queryType: 'project_knowledge',
    targetKbs: ['company', 'project', 'documents'],
    entities: [],
  },
  {
    query: '项目发布流程怎么走',
    action: 'retrieve',
    sourcePolicy: 'local_only',
    needsSynthesis: true,
    queryType: 'project_knowledge',
    targetKbs: ['project', 'documents'],
    entities: [],
  },
  {
    query: '资料库当中，帮我总结下李逵',
    action: 'retrieve',
    sourcePolicy: 'local_only',
    needsSynthesis: true,
    queryType: 'private_entity',
    targetKbs: ['documents', 'company'],
    entities: ['李逵'],
  },
  {
    query: '帮我概括一下这个项目的技术方案',
    action: 'retrieve',
    sourcePolicy: 'local_only',
    needsSynthesis: true,
    queryType: 'project_knowledge',
    targetKbs: ['project', 'documents'],
    entities: [],
  },
] as const;

export function formatQueryRoutingFewShots(): string {
  return queryRoutingExamples
    .map((example, index) => `${index + 1}. ${JSON.stringify(example)}`)
    .join('\\n');
}

// ============================================================
// 1. 查询扩展（Query Augment）few-shot 示例
// ============================================================

const queryAugmentExamples = [
  {
    original: 'Milvus 的索引类型有哪些？',
    q1: 'Milvus 支持哪些索引类型',
    q2: 'Milvus 索引选型对比 IVF FLAT HNSW',
    q3: '向量数据库 Milvus 索引参数配置',
  },
  {
    original: '如何用 LangChain 实现流式响应？',
    q1: 'LangChain stream 方法使用示例',
    q2: 'LangChain.js 流式输出 token 实现',
    q3: 'LangChain LLM streaming response SSE',
  },
  {
    original: 'React 和 Vue 的响应式原理有什么区别？',
    q1: 'React 响应式原理 fiber reconciler',
    q2: 'Vue 响应式系统 proxy reactive',
    q3: 'React vs Vue 数据驱动对比分析',
  },
  {
    original: '这个项目的技术栈是什么？',
    q1: '项目使用的框架和技术选型',
    q2: '项目依赖清单 package.json',
    q3: '项目架构技术栈概览',
  },
  {
    original: 'Docker 容器怎么部署 NestJS 应用？',
    q1: 'NestJS Docker 多阶段构建 Dockerfile',
    q2: 'Docker Compose 部署 Node.js 应用',
    q3: 'NestJS 容器化部署最佳实践',
  },
];

const queryAugmentExamplePrompt = PromptTemplate.fromTemplate(
  `原始问题：{original}
扩展问句：
- {q1}
- {q2}
- {q3}`,
);

/**
 * 查询扩展 few-shot prompt
 *
 * 用法：在 queryAugmentPrompt 中作为 system 消息的一部分注入。
 */
export const queryAugmentFewShotPrompt = new FewShotPromptTemplate({
  examples: queryAugmentExamples,
  examplePrompt: queryAugmentExamplePrompt,
  prefix: '以下是查询扩展的示例，请参考其改写风格：',
  suffix: '请按照上述风格，为下面的用户问题生成 3 条扩展问句。',
  inputVariables: [],
});

// ============================================================
// 2. 答案生成（Answer Generation）few-shot 示例
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
// 3. 反思评估（Reflection）few-shot 示例
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
// 4. 全量示例索引（用于 SemanticExampleSelector）
//
// 每条示例包含 task（任务类型标签）+ text（示例全文），
// 存入 Milvus 后按语义相似度检索最相关的示例。
// ============================================================

export interface FewShotExampleEntry {
  id: string;
  task: 'query_augment' | 'answer_generation' | 'reflection';
  text: string;
}

/**
 * 将各类 few-shot 示例展开为扁平文本，用于语义检索。
 *
 * 在 SemanticExampleSelector 中，先 embed 这些文本存入 Milvus，
 * 查询时按当前 query 检索最相关的 k 条示例注入 prompt。
 */
export function buildFewShotExampleEntries(): FewShotExampleEntry[] {
  const entries: FewShotExampleEntry[] = [];

  // 查询扩展示例
  for (const ex of queryAugmentExamples) {
    entries.push({
      id: `qa_${ex.original.slice(0, 20)}`,
      task: 'query_augment',
      text: `原始问题：${ex.original}\n扩展：${ex.q1} / ${ex.q2} / ${ex.q3}`,
    });
  }

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
