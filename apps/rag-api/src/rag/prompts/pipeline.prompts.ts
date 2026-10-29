import {
  PipelinePromptTemplate,
  PromptTemplate,
} from '@langchain/core/prompts';

/**
 * Pipeline Prompt 模板
 *
 * 将答案生成分解为多个阶段：人设 → 背景 → 任务 → 格式 → 最终组合。
 * 适用于需要长文答案或结构化输出的场景，当前作为备用模板，未集成到核心 RAG 流程。
 *
 * 参考实现：agent-course/prompt-template-test/src/pipeline-prompt-template.mjs
 */

/** 人设模块：定义助手角色和写作风格 */
const personaPrompt = PromptTemplate.fromTemplate(
  `你是一名严谨的知识助手，写作风格：{tone}。
你擅长基于检索片段给出准确、有引用支撑的回答。`,
);

/** 背景模块：注入检索片段和用户问题 */
const contextPrompt = PromptTemplate.fromTemplate(
  `检索片段：
{context}

用户问题：
{query}`,
);

/** 任务模块：明确生成要求 */
const taskPrompt = PromptTemplate.fromTemplate(
  `请基于上述检索片段回答用户问题：
1. 只基于片段内容，不要编造
2. 片段中无相关信息时，明确告知"片段中未提及"
3. 回答末尾用 [片段N] 标注引用来源`,
);

/** 格式模块：约束输出格式 */
const formatPrompt = PromptTemplate.fromTemplate(
  `请用清晰的中文输出，结构包含：
1. 直接回答（1-2 句话）
2. 详细说明（如需要）
3. 引用来源标注`,
);

/** 最终组合 Prompt */
const finalRagPrompt = PromptTemplate.fromTemplate(
  `{persona_block}

{context_block}

{task_block}

{format_block}

现在请生成回答：`,
);

/**
 * RAG 答案生成 Pipeline Prompt
 *
 * 用法：
 * ```typescript
 * const formatted = await ragAnswerPipelinePrompt.format({
 *   tone: '专业、简洁',
 *   context: '...',
 *   query: '...',
 * });
 * ```
 */
export const ragAnswerPipelinePrompt = new PipelinePromptTemplate({
  pipelinePrompts: [
    { name: 'persona_block', prompt: personaPrompt },
    { name: 'context_block', prompt: contextPrompt },
    { name: 'task_block', prompt: taskPrompt },
    { name: 'format_block', prompt: formatPrompt },
  ],
  finalPrompt: finalRagPrompt,
});
