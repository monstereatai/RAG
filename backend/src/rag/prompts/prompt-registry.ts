export interface PromptRegistryEntry {
  name: string;
  version: string;
  owner: string;
  purpose: string;
  file: string;
  evals: string[];
  rollback: string;
}

export const promptRegistry: PromptRegistryEntry[] = [
  {
    name: 'rag.generate_answer',
    version: '2026-07-07',
    owner: 'rag-backend',
    purpose: '基于可信检索片段生成带引用的回答，并隔离检索内容中的潜在提示注入。',
    file: 'src/rag/prompts/rag.prompts.ts',
    evals: [
      'npm run eval:rag',
      'npm run eval:rag:project',
      'npm run eval:prompt-injection',
    ],
    rollback: '恢复上一版 generateAnswerPrompt 并重新运行绑定评测。',
  },
  {
    name: 'agentic.query_augment',
    version: '2026-07-07',
    owner: 'rag-backend',
    purpose: '把复杂问题改写为有限数量的互补检索问句。',
    file: 'src/rag/prompts/agentic.prompts.ts',
    evals: ['npm run eval:rag:project'],
    rollback: '恢复上一版 queryAugmentPrompt 并复跑项目级评测。',
  },
  {
    name: 'agentic.sufficiency',
    version: '2026-07-07',
    owner: 'rag-backend',
    purpose: '判断检索片段是否足够支撑回答，避免证据不足时强行生成。',
    file: 'src/rag/prompts/agentic.prompts.ts',
    evals: ['npm run eval:rag:project', 'npm run eval:agent-tasks'],
    rollback: '恢复上一版 sufficiencyPrompt 并复跑项目级评测。',
  },
  {
    name: 'agentic.reflection',
    version: '2026-07-07',
    owner: 'rag-backend',
    purpose: '对生成答案进行置信度与引用支撑评估。',
    file: 'src/rag/prompts/agentic.prompts.ts',
    evals: ['npm run eval:rag:quality', 'npm run eval:agent-tasks'],
    rollback: '恢复上一版 reflectionPrompt 并复跑质量门禁。',
  }
];

