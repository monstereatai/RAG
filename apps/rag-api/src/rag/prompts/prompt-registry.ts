import { createHash } from 'node:crypto';
import { agentEvalJudgeSystemPrompt } from '../../modules/agent-evals/agent-eval.prompts';
import { productionRolePromptDefinition } from '../../modules/workflow/production-role.prompts';
import {
  memoryClassifierSystemPrompt,
  memoryConsolidationSystemPrompt,
  shortTermSummaryCompactionSystemPrompt,
  shortTermSummaryRecoverySystemPrompt,
} from '../../modules/memory/memory.prompts';
import { QUERY_PLAN_PROMPT } from '../planning/query-planner.prompt';
import { supervisorAgentPromptDefinitions } from '../agents/agent-prompts';
import { agenticPromptDefinitions } from './agentic.prompts';
import { generateAnswerPromptDefinition } from './rag.prompts';
import { scheduledAnalysisReportSystemPrompt } from '../../modules/jobs/scheduled-analysis.prompts';
import { graphExtractionPromptDefinition } from '../../modules/structured/graph-extractor.prompts';
import {
  graphAnswerPromptDefinition,
  graphEntityExtractionPromptDefinition,
} from '../../modules/graph/graph.prompts';
import { documentMetadataPromptDefinition } from '../../modules/document/document-metadata.prompts';
import {
  obsidianNoteDraftPromptDefinition,
  obsidianProjectWorkflowPromptDefinition,
} from '../../modules/obsidian/obsidian-knowledge.prompts';
import { structuredReportPromptTemplate } from '../../modules/structured/structured.prompts';
import { weeklySummaryPromptDefinitions } from '../../modules/weekly-summary/weekly-summary.prompts';
import { productionProjectGenerationPromptDefinitions } from '../../modules/workflow/production-project-generation.prompts';
import { productionProjectWorkspaceAgentPromptTemplate } from '../../modules/workflow/production-project-workspace-agent.prompts';
import { productionTestAgentPromptTemplate } from '../../modules/workflow/production-test-agent.prompts';
import { productionArtifactStudioPromptDefinitions } from '../../modules/workflow/production-artifact-studio.prompts';
import { ragFallbackPromptDefinitions } from '../answer/rag-fallback.prompts';
import { supervisorRouterPromptTemplate } from '../../modules/supervisor/supervisor-router.prompts';
import { groundedAnswerPromptDefinitions } from '../generation/grounded-answer.prompts';

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

export function getPromptContentVersion(source: unknown): string {
  return contentVersion(source);
}

