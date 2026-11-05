import type { ConfigService } from '@nestjs/config';
import type { LlmProvider } from '../../providers/llm/llm.provider';
import { countTextTokens } from '../document/chunking.util';
import { buildProductionRoleSystemPrompt } from './production-role.prompts';
import type {
  ProductionEvidence,
  ProductionRole,
  ProductionWorkflowStateType,
} from './production-workflow.state';
import {
  type ProductionPreviousRoleContext,
  WORKFLOW_EVIDENCE_EXCERPT_CHAR_BUDGET,
  WORKFLOW_INPUT_SAFETY_RATIO,
  WORKFLOW_MIN_INPUT_SAFETY_TOKENS,
} from './production-workflow.shared';

export interface ProductionRoleInput {
  messages: [
    { role: 'system'; content: string },
    { role: 'user'; content: string },
  ];
  evidence: ProductionEvidence[];
  sourceEvidenceCount: number;
  droppedEvidenceIds: string[];
  estimatedInputTokens: number;
  budgetTokens: number;
  previousResultsCompacted: boolean;
}

/** 岗位输入只负责组织和裁剪上下文，不执行检索或模型调用。 */
export async function prepareProductionRoleInput(
  role: ProductionRole,
  state: ProductionWorkflowStateType,
  previousResults: ProductionPreviousRoleContext[],
  sourceEvidence: ProductionEvidence[],
  llmProvider: LlmProvider,
  configService?: ConfigService,
): Promise<ProductionRoleInput> {
  const budgetTokens = workflowInputTokenBudget(llmProvider, configService);
  let evidence = [...sourceEvidence];
  const droppedEvidenceIds: string[] = [];
  let previousResultsCompacted = false;

  const makeMessages = () =>
    [
      {
        role: 'system' as const,
        content: buildProductionRoleSystemPrompt(role),
      },
      {
        role: 'user' as const,
        content: `项目：${state.projectId}\n需求背景：${state.brief}\n前序结构化交付：${JSON.stringify(previousResults)}\n当前可用证据：${JSON.stringify(evidence)}\n驳回意见：${state.feedback || '无'}\n人工补充资料（待核验，不能单独作为 supported 声明依据）：${state.supplementalMaterials || '无'}\n请输出严格结构化结果。deliverables 只生成一份完整但精炼的 Markdown；claims 中 supported 声明必须填写当前证据 id。lowCodeSchemas 用于后续生成可运行项目代码：产品/设计/前端优先输出 pageSchema，后端输出 apiSchema，前端/运营输出 trackingSchema，产品/前端输出 validationSchema，测试输出 acceptanceSchema。json 字段必须严格使用以下形状，不得改名、缺失或把数组改成字符串：{"summary":"岗位结论","deliverables":[{"type":"review","title":"交付物标题","markdown":"# 完整 Markdown"}],"claims":[{"statement":"事实声明","evidenceIds":["当前证据 id"],"status":"supported"}],"issues":[],"downstreamRisks":[],"riskLevel":"low","readyForApproval":false,"lowCodeSchemas":[{"schemaVersion":1,"role":"${role}","kind":"pageSchema","title":"页面结构 Schema","source":"llm","components":[{"id":"main","type":"section","name":"主内容区"}],"apis":[],"events":[],"rules":[],"checks":[],"notes":[]}]}。没有证据的声明使用空 evidenceIds 和 pending_confirmation。`,
      },
    ] as const;

  const estimate = async () => {
    const messages = makeMessages();
    const text = messages.map((message) => message.content).join('\n');
    return {
      messages,
      estimatedInputTokens: (await countTextTokens(text)) + 8,
    };
  };

  let prepared = await estimate();
  if (prepared.estimatedInputTokens > budgetTokens) {
    previousResultsCompacted = true;
    previousResults = previousResults.map((result) => ({
      ...result,
      summary: result.summary.slice(0, 1_000),
      deliverables: result.deliverables.map((deliverable) => ({
        ...deliverable,
        markdownExcerpt: deliverable.markdownExcerpt.slice(0, 800),
      })),
      claims: result.claims.slice(0, 8).map((claim) => ({
        ...claim,
        statement: claim.statement.slice(0, 400),
      })),
      issues: result.issues.slice(0, 6),
      downstreamRisks: result.downstreamRisks.slice(0, 6),
    }));
    prepared = await estimate();
  }

  if (prepared.estimatedInputTokens > budgetTokens) {
    evidence = evidence.map((item) => ({
      ...item,
      excerpt: item.excerpt.slice(0, WORKFLOW_EVIDENCE_EXCERPT_CHAR_BUDGET),
    }));
    prepared = await estimate();
  }

  // 证据按检索得分顺序进入；预算仍超限时从尾部移除低分项。
  while (prepared.estimatedInputTokens > budgetTokens && evidence.length > 1) {
    const dropped = evidence.pop();
    if (dropped) droppedEvidenceIds.push(dropped.id);
    prepared = await estimate();
  }

  if (prepared.estimatedInputTokens > budgetTokens) {
    throw new Error(
      `工作流固定指令与当前需求超过模型输入预算：${prepared.estimatedInputTokens}/${budgetTokens} tokens；未调用模型。`,
    );
  }

  return {
    messages: [prepared.messages[0], prepared.messages[1]],
    evidence,
    sourceEvidenceCount: sourceEvidence.length,
    droppedEvidenceIds,
    estimatedInputTokens: prepared.estimatedInputTokens,
    budgetTokens,
    previousResultsCompacted,
  };
}

function workflowInputTokenBudget(
  llmProvider: LlmProvider,
  configService?: ConfigService,
): number {
  const configuredWindow = Number(
    configService?.get<number>('llm.contextWindowTokens'),
  );
  const contextWindow =
    Number.isFinite(configuredWindow) && configuredWindow > 0
      ? configuredWindow
      : 32_768;
  const providers = [
    llmProvider.getActiveProviderName(),
    llmProvider.getFallbackProviderName(),
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const outputBudget = Math.max(
    ...providers.map((provider) =>
      Math.max(
        Number(configService?.get<number>(`llm.${provider}.maxTokens`)) ||
          4_096,
        llmProvider.getRoutePolicy('structured', provider).maxTokens,
      ),
    ),
  );
  const safetyMargin = Math.max(
    WORKFLOW_MIN_INPUT_SAFETY_TOKENS,
    Math.ceil(contextWindow * WORKFLOW_INPUT_SAFETY_RATIO),
  );
  return Math.max(1, contextWindow - outputBudget - safetyMargin);
}
