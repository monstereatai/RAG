import { StateGraph, START, END } from '@langchain/langgraph';
import {
  PRODUCTION_ROLES,
  ProductionEvidence,
  ProductionRole,
  ProductionStageResult,
  ProductionWorkflowState,
  ProductionWorkflowStateType,
} from './production-workflow.state';
import { dependenciesForProductionRole } from './production-workflow.plan';
import { buildProductionRoleSystemPrompt } from './production-role.prompts';
import { getPromptVersion } from '../../rag/prompts/prompt-registry';
import { countTextTokens } from '../document/chunking.util';
import {
  ProductionPreviousRoleContext,
  ROLE_LLM_TIMEOUT_MS,
  roleSchema,
  ROLE_LLM_RETRY_BACKOFF_MS,
  WORKFLOW_EVIDENCE_EXCERPT_CHAR_BUDGET,
  WORKFLOW_MIN_INPUT_SAFETY_TOKENS,
  WORKFLOW_INPUT_SAFETY_RATIO,
} from './production-workflow.shared';
import { ProductionWorkflowRoleSupportBase } from './production-workflow.role-support';

export class ProductionWorkflowExecutionBase extends ProductionWorkflowRoleSupportBase {
  protected readonly app: ReturnType<
    ProductionWorkflowExecutionBase['buildGraph']
  > = this.buildGraph();

  protected buildGraph() {
    const graph = new StateGraph(ProductionWorkflowState)
      .addNode('prepare', this.prepareNode.bind(this))
      .addNode('executeBatch', this.executeBatchNode.bind(this));

    graph.addEdge(START, 'prepare');
    graph.addConditionalEdges(
      'prepare',
      (state) => (state.status === 'running' ? 'executeBatch' : END),
      {
        executeBatch: 'executeBatch',
        [END]: END,
      },
    );
    graph.addEdge('executeBatch', END);
    return graph.compile({ checkpointer: this.checkpointer });
  }

  protected async prepareNode(
    state: ProductionWorkflowStateType,
  ): Promise<Partial<ProductionWorkflowStateType>> {
    if (state.status === 'cancelled') return {};
    this.assertLeaseOwned(state.threadId);
    if (state.status === 'completed' || state.status === 'failed') return {};
    if (state.stepCount >= state.maxSteps) {
      return {
        status: 'failed',
        error: `maximum workflow steps exceeded (${state.maxSteps})`,
      };
    }

    if (state.status === 'running' && state.rerunRoles.length > 0) {
      return { stepCount: state.stepCount + 1, error: '' };
    }

    let batchIndex = state.batchIndex;
    let completedRoles = state.completedRoles;
    let resultUpdates: ProductionWorkflowStateType['results'] = {};
    if (state.status === 'pending_approval') {
      if (!state.approval) return {};
      if (state.approval === 'approved') {
        completedRoles = this.unionRoles(completedRoles, state.currentBatch);
        batchIndex += 1;
        resultUpdates = Object.fromEntries(
          state.currentBatch.map((role) => [
            role,
            state.results[role]
              ? { ...state.results[role], reviewStatus: 'approved' as const }
              : state.results[role],
          ]),
        );
        this.assertLeaseOwned(state.threadId);
        await Promise.all(
          state.currentBatch.map((role) => {
            const artifactId = state.results[role]?.generatedArtifact?.id;
            return artifactId
              ? this.artifacts.markReviewState(artifactId, {
                  reviewStatus: 'approved',
                  revision: state.results[role]?.revision ?? 1,
                })
              : Promise.resolve();
          }),
        );
      }
    }
    if (batchIndex >= state.executionBatches.length) {
      return {
        batchIndex,
        stageIndex: completedRoles.length,
        completedRoles,
        status: 'completed',
        approval: null,
        feedback: '',
        pendingApprovalRoles: [],
        rerunRoles: [],
        results: resultUpdates,
      };
    }
    const currentBatch = state.executionBatches[batchIndex];
    return {
      batchIndex,
      currentBatch,
      currentRole: currentBatch[0],
      completedRoles,
      stageIndex: completedRoles.length,
      status: 'running',
      approval: null,
      pendingApprovalRoles: [],
      rerunRoles: [],
      results: resultUpdates,
      stepCount: state.stepCount + 1,
      error: '',
    };
  }

