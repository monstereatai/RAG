import { createHash, randomUUID } from 'node:crypto';
import { ProductionWorkflowStateType } from './production-workflow.state';
import { StartProductionWorkflowDto } from './production-workflow.dto';
import {
  buildProductionExecutionBatches,
  normalizeProductionRoles,
} from './production-workflow.plan';
import type { ProductionWorkflowJob } from './production-workflow-queue.service';
import { ProductionWorkflowCancelledError } from './production-workflow.shared';
import { ProductionWorkflowEventBase } from './production-workflow.events';

function workflowText(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  if (
    value &&
    typeof value === 'object' &&
    'message' in value &&
    typeof value.message === 'string'
  ) {
    return value.message;
  }
  return fallback;
}

export abstract class ProductionWorkflowStateBase extends ProductionWorkflowEventBase {
  protected async createInitialState(
    dto: StartProductionWorkflowDto,
    userId: string,
    threadId: string,
    tenantId?: string,
  ): Promise<ProductionWorkflowStateType> {
    const selectedRoles = normalizeProductionRoles(dto.roles);
    const composition = this.plugins
      ? await this.plugins.resolve(
          dto.pluginKeys,
          'production',
          ['workflow.production-base'],
          tenantId,
        )
      : {
          pluginKeys: dto.pluginKeys?.length
            ? dto.pluginKeys
            : ['workflow.production-base'],
          toolNames: [],
          manifests: [],
        };
    return {
      threadId,
      projectId: dto.projectId.trim(),
      userId,
      tenantId: tenantId?.trim() || undefined,
      runId: '',
      pluginKeys: composition.pluginKeys,
      pluginTools: composition.toolNames,
      brief: dto.brief.trim(),
      processType: dto.processType ?? 'sequential',
      currentRole: selectedRoles[0],
      selectedRoles,
      executionBatches: buildProductionExecutionBatches(selectedRoles),
      batchIndex: 0,
      currentBatch: [],
      completedRoles: [],
      stageIndex: 0,
      stepCount: 0,
      maxSteps: dto.maxSteps ?? 18,
      approvalMode: dto.approvalMode ?? 'auto',
      approvalRoles: normalizeProductionRoles(dto.approvalRoles).filter(
        (role) => dto.approvalRoles?.includes(role),
      ),
      riskApprovalThreshold: dto.riskApprovalThreshold ?? 'high',
      pendingApprovalRoles: [],
      rerunRoles: [],
      staleRoles: [],
      revisionNumber: 1,
      revisionHistory: [],
      status: 'running',
      approval: null,
      feedback: '',
      supplementalMaterials: '',
      results: {},
      error: '',
    };
  }

  protected async initializeTasks(
    state: ProductionWorkflowStateType,
  ): Promise<void> {
    if (!this.tasks) return;
    const existing = await this.tasks.list(state.threadId);
    if (existing.length > 0) return;
    await this.tasks.createPlan({
      threadId: state.threadId,
      roles: state.selectedRoles,
      processType: state.processType,
    });
  }

  protected async ensureRun(state: ProductionWorkflowStateType): Promise<void> {
    if (!this.agentRuns || state.runId) return;
    const threadId = state.threadId;
    const existing = await this.agentRuns.findLatestByThread(threadId);
    const run =
      existing ??
      (await this.agentRuns.start({
        threadId,
        userId: state.userId,
        mode: 'agentic',
        maxSteps: state.maxSteps,
      }));
    state.runId = run.id;
    if (run.route !== 'production_workflow') {
      await this.agentRuns.finish(run.id, {
        route: 'production_workflow',
        status: run.status,
        resultSummary:
          run.resultSummary ?? `${state.projectId}：产研运工作流已创建。`,
      });
    }
    if (!existing) {
      await this.agentGoals?.activate({
        threadId,
        runId: run.id,
        tenantId: run.tenantId?.trim() || 'legacy',
        actor: 'production_workflow',
        objective: state.brief,
        maxRounds: state.maxSteps,
      });
    }
  }

