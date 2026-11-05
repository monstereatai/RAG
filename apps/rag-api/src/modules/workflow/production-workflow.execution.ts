import type { ProductionWorkflowContext } from './production-workflow.context';
import { StateGraph, START, END, Send } from '@langchain/langgraph';
import type { z } from 'zod';
import {
  PRODUCTION_ROLES,
  ProductionRole,
  ProductionStageResult,
  ProductionWorkflowState,
  ProductionWorkflowStateType,
} from './production-workflow.state';
import { dependenciesForProductionRole } from './production-workflow.plan';
import { getPromptVersion } from '../../rag/prompts/prompt-registry';
import {
  ProductionPreviousRoleContext,
  ROLE_LLM_TIMEOUT_MS,
  roleSchema,
  ROLE_LLM_RETRY_BACKOFF_MS,
} from './production-workflow.shared';
import type { ProductionRoleToolResult } from './production-workflow.tools';
import { prepareProductionRoleInput } from './production-workflow.role-input';
import type { ProductionWorkflowGraph } from './production-workflow.runtime';

type RoleOutput = z.infer<typeof roleSchema>;

export class ProductionWorkflowExecution {
  readonly context: ProductionWorkflowContext;
  readonly app: ProductionWorkflowGraph;

  constructor(context: ProductionWorkflowContext) {
    this.context = context;
    this.app = this.buildGraph();
    context.app = this.app;
  }

  buildGraph(): ProductionWorkflowGraph {
    const graph = new StateGraph(ProductionWorkflowState)
      .addNode('prepare', this.prepareNode.bind(this))
      .addNode('executeBatch', this.executeBatchNode.bind(this))
      .addNode('generateRole', this.generateRoleNode.bind(this))
      .addNode('persistRole', this.persistRoleNode.bind(this))
      .addNode('runParallelRole', this.runParallelRoleNode.bind(this))
      .addNode('finishParallelBatch', this.finishParallelBatchNode.bind(this));

    graph.addEdge(START, 'prepare');
    graph.addConditionalEdges(
      'prepare',
      (state) => {
        if (state.status !== 'running') return END;
        if (state.workflowVersion === 3) {
          const roles = state.rerunRoles.length ? state.rerunRoles : state.currentBatch;
          return roles.map((role) =>
            new Send('runParallelRole', { ...state, parallelRole: role }),
          );
        }
        if (state.workflowVersion !== 2) return 'executeBatch';
        return state.rolePhase === 'generated' ? 'persistRole' : 'generateRole';
      },
      {
        executeBatch: 'executeBatch',
        generateRole: 'generateRole',
        persistRole: 'persistRole',
        runParallelRole: 'runParallelRole',
        [END]: END,
      },
    );
    graph.addEdge('executeBatch', END);
    graph.addEdge('runParallelRole', 'finishParallelBatch');
    graph.addEdge('finishParallelBatch', END);
    graph.addEdge('generateRole', 'persistRole');
    graph.addConditionalEdges(
      'persistRole',
      (state) =>
        state.status === 'running' && state.batchRoleCursor > 0
          ? 'generateRole'
          : END,
      { generateRole: 'generateRole', [END]: END },
    );
    return graph.compile({ checkpointer: this.context.checkpointer });
  }