  protected async executeBatchNode(
    state: ProductionWorkflowStateType,
  ): Promise<Partial<ProductionWorkflowStateType>> {
    this.assertLeaseOwned(state.threadId);
    const rolesToRun = state.rerunRoles.length
      ? state.rerunRoles
      : state.currentBatch;
    const entries = await Promise.all(
      rolesToRun.map(
        async (role) => [role, await this.runRole(role, state)] as const,
      ),
    );
    this.assertLeaseOwned(state.threadId);
    const results = Object.fromEntries(entries) as Partial<
      Record<ProductionRole, ProductionStageResult>
    >;
    const mergedResults = { ...state.results, ...results };
    const isRevisionRun =
      (state.revisionNumber ?? 1) > 1 && state.rerunRoles.length > 0;
    const pendingApprovalRoles = state.currentBatch.filter((role) => {
      const result = mergedResults[role];
      if (isRevisionRun) return rolesToRun.includes(role) && Boolean(result);
      return result ? this.requiresRoleApproval(role, result, state) : false;
    });
    if (pendingApprovalRoles.length === 0) {
      const completedRoles = this.unionRoles(
        state.completedRoles,
        state.currentBatch,
      );
      const approvedResults = Object.fromEntries(
        Object.entries(results).map(([role, result]) => [
          role,
          { ...result, reviewStatus: 'approved' as const },
        ]),
      ) as Partial<Record<ProductionRole, ProductionStageResult>>;
      await Promise.all(
        Object.values(approvedResults).map((result) => {
          const artifactId = result?.generatedArtifact?.id;
          return artifactId
            ? this.artifacts.markReviewState(artifactId, {
                reviewStatus: 'approved',
                revision: result.revision,
              })
            : Promise.resolve();
        }),
      );
      return {
        currentRole: state.currentBatch[0],
        batchIndex: state.batchIndex + 1,
        stageIndex: completedRoles.length,
        completedRoles,
        status: 'running',
        results: approvedResults,
        rerunRoles: [],
      };
    }
    // 钉钉审批通知（fire-and-forget，失败只记日志不影响工作流）
    void this.dingTalk?.notifyApproval({
      threadId: state.threadId,
      projectId: state.projectId,
      brief: state.brief,
      completedRoles: state.completedRoles,
      pendingApprovalRoles,
    });
    return {
      currentRole: pendingApprovalRoles[0],
      status: 'pending_approval',
      pendingApprovalRoles,
      results,
      rerunRoles: [],
    };
  }

