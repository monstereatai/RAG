import { createHash } from 'node:crypto';
import { agentEvalJudgeSystemPrompt } from '../../modules/agent-evals/agent-eval.prompts';
import { productionRolePromptDefinition } from '../../modules/workflow/production-role.prompts';
import {
  memoryClassifierSystemPrompt,
  shortTermSummaryCompactionSystemPrompt,
  shortTermSummaryRecoverySystemPrompt,
} from '../../modules/memory/memory.prompts';
import { QUERY_PLAN_PROMPT } from '../planning/query-planner.prompt';
import { agenticPromptDefinitions } from './agentic.prompts';
import { generateAnswerPromptDefinition } from './rag.prompts';

export interface PromptRegistryEntry {
  name: string;
  version: string;
  owner: string;
  purpose: string;
  file: string;
  evals: string[];
  evaluationNote?: string;
  rollback: string;
}

function contentVersion(source: unknown): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(source))
    .digest('hex')
    .slice(0, 16)}`;
}

export const promptRegistry: PromptRegistryEntry[] = [
  {
    name: 'rag.generate_answer',
    version: contentVersion(generateAnswerPromptDefinition),
    owner: 'rag-backend',
    purpose:
      '基于可信检索片段生成带引用的回答，并隔离检索内容中的潜在提示注入。',
    file: 'src/rag/prompts/rag.prompts.ts',
    evals: [
      'npm run eval:rag',
      'npm run eval:rag:project',
      'npm run eval:prompt-injection',
    ],
    rollback: '恢复上一版 generateAnswerPrompt 并重新运行绑定评测。',
  },
  {
    name: 'agentic.sufficiency',
    version: contentVersion(agenticPromptDefinitions.sufficiency),
    owner: 'rag-backend',
    purpose: '判断检索片段是否足够支撑回答，避免证据不足时强行生成。',
    file: 'src/rag/prompts/agentic.prompts.ts',
    evals: ['npm run eval:rag:project'],
    rollback: '恢复上一版 sufficiencyPrompt 并复跑项目级评测。',
  },
  {
    name: 'agentic.reflection',
    version: contentVersion(agenticPromptDefinitions.reflection),
    owner: 'rag-backend',
    purpose: '对生成答案进行置信度与引用支撑评估。',
    file: 'src/rag/prompts/agentic.prompts.ts',
    evals: ['npm run eval:rag:quality'],
    rollback: '恢复上一版 reflectionPrompt 并复跑质量门禁。',
  },
  {
    name: 'workflow.production_role',
    version: contentVersion(productionRolePromptDefinition),
    owner: 'rag-backend',
    purpose: '为产研运岗位生成带证据约束的结构化交付物。',
    file: 'src/modules/workflow/production-role.prompts.ts',
    evals: ['npm run eval:agent-platform'],
    rollback: '恢复上一版岗位 prompt 定义并重新运行绑定评测。',
  },
  {
    name: 'rag.query_plan',
    version: contentVersion(QUERY_PLAN_PROMPT),
    owner: 'rag-backend',
    purpose: '把用户问题整理成受后端权限约束的 QueryPlan。',
    file: 'src/rag/planning/query-planner.prompt.ts',
    evals: ['npm run eval:query-routing', 'npm run eval:rag:project'],
    rollback: '恢复上一版 query planner prompt 定义并重跑路由评测。',
  },
  {
    name: 'agent_eval.judge',
    version: contentVersion(agentEvalJudgeSystemPrompt),
    owner: 'rag-backend',
    purpose: '逐条评估回答忠实度、需求覆盖和检索上下文召回。',
    file: 'src/modules/agent-evals/agent-eval.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；在线 AgentEval 结果依赖 Judge 实际调用和人工审核的标准要求／证据。',
    rollback: '恢复上一版 AgentEval Judge 指令并重新检查在线评测结果。',
  },
  {
    name: 'memory.classifier',
    version: contentVersion(memoryClassifierSystemPrompt),
    owner: 'rag-backend',
    purpose: '把本轮新事实分类到长期用户记忆或当前会话记忆。',
    file: 'src/modules/memory/memory.prompts.ts',
    evals: [],
    evaluationNote: '暂无专用离线质量评测；promptVersion 记录实际发起的分类调用。',
    rollback: '恢复上一版记忆分类系统提示词并复查记忆写入样例。',
  },
  {
    name: 'memory.summary_compaction',
    version: contentVersion(shortTermSummaryCompactionSystemPrompt),
    owner: 'rag-backend',
    purpose: '压缩较早会话消息并生成结构化短期摘要。',
    file: 'src/modules/memory/memory.prompts.ts',
    evals: [],
    evaluationNote: '暂无专用离线质量评测；仅在真实压缩调用的审计结果中记录版本。',
    rollback: '恢复上一版短期摘要压缩系统提示词。',
  },
  {
    name: 'memory.summary_recovery',
    version: contentVersion(shortTermSummaryRecoverySystemPrompt),
    owner: 'rag-backend',
    purpose: '从 PostgreSQL 原始历史分块恢复缺失的结构化短期摘要。',
    file: 'src/modules/memory/memory.prompts.ts',
    evals: [],
    evaluationNote: '暂无专用离线质量评测；仅在真实摘要恢复调用的运行事件中记录版本。',
    rollback: '恢复上一版短期摘要恢复系统提示词。',
  },
];

export function getPromptVersion(name: string): string {
  const entry = promptRegistry.find((prompt) => prompt.name === name);
  if (!entry) throw new Error(`Prompt registry entry not found: ${name}`);
  return entry.version;
}
