import type { ProductionWorkflowContext } from './production-workflow.context';
import { randomUUID } from 'node:crypto';
import {
  ProductionRole,
  ProductionWorkflowStateType,
} from './production-workflow.state';
import { ResumeProductionWorkflowDto } from './production-workflow.dto';

export class ProductionWorkflowRevision {
  readonly context: ProductionWorkflowContext;

  constructor(context: ProductionWorkflowContext) {
    this.context = context;
  }
  async rejectForRevision(
    threadId: string,
    current: ProductionWorkflowStateType,
    dto: ResumeProductionWorkflowDto,
    userId: string,
  ) {
    const lockKey = `production:workflow:rejection:${threadId}`;
    const lockToken = randomUUID();
    let acquiredRedisLock = false;
    if (this.context.redisProvider.isEnabled()) {
      acquiredRedisLock = await this.context.redisProvider.setIfAbsent(
        lockKey,
        lockToken,
        300,
      );
      if (!acquiredRedisLock) {
        throw new Error('workflow rejection is already being persisted');
      }
    } else {
      if (
        this.context.configService?.get<boolean>('core.requireDependencies') ===
          true ||
        this.context.configService?.get<string>('nodeEnv') === 'production'
      ) {
        throw new Error('Redis rejection lock is required in production.');
      }
      if (this.context.rejectionOperations.has(threadId)) {
        throw new Error('workflow rejection is already being persisted');
      }
      this.context.rejectionOperations.add(threadId);
    }

    try {
      if (current.status === 'revision_required') {
        if (!this.matchesRejectedRevisionRequest(current, dto)) {
          throw new Error('驳回请求与当前待修订版本不匹配。');
        }
        return this.finalizeRejectedRevision(threadId, current, userId);
      }
      if (current.status !== 'pending_approval') {
        throw new Error(`workflow is not pending approval: ${current.status}`);
      }
      return await this.completeRejectedRevision(
        threadId,
        current,
        dto,
        userId,
      );
    } finally {
      this.context.rejectionOperations.delete(threadId);
      if (acquiredRedisLock) {
        try {
          await this.context.redisProvider.releaseLock(lockKey, lockToken);
        } catch (error) {
          this.context.logger.warn(
            `workflow rejection lock release failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  matchesRejectedRevisionRequest(
    state: ProductionWorkflowStateType,
    dto: ResumeProductionWorkflowDto,
  ): boolean {
    const latest = state.revisionHistory.at(-1);
    if (
      state.status !== 'revision_required' ||
      dto.approval !== 'rejected' ||
      !latest ||
      state.revisionNumber !== latest.revision + 1 ||
      state.feedback !== (dto.feedback?.trim() ?? '') ||
      latest.feedback !== state.feedback ||
      !this.context.control.sameRoles(state.rerunRoles, latest.rejectedRoles) ||
      !this.context.control.sameRoles(state.staleRoles, latest.staleRoles)
    ) {
      return false;
    }
    if (!dto.rerunRoles?.length) return true;
    const requested = dto.rerunRoles.filter((role) =>
      state.currentBatch.includes(role),
    );
    return this.sameRoleSet(
      requested.length ? requested : state.currentBatch,
      latest.rejectedRoles,
    );
  }

  sameRoleSet(left: ProductionRole[], right: ProductionRole[]): boolean {
    return (
      left.length === right.length && left.every((role) => right.includes(role))
    );
  }

  async completeRejectedRevision(
    threadId: string,
    current: ProductionWorkflowStateType,
    dto: ResumeProductionWorkflowDto,
    userId: string,
  ) {
    const feedback = dto.feedback?.trim() ?? '';
    if (!feedback) throw new Error('rejection feedback is required');
    const continuingRejection = current.approval === 'rejected';
    if (continuingRejection && feedback !== current.feedback) {
      throw new Error('rejection feedback must match the pending decision');
    }
    let rejectedRoles: ProductionRole[];
    let staleRoles: ProductionRole[];
    let rejectedResults: ProductionWorkflowStateType['results'];
    let revisionHistory: ProductionWorkflowStateType['revisionHistory'];
    if (continuingRejection) {
      rejectedRoles = current.rerunRoles;
      staleRoles = current.staleRoles;
      rejectedResults = current.results;
      revisionHistory = current.revisionHistory;
      if (!rejectedRoles.length || !revisionHistory.length) {
        throw new Error('pending rejection checkpoint is incomplete');
      }
    } else {
      const requested = dto.rerunRoles?.length
        ? dto.rerunRoles.filter((role) => current.currentBatch.includes(role))
        : current.pendingApprovalRoles;
      rejectedRoles = requested.length ? requested : current.currentBatch;
      staleRoles = this.context.events.downstreamRoles(
        rejectedRoles,
        current.selectedRoles,
      );
      rejectedResults = Object.fromEntries(
        Object.entries(current.results).map(([role, result]) => [
          role,
          result
            ? {
                ...result,
                reviewStatus: rejectedRoles.some(
                  (rejectedRole) => rejectedRole === role,
                )
                  ? 'rejected'
                  : current.currentBatch.some(
                        (currentRole) => currentRole === role,
                      )
                    ? 'approved'
                    : staleRoles.some((staleRole) => staleRole === role)
                      ? 'stale'
                      : result.reviewStatus,
              }
            : result,
        ]),
      );
      revisionHistory = [
        ...(current.revisionHistory ?? []),
        {
          revision: current.revisionNumber ?? 1,
          rejectedAt: new Date().toISOString(),
          feedback,
          rejectedRoles,
          staleRoles,
          results: rejectedResults,
        },
      ];
      // Persist the exact decision before side effects. If a task or artifact
      // write fails, the same rejection can resume without accepting a changed
      // role selection or feedback against partially written review state.
      await this.context.app.updateState(this.context.events.config(threadId), {
        status: 'pending_approval',
        approval: 'rejected',
        feedback,
        rerunRoles: rejectedRoles,
        staleRoles,
        revisionHistory,
        results: rejectedResults,
      });
    }

    await Promise.all([
      ...rejectedRoles.map((role) =>
        this.context.tasks?.updateForRole(threadId, role, {
          status: 'revision_required',
          summary: feedback,
          approvalRequired: true,
        }),
      ),
      ...staleRoles.map((role) =>
        this.context.tasks?.updateForRole(threadId, role, {
          status: 'stale',
          summary: `上游产物被驳回：${feedback}`,
          approvalRequired: false,
        }),
      ),
    ]);
    await Promise.all(
      Object.entries(rejectedResults).map(([role, result]) => {
        const artifactId = result?.generatedArtifact?.id;
        if (!artifactId) return Promise.resolve();
        const productionRole = role as ProductionRole;
        const reviewStatus = rejectedRoles.includes(productionRole)
          ? 'rejected'
          : staleRoles.includes(productionRole)
            ? 'stale'
            : null;
        return reviewStatus
          ? this.context.artifacts.markReviewState(artifactId, {
              reviewStatus,
              revision: result.revision ?? current.revisionNumber ?? 1,
              feedback,
            })
          : Promise.resolve();
      }),
    );
    // Keep the rejection marker until Task and Artifact review state has been
    // persisted, so a repeated request can complete a partial write.
    await this.context.app.updateState(this.context.events.config(threadId), {
      status: 'revision_required',
      approval: null,
      feedback,
      pendingApprovalRoles: [],
      rerunRoles: rejectedRoles,
      staleRoles,
      revisionNumber: (current.revisionNumber ?? 1) + 1,
      revisionHistory,
      results: rejectedResults,
      error: '',
    });
    const state = await this.context.state.getOwnedState(threadId, userId);
    return this.finalizeRejectedRevision(threadId, state, userId);
  }

  async finalizeRejectedRevision(
    threadId: string,
    state: ProductionWorkflowStateType,
    userId: string,
  ) {
    const revision = state.revisionHistory.at(-1);
    if (!revision || state.status !== 'revision_required') {
      throw new Error('待补齐的驳回记录不存在或状态已变化。');
    }
    const nextRevision = state.revisionNumber ?? 1;

    // The outbox derives an idempotency key from this payload, so retrying after
    // a later event/index failure cannot create a duplicate domain event.
    await this.context.domainEvents?.emit({
      tenantId: state.tenantId,
      eventType: 'workflow.revision_required',
      aggregateType: 'production_workflow',
      aggregateId: state.threadId,
      payload: {
        projectId: state.projectId,
        runId: state.runId ?? null,
        roles: state.rerunRoles,
        revision: nextRevision,
      },
    });

    await this.context.events.emitRevisionRuntimeEventOnce(
      state,
      'revision.required',
      'human_reviewer',
      {
        revision: revision.revision,
        nextRevision,
        feedback: revision.feedback,
        rejectedRoles: revision.rejectedRoles,
        staleRoles: revision.staleRoles,
      },
      'nextRevision',
      nextRevision,
    );
    await this.context.events.emitRevisionRuntimeEventOnce(
      state,
      'workflow.revision_required',
      'production_workflow',
      {
        revision: nextRevision,
        roles: state.rerunRoles,
        staleRoles: state.staleRoles,
        feedback: state.feedback,
      },
      'revision',
      nextRevision,
    );
    await this.context.events.emitRevisionRuntimeEventOnce(
      state,
      'goal.paused',
      'production_workflow',
      {
        objective: state.brief,
        status: 'paused',
        round: state.stepCount,
        maxRounds: state.maxSteps,
        revision: nextRevision,
        reason: 'Artifact 已驳回，等待人工确认后启动修订。',
      },
      'revision',
      nextRevision,
    );

    if (state.runId && this.context.agentRuns) {
      const run = await this.context.agentRuns.get(
        state.runId,
        state.tenantId ?? undefined,
      );
      const resultSummary = `${state.projectId}：Artifact 已驳回，等待 v${nextRevision} 修订。`;
      const runUpdatedEventExists = this.context.runtimeEvents
        ? await this.context.runtimeEvents.hasMatchingEvent({
            tenantId: state.tenantId,
            threadId: state.threadId,
            runId: state.runId,
            eventType: 'run.updated',
            payload: {
              status: 'waiting_approval',
              route: 'production_workflow',
              costUsd: run.costUsd,
              resultSummary,
            },
          })
        : false;
      if (
        ['running', 'waiting_approval'].includes(run.status) &&
        (run.resultSummary !== resultSummary || !runUpdatedEventExists)
      ) {
        await this.context.agentRuns.finish(state.runId, {
          route: 'production_workflow',
          status: 'waiting_approval',
          requiresApproval: true,
          resultSummary,
        });
      }
    }

    const result = this.context.events.view(threadId, state, userId);
    await this.context.events.saveWorkflowIndex(result);
    return result;
  }
}