  async prepareNode(
    state: ProductionWorkflowStateType,
  ): Promise<Partial<ProductionWorkflowStateType>> {
    if (state.status === 'cancelled') return {};
    this.context.state.assertLeaseOwned(state.threadId);
    if (state.status === 'completed' || state.status === 'failed') return {};
    if (state.workflowVersion === 2 && state.status === 'running') {
      if (state.rolePhase === 'generated' || state.batchRoleCursor > 0) {
        return {};
      }
    }
    if (state.stepCount >= state.maxSteps) {
      return {
        status: 'failed',
        error: `maximum workflow steps exceeded (${state.maxSteps})`,
      };
    }

    if (state.status === 'running' && state.rerunRoles.length > 0) {
      return {
        currentRole: state.rerunRoles[0],
        batchRoleCursor: 0,
        stepCount: state.stepCount + 1,
        error: '',
      };
    }

    let batchIndex = state.batchIndex;
    let completedRoles = state.completedRoles;
    let resultUpdates: ProductionWorkflowStateType['results'] = {};
    if (state.status === 'pending_approval') {
      if (!state.approval) return {};
      if (state.approval === 'approved') {
        completedRoles = this.context.roleSupport.unionRoles(
          completedRoles,
          state.currentBatch,
        );
        batchIndex += 1;
        resultUpdates = Object.fromEntries(
          state.currentBatch.map((role) => [
            role,
            state.results[role]
              ? { ...state.results[role], reviewStatus: 'approved' as const }
              : state.results[role],
          ]),
        );
        this.context.state.assertLeaseOwned(state.threadId);
        await Promise.all(
          state.currentBatch.map((role) => {
            const artifactId = state.results[role]?.generatedArtifact?.id;
            return artifactId
              ? this.context.artifacts.markReviewState(artifactId, {
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
      batchRoleCursor: 0,
      rolePhase: 'idle',
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

  async executeBatchNode(
    state: ProductionWorkflowStateType,
  ): Promise<Partial<ProductionWorkflowStateType>> {
    this.context.state.assertLeaseOwned(state.threadId);
    const rolesToRun = state.rerunRoles.length
      ? state.rerunRoles
      : state.currentBatch;
    const entries = await Promise.all(
      rolesToRun.map(
        async (role) => [role, await this.runRole(role, state)] as const,
      ),
    );
    this.context.state.assertLeaseOwned(state.threadId);
    const results = Object.fromEntries(entries) as Partial<
      Record<ProductionRole, ProductionStageResult>
    >;
    return this.finishBatch(state, results, rolesToRun);
  }

  async runParallelRoleNode(
    state: ProductionWorkflowStateType,
  ): Promise<Partial<ProductionWorkflowStateType>> {
    const role = state.parallelRole;
    if (!role) throw new Error('parallel workflow role is missing');
    const result = await this.runRole(role, state);
    return { results: { [role]: result } };
  }

  async finishParallelBatchNode(
    state: ProductionWorkflowStateType,
  ): Promise<Partial<ProductionWorkflowStateType>> {
    const roles = state.rerunRoles.length ? state.rerunRoles : state.currentBatch;
    const results = Object.fromEntries(
      roles.map((role) => [role, state.results[role]]),
    ) as Partial<Record<ProductionRole, ProductionStageResult>>;
    return this.finishBatch(state, results, roles);
  }

  /** 新工作流将模型产出单独检查点；旧工作流继续使用 executeBatch。 */
  async generateRoleNode(
    state: ProductionWorkflowStateType,
  ): Promise<Partial<ProductionWorkflowStateType>> {
    const rolesToRun = state.rerunRoles.length
      ? state.rerunRoles
      : state.currentBatch;
    const role = rolesToRun[state.batchRoleCursor];
    if (!role) throw new Error('workflow role cursor is out of range');
    const { toolResult, promptVersion, messages } = await this.prepareRoleInput(
      role,
      state,
    );
    const { output, error } = await this.generateStructuredRole(
      role,
      state,
      this.context.llmProvider.getModel(),
      messages,
      promptVersion,
      toolResult,
    );
    const result = output
      ? this.buildRoleResult(role, state, output, toolResult, promptVersion)
      : this.context.roleSupport.degradedRoleResult(
          role,
          state,
          toolResult,
          error,
        );
    return {
      currentRole: role,
      currentRoleModelError: error?.message ?? '',
      rolePhase: 'generated',
      results: { [role]: result },
    };
  }

  /** 写入可重放；成功后再把岗位游标推进到下一个检查点。 */
  async persistRoleNode(
    state: ProductionWorkflowStateType,
  ): Promise<Partial<ProductionWorkflowStateType>> {
    const rolesToRun = state.rerunRoles.length
      ? state.rerunRoles
      : state.currentBatch;
    const role = rolesToRun[state.batchRoleCursor];
    const result = role ? state.results[role] : undefined;
    if (!role || !result || state.rolePhase !== 'generated') {
      throw new Error('workflow role result is missing from checkpoint');
    }
    const modelError = state.currentRoleModelError
      ? new Error(state.currentRoleModelError)
      : null;
    await this.persistRoleResult(role, state, result, modelError);
    const nextRole = rolesToRun[state.batchRoleCursor + 1];
    if (nextRole) {
      return {
        currentRole: nextRole,
        batchRoleCursor: state.batchRoleCursor + 1,
        currentRoleModelError: '',
        rolePhase: 'idle',
        results: { [role]: result },
      };
    }
    const results = Object.fromEntries(
      rolesToRun.map((item) => [
        item,
        item === role ? result : state.results[item],
      ]),
    ) as Partial<Record<ProductionRole, ProductionStageResult>>;
    const transition = await this.finishBatch(state, results, rolesToRun);
    return {
      ...transition,
      batchRoleCursor: 0,
      currentRoleModelError: '',
      rolePhase: 'idle',
    };
  }

  async finishBatch(
    state: ProductionWorkflowStateType,
    results: Partial<Record<ProductionRole, ProductionStageResult>>,
    rolesToRun: ProductionRole[],
  ): Promise<Partial<ProductionWorkflowStateType>> {
    const mergedResults = { ...state.results, ...results };
    const qualityFailures = state.currentBatch.flatMap((role) => {
      const result = mergedResults[role];
      const quality = result
        ? this.context.roleSupport.roleQuality(result)
        : { status: 'generation_failed', reason: '岗位结果缺失。' };
      return quality.status === 'passed'
        ? []
        : [{ role, reason: quality.reason }];
    });
    if (qualityFailures.length > 0) {
      const reason = qualityFailures
        .map(({ role, reason }) => `${role}：${reason}`)
        .join('；');
      return {
        status: 'revision_required',
        currentRole: qualityFailures[0].role,
        rerunRoles: qualityFailures.map(({ role }) => role),
        qualityBlockedRoles: qualityFailures.map(({ role }) => role),
        revisionNumber: (state.revisionNumber ?? 1) + 1,
        pendingApprovalRoles: [],
        results,
        error: reason,
        feedback: reason,
      };
    }
    const isRevisionRun =
      (state.revisionNumber ?? 1) > 1 &&
      state.rerunRoles.length > 0 &&
      (state.qualityBlockedRoles?.length ?? 0) === 0;
    const pendingApprovalRoles = state.currentBatch.filter((role) => {
      const result = mergedResults[role];
      if (isRevisionRun) return rolesToRun.includes(role) && Boolean(result);
      return result
        ? this.context.roleSupport.requiresRoleApproval(role, result, state)
        : false;
    });
    if (pendingApprovalRoles.length === 0) {
      const completedRoles = this.context.roleSupport.unionRoles(
        state.completedRoles,
        state.currentBatch,
      );
      const approvedResults = Object.fromEntries(
        state.currentBatch.map((role) => [
          role,
          { ...mergedResults[role]!, reviewStatus: 'approved' as const },
        ]),
      ) as Partial<Record<ProductionRole, ProductionStageResult>>;
      await Promise.all(
        Object.values(approvedResults).map((result) => {
          const artifactId = result?.generatedArtifact?.id;
          return artifactId
            ? this.context.artifacts.markReviewState(artifactId, {
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
        qualityBlockedRoles: [],
      };
    }
    return {
      currentRole: pendingApprovalRoles[0],
      status: 'pending_approval',
      pendingApprovalRoles,
      results,
      rerunRoles: [],
      qualityBlockedRoles: [],
    };
  }

  async runRole(
    role: ProductionRole,
    state: ProductionWorkflowStateType,
  ): Promise<ProductionStageResult> {
    const { toolResult, promptVersion, messages } = await this.prepareRoleInput(
      role,
      state,
    );
    const model = this.context.llmProvider.getModel();
    const { output, error } = await this.generateStructuredRole(
      role,
      state,
      model,
      messages,
      promptVersion,
      toolResult,
    );
    const result = output
      ? this.buildRoleResult(role, state, output, toolResult, promptVersion)
      : this.context.roleSupport.degradedRoleResult(
          role,
          state,
          toolResult,
          error,
        );
    await this.persistRoleResult(role, state, result, error);
    return result;
  }

  async prepareRoleInput(
    role: ProductionRole,
    state: ProductionWorkflowStateType,
  ): Promise<{
    toolResult: ProductionRoleToolResult;
    promptVersion: string;
    messages: [
      { role: 'system'; content: string },
      { role: 'user'; content: string },
    ];
  }> {
    this.context.state.assertLeaseOwned(state.threadId);
    await this.context.events.emitRuntimeEvent(state, 'role.started', role, {
      role,
      dependencies: dependenciesForProductionRole(role, state.selectedRoles),
    });
    await this.context.tasks?.updateForRole(state.threadId, role, {
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
    const toolResult = await this.context.roleTools.gather(role, {
      projectId: state.projectId,
      brief: this.context.events.revisionAwareBrief(state),
      userId: state.userId,
      tenantId: state.tenantId,
      threadId: state.threadId,
      runId: state.runId || undefined,
      pluginKeys: state.pluginKeys,
      pluginTools: state.pluginTools,
    });
    this.context.state.assertLeaseOwned(state.threadId);
    await this.context.events.emitRuntimeEvent(
      state,
      'retrieval.completed',
      role,
      {
        evidenceCount: toolResult.evidence.length,
        executions: toolResult.executions,
      },
    );
    const promptVersion = getPromptVersion('workflow.production_role');
    await this.context.events.emitRuntimeEvent(
      state,
      'request.snapshot',
      role,
      {
        schemaVersion: 1,
        route: 'production_workflow',
        role,
        promptVersion,
        projectId: state.projectId,
        briefLength: state.brief.length,
        supplementalMaterialsLength: (state.supplementalMaterials ?? '').length,
        dependencyRoles: dependencies,
        evidenceIds: toolResult.evidence.map((item) => item.id),
        evidenceCount: toolResult.evidence.length,
        toolNames: toolResult.executions.map((item) => item.tool),
        pluginKeys: state.pluginKeys,
        approvalMode: state.approvalMode,
      },
    );
    const budgetedInput = await prepareProductionRoleInput(
      role,
      state,
      previousResults,
      toolResult.evidence,
      this.context.llmProvider,
      this.context.configService,
    );
    toolResult.evidence = budgetedInput.evidence;
    if (
      budgetedInput.previousResultsCompacted ||
      budgetedInput.droppedEvidenceIds.length > 0
    ) {
      await this.context.events.emitRuntimeEvent(
        state,
        'context.budget.applied',
        role,
        {
          estimatedInputTokens: budgetedInput.estimatedInputTokens,
          budgetTokens: budgetedInput.budgetTokens,
          previousResultsCompacted: budgetedInput.previousResultsCompacted,
          sourceEvidenceCount: budgetedInput.sourceEvidenceCount,
          includedEvidenceCount: budgetedInput.evidence.length,
          droppedEvidenceIds: budgetedInput.droppedEvidenceIds,
        },
      );
    }
    return { toolResult, promptVersion, messages: budgetedInput.messages };
  }

  /** 模型重试只包住模型调用；产物和任务写入失败交给工作流恢复处理。 */
  async generateStructuredRole(
    role: ProductionRole,
    state: ProductionWorkflowStateType,
    model: ReturnType<typeof this.context.llmProvider.getModel>,
    messages: [
      { role: 'system'; content: string },
      { role: 'user'; content: string },
    ],
    promptVersion: string,
    toolResult: ProductionRoleToolResult,
  ): Promise<{ output: RoleOutput | null; error: Error | null }> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const modelStartedAt = Date.now();
      try {
        this.context.state.assertLeaseOwned(state.threadId);
        await this.context.events.emitRuntimeEvent(
          state,
          'model.started',
          role,
          {
            attempt,
          },
        );
        const workflowSignal = this.context.cancellationControllers.get(
          state.threadId,
        )?.signal;
        const timeoutSignal = AbortSignal.timeout(ROLE_LLM_TIMEOUT_MS);
        const requestSignal = workflowSignal
          ? AbortSignal.any([workflowSignal, timeoutSignal])
          : timeoutSignal;
        const output = await this.context.llmProvider.runWithSignal(
          requestSignal,
          () =>
            model
              .withStructuredOutput(roleSchema, { method: 'jsonMode' })
              .invoke(messages, {
                metadata: { promptVersion },
              }),
        );
        this.context.state.assertLeaseOwned(state.threadId);
        toolResult.executions.push({
          tool: 'role_structured_llm',
          status: 'success',
          durationMs: Date.now() - modelStartedAt,
          evidenceCount: toolResult.evidence.length,
        });
        return { output, error: null };
      } catch (error) {
        this.context.state.assertLeaseOwned(state.threadId);
        lastError = error as Error;
        toolResult.executions.push({
          tool: 'role_structured_llm',
          status: 'failed',
          durationMs: Date.now() - modelStartedAt,
          evidenceCount: toolResult.evidence.length,
          error: lastError.message,
        });
        this.context.logger.warn(
          `${role} structured output attempt ${attempt} failed: ${lastError.message}`,
        );
        await this.context.events.emitRuntimeEvent(
          state,
          'model.failed',
          role,
          {
            attempt,
            error: lastError.message,
          },
        );
        const status = Number(
          (error as { status?: number; statusCode?: number }).status ??
            (error as { statusCode?: number }).statusCode,
        );
        const retryable =
          !['AbortError', 'CanceledError', 'CancelledError'].includes(
            lastError.name,
          ) &&
          ![400, 401, 403, 422].includes(status) &&
          (!Number.isFinite(status) || status === 429 || status >= 500);
        if (!retryable) throw lastError;
        if (attempt < 2 && retryable) {
          await this.context.roleSupport.sleep(
            ROLE_LLM_RETRY_BACKOFF_MS * 2 ** (attempt - 1),
          );
        } else {
          break;
        }
      }
    }
    return { output: null, error: lastError };
  }

  buildRoleResult(
    role: ProductionRole,
    state: ProductionWorkflowStateType,
    output: RoleOutput,
    toolResult: ProductionRoleToolResult,
    promptVersion: string,
  ): ProductionStageResult {
    const claims = this.context.roleSupport.validateClaims(
      output.claims,
      toolResult.evidence,
    );
    return {
      role,
      revision: state.revisionNumber ?? 1,
      promptVersion,
      reviewStatus: 'pending',
      ...output,
      claims,
      lowCodeSchemas: this.context.roleSupport.normalizeLowCodeSchemas(
        role,
        state,
        output.lowCodeSchemas,
      ),
      evidence: toolResult.evidence,
      evidenceCoverage: this.context.roleSupport.evidenceCoverage(claims),
      toolExecutions: toolResult.executions,
      readyForApproval:
        output.readyForApproval &&
        output.deliverables.length > 0 &&
        claims.every((claim) => claim.status === 'supported'),
      completedAt: new Date().toISOString(),
    };
  }

  async persistRoleResult(
    role: ProductionRole,
    state: ProductionWorkflowStateType,
    result: ProductionStageResult,
    modelError: Error | null,
  ): Promise<void> {
    this.context.state.assertLeaseOwned(state.threadId);
    const eventKey = `role:${state.revisionNumber ?? 1}:${state.stepCount}:${role}`;
    result.generatedArtifact =
      await this.context.roleSupport.publishRoleArtifact(state, result);
    this.context.state.assertLeaseOwned(state.threadId);
    if (modelError) {
      await this.recordRoleHandoff(state, result);
      await this.context.tasks?.updateForRole(state.threadId, role, {
        status: 'failed',
        summary: result.summary,
        outputArtifactId: result.generatedArtifact?.id,
        approvalRequired: true,
        errorMessage: modelError.message,
      });
      await this.context.events.emitRuntimeEvent(
        state,
        'role.degraded',
        role,
        {
          error: modelError.message,
          artifact: result.generatedArtifact,
        },
        `${eventKey}:degraded`,
      );
      return;
    }
    await this.context.events.emitRuntimeEvent(
      state,
      'artifact.published',
      role,
      {
        artifact: result.generatedArtifact,
        evidenceCoverage: result.evidenceCoverage,
        riskLevel: result.riskLevel,
      },
      `${eventKey}:artifact`,
    );
    await this.recordRoleHandoff(state, result);
    await this.context.tasks?.updateForRole(state.threadId, role, {
      status: result.readyForApproval ? 'completed' : 'failed',
      summary: result.summary,
      outputArtifactId: result.generatedArtifact?.id,
      approvalRequired: !result.readyForApproval,
    });
    await this.context.events.emitRuntimeEvent(
      state,
      'role.completed',
      role,
      {
        readyForApproval: result.readyForApproval,
        riskLevel: result.riskLevel,
        evidenceCoverage: result.evidenceCoverage,
      },
      `${eventKey}:completed`,
    );
  }

  async recordRoleHandoff(
    state: ProductionWorkflowStateType,
    result: ProductionStageResult,
  ): Promise<void> {
    if (!this.context.collaboration) return;
    const downstreamRoles = PRODUCTION_ROLES.filter(
      (candidate) =>
        state.selectedRoles.includes(candidate) &&
        dependenciesForProductionRole(candidate, state.selectedRoles).includes(
          result.role,
        ),
    );
    await Promise.all(
      downstreamRoles.map((toRole) =>
        this.context.collaboration!.publishMessage({
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
          idempotencyKey: `workflow:${state.revisionNumber ?? 1}:${state.stepCount}:${result.role}:${toRole}`,
        }),
      ),
    );
  }
}