  protected async runRole(
    role: ProductionRole,
    state: ProductionWorkflowStateType,
  ): Promise<ProductionStageResult> {
    this.assertLeaseOwned(state.threadId);
    await this.emitRuntimeEvent(state, 'role.started', role, {
      role,
      dependencies: dependenciesForProductionRole(role, state.selectedRoles),
    });
    await this.tasks?.updateForRole(state.threadId, role, {
      status: 'running',
    });
    const dependencies = dependenciesForProductionRole(
      role,
      state.selectedRoles,
    );
    const previousResults: ProductionPreviousRoleContext[] = dependencies
      .map((item) => state.results[item])
      .filter((result): result is ProductionStageResult => result !== undefined)
      .map((result) => ({
        role: result.role,
        summary: result.summary,
        deliverables: result.deliverables.map((deliverable) => ({
          type: deliverable.type,
          title: deliverable.title,
          markdownExcerpt: deliverable.markdown.slice(0, 2_000),
        })),
        claims: result.claims,
        issues: result.issues,
        downstreamRisks: result.downstreamRisks,
        riskLevel: result.riskLevel,
      }));
    const toolResult = await this.roleTools.gather(role, {
      projectId: state.projectId,
      brief: this.revisionAwareBrief(state),
      userId: state.userId,
      tenantId: state.tenantId,
      threadId: state.threadId,
      runId: state.runId || undefined,
      pluginKeys: state.pluginKeys,
      pluginTools: state.pluginTools,
    });
    this.assertLeaseOwned(state.threadId);
    await this.emitRuntimeEvent(state, 'retrieval.completed', role, {
      evidenceCount: toolResult.evidence.length,
      executions: toolResult.executions,
    });
    await this.emitRuntimeEvent(state, 'request.snapshot', role, {
      schemaVersion: 1,
      route: 'production_workflow',
      role,
      promptVersion: getPromptVersion('workflow.production_role'),
      projectId: state.projectId,
      briefLength: state.brief.length,
      supplementalMaterialsLength: (state.supplementalMaterials ?? '').length,
      dependencyRoles: dependencies,
      evidenceIds: toolResult.evidence.map((item) => item.id),
      evidenceCount: toolResult.evidence.length,
      toolNames: toolResult.executions.map((item) => item.tool),
      pluginKeys: state.pluginKeys,
      approvalMode: state.approvalMode,
    });
    const model = this.llmProvider.getModel();
    const budgetedInput = await this.budgetRoleInput(
      role,
      state,
      previousResults,
      toolResult.evidence,
    );
    toolResult.evidence = budgetedInput.evidence;
    if (
      budgetedInput.previousResultsCompacted ||
      budgetedInput.droppedEvidenceIds.length > 0
    ) {
      await this.emitRuntimeEvent(state, 'context.budget.applied', role, {
        estimatedInputTokens: budgetedInput.estimatedInputTokens,
        budgetTokens: budgetedInput.budgetTokens,
        previousResultsCompacted: budgetedInput.previousResultsCompacted,
        sourceEvidenceCount: budgetedInput.sourceEvidenceCount,
        includedEvidenceCount: budgetedInput.evidence.length,
        droppedEvidenceIds: budgetedInput.droppedEvidenceIds,
      });
    }
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const modelStartedAt = Date.now();
      try {
        this.assertLeaseOwned(state.threadId);
        await this.emitRuntimeEvent(state, 'model.started', role, { attempt });
        const workflowSignal = this.cancellationControllers.get(
          state.threadId,
        )?.signal;
        const timeoutSignal = AbortSignal.timeout(ROLE_LLM_TIMEOUT_MS);
        const requestSignal = workflowSignal
          ? AbortSignal.any([workflowSignal, timeoutSignal])
          : timeoutSignal;
        const output = await this.llmProvider.runWithSignal(requestSignal, () =>
          model
            .withStructuredOutput(roleSchema, { method: 'jsonMode' })
            .invoke(budgetedInput.messages),
        );
        this.assertLeaseOwned(state.threadId);
        toolResult.executions.push({
          tool: 'role_structured_llm',
          status: 'success',
          durationMs: Date.now() - modelStartedAt,
          evidenceCount: toolResult.evidence.length,
        });
        const claims = this.validateClaims(output.claims, toolResult.evidence);
        const evidenceCoverage = this.evidenceCoverage(claims);
        const result: ProductionStageResult = {
          role,
          revision: state.revisionNumber ?? 1,
          reviewStatus: 'pending',
          ...output,
          claims,
          lowCodeSchemas: this.normalizeLowCodeSchemas(
            role,
            state,
            output.lowCodeSchemas,
          ),
          evidence: toolResult.evidence,
          evidenceCoverage,
          toolExecutions: toolResult.executions,
          readyForApproval:
            output.readyForApproval &&
            output.deliverables.length > 0 &&
            claims.every((claim) => claim.status === 'supported'),
          completedAt: new Date().toISOString(),
        };
        this.assertLeaseOwned(state.threadId);
        result.generatedArtifact = await this.publishRoleArtifact(
          state,
          result,
        );
        this.assertLeaseOwned(state.threadId);
        await this.emitRuntimeEvent(state, 'artifact.published', role, {
          artifact: result.generatedArtifact,
          evidenceCoverage: result.evidenceCoverage,
          riskLevel: result.riskLevel,
        });
        await this.recordRoleHandoff(state, result);
        await this.tasks?.updateForRole(state.threadId, role, {
          status: result.readyForApproval ? 'completed' : 'waiting_approval',
          summary: result.summary,
          outputArtifactId: result.generatedArtifact?.id,
          approvalRequired: !result.readyForApproval,
        });
        await this.emitRuntimeEvent(state, 'role.completed', role, {
          readyForApproval: result.readyForApproval,
          riskLevel: result.riskLevel,
          evidenceCoverage: result.evidenceCoverage,
        });
        return result;
      } catch (error) {
        this.assertLeaseOwned(state.threadId);
        lastError = error as Error;
        toolResult.executions.push({
          tool: 'role_structured_llm',
          status: 'failed',
          durationMs: Date.now() - modelStartedAt,
          evidenceCount: toolResult.evidence.length,
          error: lastError.message,
        });
        this.logger.warn(
          `${role} structured output attempt ${attempt} failed: ${lastError.message}`,
        );
        await this.emitRuntimeEvent(state, 'model.failed', role, {
          attempt,
          error: lastError.message,
        });
        if (attempt < 2) {
          await this.sleep(ROLE_LLM_RETRY_BACKOFF_MS * 2 ** (attempt - 1));
        }
      }
    }
    this.assertLeaseOwned(state.threadId);
    const degraded = this.degradedRoleResult(
      role,
      state,
      toolResult,
      lastError,
    );
    degraded.generatedArtifact = await this.publishRoleArtifact(
      state,
      degraded,
    );
    await this.recordRoleHandoff(state, degraded);
    await this.tasks?.updateForRole(state.threadId, role, {
      status: 'waiting_approval',
      summary: degraded.summary,
      outputArtifactId: degraded.generatedArtifact?.id,
      approvalRequired: true,
      errorMessage: lastError?.message,
    });
    await this.emitRuntimeEvent(state, 'role.degraded', role, {
      error: lastError?.message,
      artifact: degraded.generatedArtifact,
    });
    return degraded;
  }

  protected async budgetRoleInput(
    role: ProductionRole,
    state: ProductionWorkflowStateType,
    previousResults: ProductionPreviousRoleContext[],
    sourceEvidence: ProductionEvidence[],
  ): Promise<{
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
  }> {
    const budgetTokens = this.getWorkflowInputTokenBudget();
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

    // 证据按检索得分顺序进入；预算仍超限时从尾部移除低分项，并让
    // 后续引用校验也只接受实际交给模型的证据。
    while (
      prepared.estimatedInputTokens > budgetTokens &&
      evidence.length > 1
    ) {
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

  protected getWorkflowInputTokenBudget(): number {
    const configuredWindow = Number(
      this.configService?.get<number>('llm.contextWindowTokens'),
    );
    const contextWindow =
      Number.isFinite(configuredWindow) && configuredWindow > 0
        ? configuredWindow
        : 32_768;
    const activeProvider = this.llmProvider.getActiveProviderName();
    const providers = [
      activeProvider,
      this.llmProvider.getFallbackProviderName(),
    ].filter((item): item is NonNullable<typeof item> => Boolean(item));
    const outputBudget = Math.max(
      ...providers.map((provider) =>
        Math.max(
          Number(
            this.configService?.get<number>(`llm.${provider}.maxTokens`),
          ) || 4_096,
          this.llmProvider.getRoutePolicy('structured', provider).maxTokens,
        ),
      ),
    );
    const safetyMargin = Math.max(
      WORKFLOW_MIN_INPUT_SAFETY_TOKENS,
      Math.ceil(contextWindow * WORKFLOW_INPUT_SAFETY_RATIO),
    );
    return Math.max(1, contextWindow - outputBudget - safetyMargin);
  }

  protected async recordRoleHandoff(
    state: ProductionWorkflowStateType,
    result: ProductionStageResult,
  ): Promise<void> {
    if (!this.collaboration) return;
    const downstreamRoles = PRODUCTION_ROLES.filter((candidate) =>
      dependenciesForProductionRole(candidate, state.selectedRoles).includes(
        result.role,
      ),
    );
    await Promise.all(
      downstreamRoles.map((toRole) =>
        this.collaboration!.publishMessage({
          threadId: state.threadId,
          fromRole: result.role,
          toRole,
          messageType: 'artifact_handoff',
          subject: `${result.role} → ${toRole} 交接`,
          payload: {
            summary: result.summary,
            riskLevel: result.riskLevel,
            evidenceCoverage: result.evidenceCoverage,
            readyForApproval: result.readyForApproval,
          },
          artifactIds: result.generatedArtifact?.id
            ? [result.generatedArtifact.id]
            : [],
        }),
      ),
    );
  }
}