  protected async ensureIndexedRun(
    item: Record<string, unknown>,
    userId: string,
  ): Promise<void> {
    if (!this.agentRuns) return;
    const threadId = workflowText(item.threadId, '');
    if (!threadId || (await this.agentRuns.findLatestByThread(threadId)))
      return;
    const selectedRoles = Array.isArray(item.selectedRoles)
      ? item.selectedRoles
      : [];
    const completedRoles = Array.isArray(item.completedRoles)
      ? item.completedRoles
      : [];
    const status = workflowText(item.status, 'running');
    const projectId = workflowText(item.projectId, '未命名活动');
    const maxSteps = Number(item.maxSteps ?? 18);
    const run = await this.agentRuns.start({
      threadId,
      userId,
      mode: 'agentic',
      maxSteps,
    });
    await this.agentRuns.finish(run.id, {
      route: 'production_workflow',
      status: run.status,
      resultSummary: `${projectId}：历史工作流补建运行记录，已完成 ${completedRoles.length}/${selectedRoles.length} 个岗位。`,
    });
    await this.agentGoals?.activate({
      threadId,
      runId: run.id,
      tenantId: run.tenantId?.trim() || 'legacy',
      actor: 'production_workflow',
      objective: workflowText(item.brief, projectId),
      maxRounds: maxSteps,
    });
    if (
      status === 'completed' ||
      status === 'failed' ||
      status === 'cancelled' ||
      status === 'pending_approval' ||
      status === 'revision_required'
    ) {
      await this.agentRuns.finish(run.id, {
        route: 'production_workflow',
        status:
          status === 'pending_approval' || status === 'revision_required'
            ? 'waiting_approval'
            : status,
        requiresApproval:
          status === 'pending_approval' || status === 'revision_required',
        errorMessage:
          status === 'failed' || status === 'cancelled'
            ? workflowText(
                item.error,
                status === 'cancelled' ? '用户取消工作流' : '历史工作流失败',
              )
            : undefined,
        cancelledAt: status === 'cancelled' ? new Date() : undefined,
        cancelReason:
          status === 'cancelled'
            ? workflowText(item.error, '用户取消工作流')
            : undefined,
        resultSummary: `${projectId}：历史工作流补建运行记录，已完成 ${completedRoles.length}/${selectedRoles.length} 个岗位。`,
      });
    }
  }

  protected schedule(
    threadId: string,
    userId: string,
    task: () => Promise<unknown>,
  ): void {
    if (this.activeRuns.has(threadId)) return;
    const leaseToken = randomUUID();
    const leaseKey = `production:workflow:lease:${threadId}`;
    const leaseSeconds = 5 * 60;
    let leaseRenewal: NodeJS.Timeout | undefined;
    this.lostLeases.delete(threadId);
    const run = Promise.resolve()
      .then(async () => {
        if (!this.redisProvider.isEnabled()) {
          if (
            this.configService?.get<boolean>('redis.requireDistributedLock') ===
              true ||
            this.configService?.get<boolean>('core.requireDependencies') ===
              true ||
            this.configService?.get<string>('nodeEnv') === 'production'
          ) {
            throw new Error(
              'Redis 分布式锁不可用，生产模式拒绝执行工作流副作用。',
            );
          }
          return true;
        }
        const acquired = await this.redisProvider.setIfAbsent(
          leaseKey,
          leaseToken,
          leaseSeconds,
        );
        if (acquired) {
          leaseRenewal = setInterval(() => {
            void this.redisProvider
              .renewLock(leaseKey, leaseToken, leaseSeconds)
              .then((renewed) => {
                if (!renewed) {
                  this.lostLeases.add(threadId);
                  this.logger.error(
                    `production workflow ${threadId} lease renewal failed; another instance may take over`,
                  );
                }
              })
              .catch((error: unknown) => {
                this.lostLeases.add(threadId);
                this.logger.error(
                  `production workflow ${threadId} lease renewal errored: ${error instanceof Error ? error.message : String(error)}`,
                );
              });
          }, 60_000);
        }
        return acquired;
      })
      .then((acquired) => {
        if (!acquired) {
          this.logger.warn(
            `production workflow ${threadId} is being advanced by another instance`,
          );
          return undefined;
        }
        return task();
      })
      .then(() => undefined)
      .catch((error) => this.markScheduledFailure(threadId, userId, error))
      .finally(() => {
        if (leaseRenewal) clearInterval(leaseRenewal);
        this.activeRuns.delete(threadId);
        this.lostLeases.delete(threadId);
        void this.redisProvider.releaseLock(leaseKey, leaseToken);
        if (this.pendingStates.get(threadId)?.status !== 'failed') {
          this.pendingStates.delete(threadId);
        }
      });
    this.activeRuns.set(threadId, run);
  }

