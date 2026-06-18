import { FewShotPromptTemplate, PromptTemplate } from '@langchain/core/prompts';

/**
 * Few-shot 示例库
 *
 * 为特定场景提供 few-shot 示例，提升 LLM 输出质量和稳定性。
 * 当前覆盖：查询扩展（query augment）。
 */

/**
 * 查询扩展 few-shot 示例
 *
 * 教 LLM 如何从不同角度改写检索问句。
 * 注意：示例字段必须是扁平的字符串，不能用数组。
 */
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
];

const queryAugmentExamplePrompt = PromptTemplate.fromTemplate(
  `原始问题：{original}
扩展问句：
- {q1}
- {q2}
- {q3}`,
);

/**
 * 查询扩展 few-shot prompt：格式化后返回示例文本块
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
