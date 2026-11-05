import type { ProductionWorkflowContext } from './production-workflow.context';
import {
  ProductionRole,
  ProductionWorkflowStateType,
} from './production-workflow.state';
import { dependenciesForProductionRole } from './production-workflow.plan';

export class ProductionWorkflowEvents {
  readonly context: ProductionWorkflowContext;

  constructor(context: ProductionWorkflowContext) {
    this.context = context;
  }
  config(threadId: string) {
    return { configurable: { thread_id: `production:${threadId}` } };
  }

  workflowIndexKey(userId: string, threadId: string) {
    return `production:workflow:${userId}:${threadId}`;
  }

  async saveWorkflowIndex(view: ReturnType<ProductionWorkflowEvents['view']>) {
    const index = {
      ...view,
      brief: undefined,
      updatedAt: new Date().toISOString(),
      results: Object.fromEntries(
        Object.entries(view.results).map(([role, result]) => [
          role,
          result
            ? {
                role: result.role,
                summary: result.summary,
                riskLevel: result.riskLevel,
                evidenceCoverage: result.evidenceCoverage,
                readyForApproval: result.readyForApproval,
                completedAt: result.completedAt,
                deliverables: result.deliverables.map((item) => ({
                  type: item.type,
                  title: item.title,
                })),
                // 历史工作流的岗位结果可能没有 lowCodeSchemas 字段（该字段为后期新增），按空数组兼容。
                lowCodeSchemas: (result.lowCodeSchemas ?? []).map((item) => ({
                  kind: item.kind,
                  title: item.title,
                  source: item.source,
                })),
              }
            : result,
        ]),
      ),
    };
    this.context.workflowIndexMemory.set(
      `${view.userId}:${view.threadId}`,
      index,
    );
    await this.context.redisProvider.set(
      this.workflowIndexKey(view.userId, view.threadId),
      JSON.stringify(index),
    );
    await this.context.redisProvider.zadd(
      `production:workflows:${view.userId}`,
      Date.now(),
      view.threadId,
    );
  }