  /** BullMQ 自定义 jobId 不能包含冒号；哈希同时保证稳定去重且不泄露 threadId。 */
  protected workflowJobId(
    operation: ProductionWorkflowJob['operation'],
    threadId: string,
    suffix = '',
  ): string {
    const digest = createHash('sha256')
      .update(`${operation}:${threadId}:${suffix}`)
      .digest('hex')
      .slice(0, 32);
    return `production-workflow-${operation}-${digest}`;
  }

  protected async markScheduledFailure(
    threadId: string,
    userId: string,
    error: unknown,
  ): Promise<void> {
    const message = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 2_000);
    this.logger.error(`production workflow ${threadId} failed: ${message}`);
    let state = this.pendingStates.get(threadId);
    try {
      state = (await this.getState(threadId)) ?? state;
    } catch {
      // Async start can fail before the first graph checkpoint is written.
    }
    if (!state || state.userId !== userId) {
      return;
    }

    if (state.status === 'completed' || state.status === 'cancelled') {
      try {
        await this.saveWorkflowIndex(this.view(threadId, state, userId));
      } catch (indexError) {
        this.logger.warn(
          `production workflow ${threadId} terminal index refresh failed: ${indexError instanceof Error ? indexError.message : String(indexError)}`,
        );
      }
      return;
    }

    const failedState = { ...state, status: 'failed' as const, error: message };
    try {
      await this.app.updateState(this.config(threadId), {
        status: 'failed',
        error: message,
      });
      state = (await this.getState(threadId)) ?? failedState;
    } catch {
      state = failedState;
    }
    this.pendingStates.set(threadId, state);

    try {
      const tasks = await this.tasks?.list(threadId);
      const latestByRole = new Map(
        (tasks ?? []).map((task) => [task.role, task]),
      );
      for (const task of latestByRole.values()) {
        if (!['completed', 'failed', 'cancelled'].includes(task.status)) {
          try {
            await this.tasks?.updateForRole(threadId, task.role, {
              status: 'failed',
              errorMessage: message,
            });
          } catch (taskError) {
            this.logger.warn(
              `production workflow ${threadId} task ${task.role} failure persistence failed: ${taskError instanceof Error ? taskError.message : String(taskError)}`,
            );
          }
        }
      }
    } catch (taskError) {
      this.logger.warn(
        `production workflow ${threadId} task failure persistence failed: ${taskError instanceof Error ? taskError.message : String(taskError)}`,
      );
    }

    try {
      await this.emitWorkflowState(state);
    } catch (eventError) {
      this.logger.warn(
        `production workflow ${threadId} failure event persistence failed: ${eventError instanceof Error ? eventError.message : String(eventError)}`,
      );
      let runId: string | undefined = state.runId || undefined;
      if (!runId) {
        try {
          runId = (await this.agentRuns?.findLatestByThread(threadId))?.id;
        } catch (runLookupError) {
          this.logger.warn(
            `production workflow ${threadId} run lookup failed: ${runLookupError instanceof Error ? runLookupError.message : String(runLookupError)}`,
          );
        }
      }
      if (runId) {
        try {
          await this.agentRuns?.finish(runId, {
            route: 'production_workflow',
            status: 'failed',
            errorMessage: message,
            resultSummary: `${state.projectId}：工作流失败。`,
          });
        } catch (runError) {
          this.logger.warn(
            `production workflow ${threadId} run failure persistence failed: ${runError instanceof Error ? runError.message : String(runError)}`,
          );
        }
      }
    }