export const promptRegistry: PromptRegistryEntry[] = [
  {
    name: 'agentic.direct_answer',
    version: contentVersion(agenticPromptDefinitions.directAnswer),
    owner: 'rag-backend',
    purpose: '只在路由与证据策略明确允许时回答可由通用知识判断的事实问题。',
    file: 'src/rag/prompts/agentic.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；必须使用路由边界、内部资料拒答和多意图样本验证。',
    rollback: '恢复上一版直接回答提示词并复核绕过检索的路由边界。',
  },
  {
    name: 'rag.correction_answer',
    version: contentVersion(groundedAnswerPromptDefinitions.correction),
    owner: 'rag-backend',
    purpose: '基于经过人工审核的纠错事实回答并维持实体一致性。',
    file: 'src/rag/generation/grounded-answer.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；纠错直答需通过审核状态、同名实体和证据不足样本回归。',
    rollback: '恢复上一版纠错回答提示词并检查审核事实边界。',
  },
  {
    name: 'rag.evidence_synthesis',
    version: contentVersion(groundedAnswerPromptDefinitions.evidenceSynthesis),
    owner: 'rag-backend',
    purpose: '用有限检索证据合成自然答案，并保留逐项引用和拒答边界。',
    file: 'src/rag/generation/grounded-answer.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；需用多意图、引用遗漏和无充分证据样本校准。',
    rollback: '恢复上一版证据合成提示词并复查引用门禁。',
  },
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
    name: 'scheduled_analysis.report',
    version: contentVersion(scheduledAnalysisReportSystemPrompt),
    owner: 'rag-backend',
    purpose: '依据统计快照生成有证据边界的运营分析报告。',
    file: 'src/modules/jobs/scheduled-analysis.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；仅有运行时证据门禁，真实运营数据集与分析质量回归仍待业务样本。',
    rollback: '恢复上一版定时分析系统提示词并复查对应统计快照。',
  },
  {
    name: 'graph.extract_entities',
    version: contentVersion(graphExtractionPromptDefinition),
    owner: 'rag-backend',
    purpose: '从文档分块提取有原文证据支持的实体和关系。',
    file: 'src/modules/structured/graph-extractor.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；当前结构化输出和关系过滤不能替代真实业务图谱质量标注。',
    rollback: '恢复上一版图谱抽取提示词并重跑目标语料图谱导入核验。',
  },
  {
    name: 'graph.query_entities',
    version: contentVersion(graphEntityExtractionPromptDefinition),
    owner: 'rag-backend',
    purpose: '从用户问题提取知识图谱查询实体。',
    file: 'src/modules/graph/graph.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；当前有关键词回退，真实查询实体召回仍需业务问题集评估。',
    rollback: '恢复上一版实体提取提示词并核对图谱查询样例。',
  },
  {
    name: 'graph.generate_answer',
    version: contentVersion(graphAnswerPromptDefinition),
    owner: 'rag-backend',
    purpose: '严格基于图谱事实回答问题，并在证据缺失时明确说明。',
    file: 'src/modules/graph/graph.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；需在真实业务图谱上验证事实支撑与拒答边界。',
    rollback: '恢复上一版 GraphRAG 回答提示词并检查引用事实样例。',
  },
  {
    name: 'document.extract_metadata',
    version: contentVersion(documentMetadataPromptDefinition),
    owner: 'rag-backend',
    purpose: '从文档正文抽取标题、作者、摘要、关键词、语言和类别。',
    file: 'src/modules/document/document-metadata.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；目前文档元信息抽取使用截取正文，真实文档准确率仍待评估。',
    rollback: '恢复上一版元信息提取提示词并复核代表性文档结果。',
  },
  {
    name: 'obsidian.note_draft',
    version: contentVersion(obsidianNoteDraftPromptDefinition),
    owner: 'rag-backend',
    purpose: '从 Obsidian 来源内容生成需经结构校验的知识笔记草案。',
    file: 'src/modules/obsidian/obsidian-knowledge.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；失败时使用启发式草稿，需由真实笔记样本验证质量。',
    rollback: '恢复上一版 Obsidian 笔记草案提示词并复核样例。',
  },
  {
    name: 'obsidian.project_workflow',
    version: contentVersion(obsidianProjectWorkflowPromptDefinition),
    owner: 'rag-backend',
    purpose: '基于用户输入和 Obsidian 证据生成项目决策与任务 Markdown。',
    file: 'src/modules/obsidian/obsidian-knowledge.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；输出失败时回退模板，业务决策质量仍待真实样本评估。',
    rollback: '恢复上一版 Obsidian 项目工作流提示词并核对对应类型样例。',
  },
  {
    name: 'rag.fallback.web_search_answer',
    version: contentVersion(ragFallbackPromptDefinitions.webSearchAnswer),
    owner: 'rag-backend',
    purpose: '基于受控网页搜索结果生成保留来源链接的回答。',
    file: 'src/rag/answer/rag-fallback.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；需要真实网页命中、资料不足和实时信息样本回归。',
    rollback: '恢复上一版联网检索兜底提示词并复核参考来源。',
  },
  {
    name: 'rag.fallback.general_answer',
    version: contentVersion(ragFallbackPromptDefinitions.generalAnswer),
    owner: 'rag-backend',
    purpose: '在无内部证据且策略允许通用知识回答时提供明确标注边界的兜底回答。',
    file: 'src/rag/answer/rag-fallback.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；兜底回答必须使用真实通用问题和拒答样本验证。',
    rollback: '恢复上一版通用知识兜底模板并复查来源边界。',
  },
  {
    name: 'rag.fallback.web_answer',
    version: contentVersion(ragFallbackPromptDefinitions.webAnswer),
    owner: 'rag-backend',
    purpose: '在知识库检索不足时，基于受限网页结果与显式上下文生成回答。',
    file: 'src/rag/answer/rag-fallback.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；需要真实网页命中、资料不足和待确认场景回归。',
    rollback: '恢复上一版网页兜底提示词并复核内部事实与实时数据边界。',
  },
  {
    name: 'rag.fallback.obsidian_answer',
    version: contentVersion(ragFallbackPromptDefinitions.obsidianAnswer),
    owner: 'rag-backend',
    purpose: '依据 Obsidian 长期知识片段生成带片段引用的回答。',
    file: 'src/rag/answer/rag-fallback.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；需要真实笔记来源、冲突和缺证据样本。',
    rollback: '恢复上一版 Obsidian 回答提示词并复核引用边界。',
  },
  {
    name: 'rag.fallback.conversation_state',
    version: contentVersion(ragFallbackPromptDefinitions.conversationState),
    owner: 'rag-backend',
    purpose: '区分客观事实和用户最近明确提出的会话设定。',
    file: 'src/rag/answer/rag-fallback.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；需用真实实体定义冲突与历史更正样本验证。',
    rollback: '恢复上一版会话状态核验提示词并复查事实/设定区分。',
  },
  {
    name: 'rag.fallback.mixed_context',
    version: contentVersion(ragFallbackPromptDefinitions.mixedContext),
    owner: 'rag-backend',
    purpose: '在同一问题涉及通用事实和用户历史设定时分开作答。',
    file: 'src/rag/answer/rag-fallback.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；需用事实与用户设定冲突的审核样本回归。',
    rollback: '恢复上一版混合上下文提示词并复核客观事实优先级。',
  },
  {
    name: 'rag.fallback.evidence_synthesis',
    version: contentVersion(ragFallbackPromptDefinitions.evidenceSynthesis),
    owner: 'rag-backend',
    purpose: '在现有证据上合成多事项答案，并要求逐项引用或说明资料不足。',
    file: 'src/rag/answer/rag-fallback.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；需用经标注的多事项和证据缺失样本验证引用。',
    rollback: '恢复上一版证据合成模板并复查引用和逐项拒答。',
  },
  {
    name: 'structured.report',
    version: contentVersion(structuredReportPromptTemplate),
    owner: 'rag-backend',
    purpose: '按既有结构化 Schema 生成 SSE 分段报告。',
    file: 'src/modules/structured/structured.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；结构化输出约束不代表报告内容经过事实核验。',
    rollback: '恢复上一版结构化报告请求模板并核对输出 Schema。',
  },
  {
    name: 'weekly_summary.chunk',
    version: contentVersion(weeklySummaryPromptDefinitions.chunk),
    owner: 'rag-backend',
    purpose: '压缩周报历史对话片段并保留关注点、未解决事项和后续方向。',
    file: 'src/modules/weekly-summary/weekly-summary.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；需要经审核的多轮真实对话与摘要保真标注。',
    rollback: '恢复上一版周报片段摘要提示词并复查摘要保真。',
  },
  {
    name: 'weekly_summary.merge',
    version: contentVersion(weeklySummaryPromptDefinitions.merge),
    owner: 'rag-backend',
    purpose: '合并分段摘要并删除重复信息，保留未解决事项和后续方向。',
    file: 'src/modules/weekly-summary/weekly-summary.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；需检查多层摘要合并后的事实和待办保留情况。',
    rollback: '恢复上一版周报分段合并提示词并复核信息丢失样例。',
  },
  {
    name: 'workflow.project_generation',
    version: contentVersion(
      productionProjectGenerationPromptDefinitions.system,
    ),
    owner: 'rag-backend',
    purpose: '根据已审批产研交付物生成隔离的前端项目文件。',
    file: 'src/modules/workflow/production-project-generation.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测和真实平台 Schema 回归；只验证 JSON Schema 不能证明项目可运行。',
    rollback: '恢复上一版项目生成指令并重新核对产物边界。',
  },
  {
    name: 'workflow.project_generation.repair',
    version: contentVersion(
      productionProjectGenerationPromptDefinitions.repair,
    ),
    owner: 'rag-backend',
    purpose: '修复项目生成时违反结构或可运行性要求的模型输出。',
    file: 'src/modules/workflow/production-project-generation.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；需要隔离工作区中的无害格式和构建失败样本。',
    rollback: '恢复上一版项目生成修复提示词并检查重试输出约束。',
  },
  {
    name: 'workflow.workspace_agent',
    version: contentVersion(productionProjectWorkspaceAgentPromptTemplate),
    owner: 'rag-backend',
    purpose: '约束一次性隔离工作区 Agent 的单步命令、验证和完成行为。',
    file: 'src/modules/workflow/production-project-workspace-agent.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测和目标 OpenSandbox 命令越界回归；必须在真实服务上验证隔离而非依赖提示词。',
    rollback: '恢复上一版工作区 Agent 系统提示词并复查工具权限边界。',
  },
  {
    name: 'workflow.test_agent',
    version: contentVersion(productionTestAgentPromptTemplate),
    owner: 'rag-backend',
    purpose: '约束 QA Agent 仅通过服务端固定 lint/test/build 验证并生成诊断报告。',
    file: 'src/modules/workflow/production-test-agent.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；单测覆盖服务端固定工具、失败结果、无检查项和重复执行阻断；真实 OpenSandbox 验证需在配置环境运行。',
    rollback: '恢复上一版 QA Agent 提示词并复核 verify 工具 allowlist。',
  },
  {
    name: 'workflow.artifact_studio.schema_edit',
    version: contentVersion(
      productionArtifactStudioPromptDefinitions.schemaEdit,
    ),
    owner: 'rag-backend',
    purpose: '根据用户指令提出受字段白名单约束的 Schema 修改建议。',
    file: 'src/modules/workflow/production-artifact-studio.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测和目标低代码平台契约评测；生成建议仍须经既有运行时校验和人工检查。',
    rollback: '恢复上一版 Schema 编辑提示词并核对允许字段。',
  },
  {
    name: 'workflow.artifact_studio.code_edit',
    version: contentVersion(productionArtifactStudioPromptDefinitions.codeEdit),
    owner: 'rag-backend',
    purpose: '提出限定文件范围的 Vue/React 前端源码修改建议。',
    file: 'src/modules/workflow/production-artifact-studio.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测和真实用户编辑任务回归；输出仍须通过现有路径白名单、源码校验与预览编译。',
    rollback: '恢复上一版源码编辑提示词并复核文件白名单。',
  },
  {
    name: 'memory.classifier',
    version: contentVersion(memoryClassifierSystemPrompt),
    owner: 'rag-backend',
    purpose:
      '把本轮新事实分类到长期用户记忆或当前会话记忆，并识别用户明确更正的旧长期事实。',
    file: 'src/modules/memory/memory.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；promptVersion 记录实际发起的分类调用。',
    rollback: '恢复上一版记忆分类系统提示词并复查记忆写入样例。',
  },
  {
    name: 'memory.consolidation',
    version: contentVersion(memoryConsolidationSystemPrompt),
    owner: 'rag-backend',
    purpose: '生成供用户审核的长期记忆归纳草案，不自动覆盖原始记忆。',
    file: 'src/modules/memory/memory.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；草案必须经用户审核，来源指纹用于审核前检查变化。',
    rollback: '恢复上一版记忆归纳系统提示词并复查待审核草案。',
  },
  {
    name: 'memory.summary_compaction',
    version: contentVersion(shortTermSummaryCompactionSystemPrompt),
    owner: 'rag-backend',
    purpose: '压缩较早会话消息并生成结构化短期摘要。',
    file: 'src/modules/memory/memory.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；仅在真实压缩调用的审计结果中记录版本。',
    rollback: '恢复上一版短期摘要压缩系统提示词。',
  },
  {
    name: 'memory.summary_recovery',
    version: contentVersion(shortTermSummaryRecoverySystemPrompt),
    owner: 'rag-backend',
    purpose: '从 PostgreSQL 原始历史分块恢复缺失的结构化短期摘要。',
    file: 'src/modules/memory/memory.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；仅在真实摘要恢复调用的运行事件中记录版本。',
    rollback: '恢复上一版短期摘要恢复系统提示词。',
  },
  {
    name: 'supervisor.dynamic_router',
    version: contentVersion(supervisorRouterPromptTemplate),
    owner: 'rag-backend',
    purpose: '基于部署时可用领域把请求路由给对应 Agent 子流程。',
    file: 'src/modules/supervisor/supervisor-router.prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；运行时还会对域列表和结构化输出 Schema 计算实际变体 hash。',
    rollback: '恢复上一版路由模板并复查所有注册领域的路由样本。',
  },
  {
    name: 'supervisor_agent.researcher',
    version: contentVersion(supervisorAgentPromptDefinitions.researcher),
    owner: 'rag-backend',
    purpose: 'Supervisor researcher 子 Agent 的系统提示词。',
    file: 'src/rag/agents/agent-prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；Supervisor 子 Agent 提示词尚未建立独立回归基线。',
    rollback: '恢复上一版 researcher 子 Agent 提示词并复查对应运行样例。',
  },
  {
    name: 'supervisor_agent.analyst',
    version: contentVersion(supervisorAgentPromptDefinitions.analyst),
    owner: 'rag-backend',
    purpose: 'Supervisor analyst 子 Agent 的系统提示词。',
    file: 'src/rag/agents/agent-prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；Supervisor 子 Agent 提示词尚未建立独立回归基线。',
    rollback: '恢复上一版 analyst 子 Agent 提示词并复查对应运行样例。',
  },
  {
    name: 'supervisor_agent.writer',
    version: contentVersion(supervisorAgentPromptDefinitions.writer),
    owner: 'rag-backend',
    purpose: 'Supervisor writer 子 Agent 的系统提示词。',
    file: 'src/rag/agents/agent-prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；Supervisor 子 Agent 提示词尚未建立独立回归基线。',
    rollback: '恢复上一版 writer 子 Agent 提示词并复查对应运行样例。',
  },
  {
    name: 'supervisor_agent.critic',
    version: contentVersion(supervisorAgentPromptDefinitions.critic),
    owner: 'rag-backend',
    purpose: 'Supervisor critic 子 Agent 的系统提示词。',
    file: 'src/rag/agents/agent-prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；Supervisor 子 Agent 提示词尚未建立独立回归基线。',
    rollback: '恢复上一版 critic 子 Agent 提示词并复查对应运行样例。',
  },
  {
    name: 'supervisor_agent.editor',
    version: contentVersion(supervisorAgentPromptDefinitions.editor),
    owner: 'rag-backend',
    purpose: 'Supervisor editor 子 Agent 的系统提示词。',
    file: 'src/rag/agents/agent-prompts.ts',
    evals: [],
    evaluationNote:
      '暂无专用离线质量评测；Supervisor 子 Agent 提示词尚未建立独立回归基线。',
    rollback: '恢复上一版 editor 子 Agent 提示词并复查对应运行样例。',
  },
];

export function getPromptVersion(name: string): string {
  const entry = promptRegistry.find((prompt) => prompt.name === name);
  if (!entry) throw new Error(`Prompt registry entry not found: ${name}`);
  return entry.version;
}

export function getPromptMetadata(name: string): {
  promptName: string;
  promptVersion: string;
} {
  return { promptName: name, promptVersion: getPromptVersion(name) };
}