  async saveWorkflowIndexBestEffort(
    view: ReturnType<ProductionWorkflowEvents['view']>,
  ): Promise<void> {
    try {
      await this.saveWorkflowIndex(view);
    } catch (error) {
      this.context.logger.warn(
        `production workflow ${view.threadId} index persistence failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async traceLangfuse(state: ProductionWorkflowStateType): Promise<void> {
    if (!this.context.langfuseProvider) return;
    await this.context.langfuseProvider.traceProductionWorkflow({
      userId: state.userId,
      threadId: state.threadId,
      projectId: state.projectId,
      brief: state.brief,
      status: state.status,
      stepCount: state.stepCount,
      maxSteps: state.maxSteps,
      approvalMode: state.approvalMode,
      selectedRoles: state.selectedRoles,
      completedRoles: state.completedRoles,
      pendingApprovalRoles: state.pendingApprovalRoles,
      stages: Object.values(state.results).map((result) => ({
        role: result.role,
        promptVersion: result.promptVersion,
        summary: result.summary,
        riskLevel: result.riskLevel,
        evidenceCoverage: result.evidenceCoverage,
        readyForApproval: result.readyForApproval,
        claims: result.claims.length,
        supportedClaims: result.claims.filter(
          (claim) => claim.status === 'supported',
        ).length,
        issues: result.issues,
        downstreamRisks: result.downstreamRisks,
        toolExecutions: result.toolExecutions,
        completedAt: result.completedAt,
      })),
    });
  }

  async emitWorkflowState(state: ProductionWorkflowStateType): Promise<void> {
    const runId = state.runId;
    if (state.status === 'revision_required') {
      await this.emitDomainEvent('workflow.revision_required', state, {
        roles: state.rerunRoles,
        revision: state.revisionNumber ?? 1,
      });
      await this.emitRuntimeEvent(
        state,
        'workflow.revision_required',
        'production_workflow',
        {
          revision: state.revisionNumber ?? 1,
          roles: state.rerunRoles,
          staleRoles: state.staleRoles,
          feedback: state.feedback,
          error: state.error,
        },
      );
      await this.emitRuntimeEvent(state, 'goal.paused', 'production_workflow', {
        objective: state.brief,
        status: 'paused',
        round: state.stepCount,
        maxRounds: state.maxSteps,
        reason: state.error || 'Artifact 已驳回，等待人工确认后启动修订。',
      });
      if (runId) {
        await this.context.agentRuns?.finish(runId, {
          route: 'production_workflow',
          status: 'waiting_approval',
          requiresApproval: true,
          resultSummary: `${state.projectId}：Artifact 已驳回，等待 v${state.revisionNumber} 修订。`,
          errorMessage: state.error || undefined,
        });
      }
      return;
    }
    if (state.status === 'pending_approval') {
      await this.context.control.ensureApprovalNotificationIntent(state);
      await this.emitDomainEvent('workflow.approval_required', state, {
        roles: state.pendingApprovalRoles,
      });
      await this.emitRuntimeEvent(
        state,
        'approval.required',
        'production_workflow',
        {
          roles: state.pendingApprovalRoles,
        },
      );
      await this.emitRuntimeEvent(state, 'goal.paused', 'production_workflow', {
        objective: state.brief,
        status: 'paused',
        round: state.stepCount,
        maxRounds: state.maxSteps,
        reason: '等待人工审批。',
      });
      if (runId) {
        await this.context.agentRuns?.finish(runId, {
          route: 'production_workflow',
          status: 'waiting_approval',
          requiresApproval: true,
          resultSummary: `${state.projectId}：等待 ${state.pendingApprovalRoles.join('、')} 审批。`,
        });
      }
      return;
    }
    if (state.status === 'completed') {
      await this.emitDomainEvent('workflow.completed', state, {
        completedRoles: state.completedRoles,
      });
      await this.emitRuntimeEvent(
        state,
        'workflow.completed',
        'production_workflow',
        {
          completedRoles: state.completedRoles,
        },
      );
      await this.emitRuntimeEvent(
        state,
        'goal.completed',
        'production_workflow',
        {
          objective: state.brief,
          status: 'completed',
          round: state.stepCount,
          maxRounds: state.maxSteps,
        },
      );
      if (runId) {
        await this.context.agentRuns?.finish(runId, {
          route: 'production_workflow',
          status: 'completed',
          resultSummary: `${state.projectId}：已完成 ${state.completedRoles.length}/${state.selectedRoles.length} 个岗位交付。`,
        });
      }
      return;
    }
    if (state.status === 'cancelled') {
      await this.emitDomainEvent('workflow.cancelled', state, {
        reason: state.error ?? '用户取消工作流',
      });
      await this.emitRuntimeEvent(
        state,
        'workflow.cancelled',
        'production_workflow',
        { reason: state.error ?? '用户取消工作流' },
      );
      if (runId) {
        await this.context.agentRuns?.finish(runId, {
          route: 'production_workflow',
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: state.error ?? '用户取消工作流',
          errorMessage: state.error ?? '用户取消工作流',
          resultSummary: `${state.projectId}：工作流已取消。`,
        });
      }
      return;
    }
    if (state.status === 'failed') {
      await this.emitDomainEvent('workflow.failed', state, {
        error: state.error ?? null,
      });
      await this.emitRuntimeEvent(
        state,
        'workflow.failed',
        'production_workflow',
        {
          error: state.error,
        },
      );
      await this.emitRuntimeEvent(
        state,
        'goal.blocked',
        'production_workflow',
        {
          objective: state.brief,
          status: 'blocked',
          round: state.stepCount,
          maxRounds: state.maxSteps,
          reason: state.error || '工作流失败。',
        },
      );
      if (runId) {
        await this.context.agentRuns?.finish(runId, {
          route: 'production_workflow',
          status: 'failed',
          errorMessage: state.error,
          resultSummary: `${state.projectId}：工作流失败。`,
        });
      }
    }
  }

  async emitRuntimeEvent(
    state: ProductionWorkflowStateType,
    eventType: string,
    actor: string,
    payload: unknown,
    idempotencyKey?: string,
  ): Promise<void> {
    if (!this.context.runtimeEvents) return;
    try {
      await this.context.runtimeEvents.emit({
        tenantId: state.tenantId,
        threadId: state.threadId,
        runId: state.runId || undefined,
        eventType,
        actor,
        target: state.projectId,
        payload,
        idempotencyKey,
      });
    } catch (error) {
      this.context.logger.warn(
        `Runtime event skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async emitDomainEvent(
    eventType: string,
    state: ProductionWorkflowStateType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.context.domainEvents?.emit({
        tenantId: state.tenantId,
        eventType,
        aggregateType: 'production_workflow',
        aggregateId: state.threadId,
        payload: {
          projectId: state.projectId,
          runId: state.runId ?? null,
          ...payload,
        },
      });
    } catch (error) {
      this.context.logger.warn(
        `Domain event skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  view(threadId: string, state: ProductionWorkflowStateType, userId: string) {
    return {
      threadId,
      runId: state.runId,
      pluginKeys: state.pluginKeys,
      pluginTools: state.pluginTools,
      projectId: state.projectId,
      userId,
      tenantId: state.tenantId,
      currentRole: state.currentRole,
      selectedRoles: state.selectedRoles,
      executionBatches: state.executionBatches,
      batchIndex: state.batchIndex,
      currentBatch: state.currentBatch,
      completedRoles: state.completedRoles,
      stageIndex: state.stageIndex,
      stepCount: state.stepCount,
      maxSteps: state.maxSteps,
      approvalMode: state.approvalMode,
      approvalRoles: state.approvalRoles,
      riskApprovalThreshold: state.riskApprovalThreshold,
      pendingApprovalRoles: state.pendingApprovalRoles,
      rerunRoles: state.rerunRoles,
      staleRoles: state.staleRoles,
      revisionNumber: state.revisionNumber ?? 1,
      revisionHistory: state.revisionHistory ?? [],
      status: state.status,
      feedback: state.feedback,
      supplementalMaterials: state.supplementalMaterials ?? '',
      results: state.results,
      error: state.error,
      requiresApproval: state.status === 'pending_approval',
      requiresRevision: state.status === 'revision_required',
    };
  }

  revisionAwareBrief(state: ProductionWorkflowStateType): string {
    if (!state.supplementalMaterials) return state.brief;
    return `${state.brief}\n\n本次修订的人工补充资料（待核验）：\n${state.supplementalMaterials}`;
  }

  withRevisionPackage(
    history: ProductionWorkflowStateType['revisionHistory'],
    supplementalMaterials: string,
    rerunRoles: ProductionRole[],
  ) {
    return history.map((record, index) =>
      index === history.length - 1
        ? {
            ...record,
            supplementalMaterials,
            revisedAt: new Date().toISOString(),
            rerunRoles,
          }
        : record,
    );
  }

  async emitRevisionRuntimeEventOnce(
    state: ProductionWorkflowStateType,
    eventType: string,
    actor: string,
    payload: Record<string, unknown>,
    revisionField: 'revision' | 'nextRevision',
    revision: number,
  ): Promise<void> {
    if (!this.context.runtimeEvents) return;
    const events = await this.context.runtimeEvents.list(
      state.threadId,
      state.runId || undefined,
      state.tenantId?.trim() || 'legacy',
      undefined,
      500,
    );
    const alreadyEmitted = events.some((event) => {
      if (event.eventType !== eventType) return false;
      const eventPayload =
        event.payload &&
        typeof event.payload === 'object' &&
        !Array.isArray(event.payload)
          ? (event.payload as Record<string, unknown>)
          : undefined;
      return eventPayload?.[revisionField] === revision;
    });
    if (alreadyEmitted) return;
    await this.context.runtimeEvents.emit({
      tenantId: state.tenantId,
      threadId: state.threadId,
      runId: state.runId || undefined,
      eventType,
      actor,
      target: state.projectId,
      payload,
    });
  }

  downstreamRoles(
    roots: ProductionRole[],
    selectedRoles: ProductionRole[],
  ): ProductionRole[] {
    const affected = new Set<ProductionRole>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const role of selectedRoles) {
        if (roots.includes(role) || affected.has(role)) continue;
        const dependencies = dependenciesForProductionRole(role, selectedRoles);
        if (
          dependencies.some(
            (dependency) =>
              roots.includes(dependency) || affected.has(dependency),
          )
        ) {
          affected.add(role);
          changed = true;
        }
      }
    }
    return [...affected];
  }
}