    if (!state.runId) {
      try {
        const run = await this.agentRuns?.findLatestByThread(threadId);
        if (run) {
          await this.agentRuns?.finish(run.id, {
            route: 'production_workflow',
            status: 'failed',
            errorMessage: message,
            resultSummary: `${state.projectId}：工作流失败。`,
          });
        }
      } catch (runError) {
        this.logger.warn(
          `production workflow ${threadId} run failure persistence failed: ${runError instanceof Error ? runError.message : String(runError)}`,
        );
      }
    }

    try {
      await this.saveWorkflowIndex(this.view(threadId, state, userId));
    } catch (indexError) {
      this.logger.warn(
        `production workflow ${threadId} failed index refresh: ${indexError instanceof Error ? indexError.message : String(indexError)}`,
      );
    }
  }

  protected async enqueueWorkflowJob(
    job: ProductionWorkflowJob,
  ): Promise<boolean> {
    try {
      // Acknowledge only after a PostgreSQL Outbox intent is durable.
      // DomainEvents will retry BullMQ delivery on a transient Redis outage.
      if (
        this.domainEvents &&
        (this.workflowQueue?.isEnabled() || this.workflowQueue?.isRequired?.())
      ) {
        await this.domainEvents.emit({
          eventType: 'workflow.dispatch.requested',
          aggregateType: 'production_workflow',
          aggregateId: job.threadId,
          tenantId: job.tenantId,
          idempotencyKey: `workflow-dispatch:${job.id}`,
          payload: { job },
        });
        // Fast path: enqueue immediately when Redis is available. The durable
        // Outbox is still the recovery source if this call or the process fails.
        // Stable BullMQ jobId deduplicates while the job is retained.
        try {
          await this.workflowQueue?.enqueue(job);
        } catch (queueError) {
          this.logger.warn(
            `workflow ${job.threadId} fast dispatch failed; durable Outbox will retry: ${queueError instanceof Error ? queueError.message : String(queueError)}`,
          );
        }
        return true;
      }
      const queued = await this.workflowQueue?.enqueue(job);
      if (!queued && this.workflowQueue?.isRequired?.()) {
        throw new Error(
          '生产工作流要求使用 Redis 持久队列，队列不可用时拒绝进程内执行。',
        );
      }
      return queued ?? false;
    } catch (error) {
      await this.markScheduledFailure(job.threadId, job.userId, error);
      throw error;
    }
  }

  protected assertLeaseOwned(threadId: string): void {
    const signal = this.cancellationControllers.get(threadId)?.signal;
    if (signal?.aborted) throw this.cancellationError(signal.reason);
    if (this.lostLeases.has(threadId)) {
      throw new Error('production workflow lease was lost');
    }
  }

  protected cancellationError(reason: unknown): Error {
    if (reason instanceof ProductionWorkflowCancelledError) return reason;
    return reason instanceof Error
      ? reason
      : new Error('工作流取消状态检查失败，已停止继续执行。');
  }

  protected workflowCancelKey(threadId: string): string {
    return `production:workflow:cancel:${threadId}`;
  }

  protected async getOwnedState(
    threadId: string,
    userId: string,
    tenantId?: string,
  ) {
    const state = await this.getState(threadId);
    if (!state?.projectId) throw new Error('workflow not found');
    if (state.userId !== userId) throw new Error('workflow not found');
    if (!this.tenantMatches(state.tenantId, tenantId)) {
      throw new Error('workflow not found');
    }
    return state;
  }

  /** 有租户请求不能读取未绑定租户的历史状态，避免把旧的无租户数据当成当前租户数据。 */
  protected tenantMatches(
    resourceTenantId?: unknown,
    requestedTenantId?: string,
  ) {
    const requested = requestedTenantId?.trim();
    if (!requested) return true;
    const resource =
      typeof resourceTenantId === 'string' ? resourceTenantId.trim() : '';
    return Boolean(resource) && resource === requested;
  }

  protected async getState(threadId: string) {
    const snapshot = await this.app.getState(this.config(threadId));
    return snapshot?.values;
  }

  protected async runUntilSettled(
    threadId: string,
    initialState: ProductionWorkflowStateType,
    initialInput?: ProductionWorkflowStateType,
  ): Promise<ProductionWorkflowStateType> {
    let state = initialState;
    const controller = new AbortController();
    this.cancellationControllers.set(threadId, controller);
    let checkingCancellation = false;
    const checkCancellation = async () => {
      if (checkingCancellation || !this.redisProvider.isEnabled()) return;
      checkingCancellation = true;
      try {
        const marker = await this.redisProvider.getRequired(
          this.workflowCancelKey(threadId),
        );
        if (marker?.startsWith('cancelled:') && !controller.signal.aborted) {
          controller.abort(
            new ProductionWorkflowCancelledError(
              marker.slice('cancelled:'.length),
            ),
          );
        }
      } catch (error) {
        if (!controller.signal.aborted) controller.abort(error);
      } finally {
        checkingCancellation = false;
      }
    };
    const watcher = setInterval(() => void checkCancellation(), 500);
    try {
      await checkCancellation();
      if (controller.signal.aborted) {
        throw this.cancellationError(controller.signal.reason);
      }
      while (state.status === 'running') {
        this.assertLeaseOwned(threadId);
        state = await this.app.invoke(
          initialInput ?? {},
          this.config(threadId),
        );
        initialInput = undefined;
      }
      if (state.status !== 'completed' && state.status !== 'failed') {
        this.assertLeaseOwned(threadId);
      }
      return state;
    } catch (error) {
      if (error instanceof ProductionWorkflowCancelledError) {
        return this.persistWorkflowCancelled(threadId, state, error.message);
      }
      throw error;
    } finally {
      clearInterval(watcher);
      if (this.cancellationControllers.get(threadId) === controller) {
        this.cancellationControllers.delete(threadId);
      }
    }
  }

  protected async persistWorkflowCancelled(
    threadId: string,
    current: ProductionWorkflowStateType,
    reason: string,
  ): Promise<ProductionWorkflowStateType> {
    if (current.status === 'completed' || current.status === 'failed') {
      return current;
    }
    const cancelledState: ProductionWorkflowStateType = {
      ...current,
      status: 'cancelled',
      error: reason,
    };
    try {
      await this.app.updateState(this.config(threadId), {
        status: 'cancelled',
        error: reason,
      });
      current = (await this.getState(threadId)) ?? cancelledState;
    } catch {
      // 初始任务可能在首个 checkpoint 前被取消；终态初始状态不会执行工作流副作用。
      await this.app.invoke(cancelledState, this.config(threadId));
      current = (await this.getState(threadId)) ?? cancelledState;
    }
    this.pendingStates.set(threadId, current);
    try {
      for (const task of (await this.tasks?.list(threadId)) ?? []) {
        if (!['completed', 'failed', 'cancelled'].includes(task.status)) {
          try {
            await this.tasks?.updateForRole(threadId, task.role, {
              status: 'cancelled',
              errorMessage: reason,
            });
          } catch (error) {
            this.logger.warn(
              `production workflow ${threadId} task ${task.role} cancellation persistence failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    } catch (error) {
      this.logger.warn(
        `production workflow ${threadId} task cancellation lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (current.runId) {
      try {
        await this.agentRuns?.cancel(current.runId, reason);
      } catch (error) {
        this.logger.warn(
          `production workflow ${threadId} run cancellation persistence failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    await this.emitWorkflowState(current);
    await this.saveWorkflowIndexBestEffort(
      this.view(threadId, current, current.userId),
    );
    return current;
  }
}
