import type { ProductionWorkflowContext } from './production-workflow.context';
import { createHash, randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { normalizeProductionRoles } from './production-workflow.plan';
import {
  ProductionRole,
  ProductionWorkflowStateType,
} from './production-workflow.state';
import {
  ResumeProductionWorkflowDto,
  ReviseProductionWorkflowDto,
  StartProductionWorkflowDto,
} from './production-workflow.dto';
import {
  ProductionWorkflowCancelledError,
  ResumeWorkflowJobWithCheckpoint,
  WorkflowApprovalCheckpointIdentity,
  WORKFLOW_CANCEL_MARKER_TTL_SECONDS,
} from './production-workflow.shared';
import {
  WORKFLOW_DISPATCH_REQUESTED_EVENT,
  parseWorkflowDispatch,
} from './workflow-dispatch-contract';

export class ProductionWorkflowControl {
  readonly context: ProductionWorkflowContext;

  constructor(context: ProductionWorkflowContext) {
    this.context = context;
  }

  startRequestIdentity(
    dto: StartProductionWorkflowDto,
    userId: string,
    tenantId?: string,
  ): { key: string; requestHash: string } {
    const requestId = dto.requestId ?? randomUUID();
    const key = `workflow-start:${createHash('sha256')
      .update(JSON.stringify([tenantId?.trim() || 'legacy', userId, requestId]))
      .digest('hex')}`;
    const requestHash = createHash('sha256')
      .update(JSON.stringify({
        threadId: dto.threadId ?? null,
        projectId: dto.projectId.trim(),
        brief: dto.brief.trim(),
        roles: normalizeProductionRoles(dto.roles),
        processType: dto.processType ?? 'sequential',
        maxSteps: dto.maxSteps ?? 18,
        approvalMode: dto.approvalMode ?? 'auto',
        approvalRoles: normalizeProductionRoles(dto.approvalRoles).filter((role) => dto.approvalRoles?.includes(role)),
        riskApprovalThreshold: dto.riskApprovalThreshold ?? 'high',
        pluginKeys: [...(dto.pluginKeys ?? [])].sort(),
      }))
      .digest('hex');
    return { key, requestHash };
  }

  async viewAcceptedRequest(
    key: string,
    requestHash: string,
    userId: string,
    tenantId?: string,
  ) {
    const event = await this.context.domainEvents?.findByIdempotencyKey(key);
    if (!event) return null;
    const payload = JSON.parse(event.payload) as {
      job?: { dto?: StartProductionWorkflowDto; threadId?: string; userId?: string };
      requestHash?: string;
    };
    if (!payload.job?.dto || payload.requestHash !== requestHash || payload.job.userId !== userId) {
      throw new ConflictException('requestId 已被不同的启动参数使用');
    }
    const threadId = event.aggregateId;
    const existing = await this.context.state.getState(threadId);
    if (existing?.projectId) {
      const owned = await this.context.state.getOwnedState(threadId, userId, tenantId);
      return this.context.events.view(threadId, owned, userId);
    }
    const pending = this.context.pendingStates.get(threadId) ??
      await this.context.state.createInitialState(
        payload.job.dto, userId, threadId, tenantId,
      );
    return this.context.events.view(threadId, pending, userId);
  }
  onModuleInit(): void {
    this.context.domainEvents?.registerInternalHandler?.(
      'workflow.approval.notify',
      async (event) => {
        const payload = JSON.parse(event.payload) as {
          threadId: string;
          projectId: string;
          brief: string;
          completedRoles: string[];
          pendingApprovalRoles: string[];
        };
        await this.context.dingTalk?.notifyApproval(payload);
      },
    );
    const approvalReconciler = setInterval(
      () => void this.reconcileApprovalNotifications(),
      30_000,
    );
    approvalReconciler.unref();
    void this.reconcileApprovalNotifications();
    // DomainEventOutbox is the durable intent; its handler can safely be retried.
    this.context.domainEvents?.registerInternalHandler?.(
      WORKFLOW_DISPATCH_REQUESTED_EVENT,
      async (event) => {
        const job = parseWorkflowDispatch(
          event.payload,
          event.aggregateId,
          event.tenantId,
        );
        if (!this.context.workflowQueue?.isEnabled()) {
          throw new Error(
            'Workflow queue is unavailable; retain dispatch intent for retry',
          );
        }
        const accepted = await this.context.workflowQueue.enqueue(job);
        if (!accepted)
          throw new Error('Workflow queue did not accept persisted dispatch');
      },
    );
    this.context.tasks?.registerRetryHandler((task) =>
      this.dispatchRetryTask(task),
    );
    this.context.workflowQueue?.registerProcessor(async (job, attempt) => {
      if (job.operation === 'retry_task') {
        try {
          await this.retryTask(job);
        } catch (error) {
          if (attempt.finalAttempt) {
            await this.context.tasks?.markRetryFailed(job.taskId, error);
          }
          throw error;
        }
        return;
      }
      try {
        if (job.operation === 'start') {
          await this.start(
            { ...job.dto, threadId: job.threadId },
            job.userId,
            job.tenantId,
          );
        } else if (job.operation === 'resume') {
          const approvalCheckpointIdentity = (
            job as typeof job & {
              approvalCheckpointIdentity?: WorkflowApprovalCheckpointIdentity;
            }
          ).approvalCheckpointIdentity;
          await this.resume(
            job.threadId,
            job.dto,
            job.userId,
            job.tenantId,
            true,
            approvalCheckpointIdentity,
            attempt.attempt,
          );
        } else if (job.operation === 'revise') {
          await this.revise(
            job.threadId,
            job.dto,
            job.userId,
            job.tenantId,
            true,
          );
        } else {
          throw new Error('coding_task jobs must use the coding task processor');
        }
      } catch (error) {
        if (attempt.finalAttempt) {
          await this.context.state.markScheduledFailure(
            job.threadId,
            job.userId,
            error,
          );
        } else {
          this.context.logger.warn(
            `production workflow ${job.threadId} attempt ${attempt.attempt} failed; queue will retry`,
          );
        }
        throw error;
      }
    });
  }

  async ensureApprovalNotificationIntent(
    state: ProductionWorkflowStateType,
  ): Promise<void> {
    if (state.status !== 'pending_approval' || !this.context.domainEvents) return;
    const identity = createHash('sha256')
      .update(JSON.stringify([
        state.threadId,
        state.revisionNumber ?? 1,
        state.batchIndex,
        state.stepCount,
        state.pendingApprovalRoles,
      ]))
      .digest('hex');
    await this.context.domainEvents.emit({
      eventType: 'workflow.approval.notify',
      aggregateType: 'production_workflow',
      aggregateId: state.threadId,
      tenantId: state.tenantId,
      idempotencyKey: `workflow-approval:${identity}`,
      payload: {
        threadId: state.threadId,
        projectId: state.projectId,
        brief: state.brief,
        completedRoles: state.completedRoles,
        pendingApprovalRoles: state.pendingApprovalRoles,
        revision: state.revisionNumber ?? 1,
        batchIndex: state.batchIndex,
        checkpoint: state.stepCount,
      },
    });
  }

  async reconcileApprovalNotifications(): Promise<void> {
    if (!this.context.agentRuns || !this.context.domainEvents) return;
    try {
      const runs = await this.context.agentRuns.listActiveProductionWorkflows();
      for (const run of runs) {
        try {
          const state = await this.context.state.getState(run.threadId);
          if (state?.status === 'pending_approval') {
            await this.ensureApprovalNotificationIntent(state);
          }
        } catch (error) {
          this.context.logger.warn(
            `workflow ${run.threadId} approval reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } catch (error) {
      this.context.logger.warn(
        `workflow approval reconciliation skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async dispatchRetryTask(task: {
    id: string;
    threadId: string;
    role: string;
    retryCount: number;
  }): Promise<void> {
    const state = await this.context.state.getState(task.threadId);
    if (!state?.projectId) throw new Error('workflow not found');
    if (this.context.workflowQueue?.isEnabled()) {
      const queued = await this.context.state.enqueueWorkflowJob({
        id: this.context.state.workflowJobId(
          'retry_task',
          task.threadId,
          `${task.id}-${task.retryCount}`,
        ),
        operation: 'retry_task',
        threadId: task.threadId,
        userId: state.userId,
        tenantId: state.tenantId,
        taskId: task.id,
        role: task.role,
      });
      if (queued) return;
    }
    if (this.context.workflowQueue?.isRequired?.()) {
      throw new Error(
        '生产工作流要求使用 Redis 持久队列，队列不可用时拒绝进程内重试。',
      );
    }
    await this.retryTask(task);
  }

  async retryTask(task: { threadId: string; role: string }): Promise<void> {
    const state = await this.context.state.getState(task.threadId);
    if (!state?.projectId) throw new Error('workflow not found');
    const role = task.role as ProductionRole;
    if (!state.selectedRoles.includes(role)) {
      throw new Error(`task role ${task.role} is not part of the workflow`);
    }
    if (state.status === 'cancelled') {
      await this.context.tasks?.updateForRole(task.threadId, role, {
        status: 'cancelled',
        errorMessage: state.error || '用户取消工作流',
      });
      return;
    }
    await this.context.app.updateState(
      this.context.events.config(task.threadId),
      {
        status: 'running',
        currentBatch: [role],
        rerunRoles: [role],
        pendingApprovalRoles: [],
        approval: null,
        feedback: '',
        error: '',
      },
    );
    const settled = await this.context.state.runUntilSettled(
      task.threadId,
      await this.context.state.getOwnedState(task.threadId, state.userId),
    );
    await this.context.events.traceLangfuse(settled);
    const result = this.context.events.view(
      task.threadId,
      settled,
      state.userId,
    );
    await this.context.events.emitWorkflowState(settled);
    await this.context.events.saveWorkflowIndex(result);
    await this.context.tasks?.updateForRole(task.threadId, role, {
      status:
        settled.status === 'completed'
          ? 'completed'
          : settled.status === 'cancelled'
            ? 'cancelled'
            : 'failed',
      summary: settled.results[role]?.summary ?? settled.error,
      errorMessage: settled.status === 'completed' ? undefined : settled.error,
      outputArtifactId: settled.results[role]?.generatedArtifact?.id,
    });
  }

  /** 创建初始状态并同步执行首轮工作流；异步入口复用相同状态创建逻辑。 */
  async start(
    dto: StartProductionWorkflowDto,
    userId: string,
    tenantId?: string,
  ) {
    const threadId = dto.threadId ?? randomUUID();
    // BullMQ 重试或 Worker 接管时不能从零覆盖已有 Checkpoint；正在运行的
    // 工作流从最后持久化状态继续，其他终态直接返回当前视图。
    if (dto.threadId) {
      const checkpoint = await this.context.state.getState(threadId);
      if (checkpoint?.projectId) {
        // 已存在的 Checkpoint 必须先通过 owner／tenant 校验，不能把“无权访问”
        // 当成“首次执行”并覆盖另一个用户或租户的工作流。
        const existing = await this.context.state.getOwnedState(
          threadId,
          userId,
          tenantId,
        );
        if (existing.status === 'running') {
          const settled = await this.context.state.runUntilSettled(
            threadId,
            existing,
          );
          await this.context.events.traceLangfuse(settled);
          const result = this.context.events.view(threadId, settled, userId);
          await this.context.events.emitWorkflowState(settled);
          await this.context.events.saveWorkflowIndex(result);
          return result;
        }
        await this.ensureApprovalNotificationIntent(existing);
        return this.context.events.view(threadId, existing, userId);
      }
    }
    const initialState = await this.context.state.createInitialState(
      dto,
      userId,
      threadId,
      tenantId,
    );
    await this.context.state.ensureRun(initialState);
    await this.context.events.emitRuntimeEvent(
      initialState,
      'workflow.started',
      'production_workflow',
      {
        projectId: initialState.projectId,
        selectedRoles: initialState.selectedRoles,
        processType: initialState.processType,
        pluginKeys: initialState.pluginKeys,
        pluginTools: initialState.pluginTools,
      },
    );
    await this.context.events.emitRuntimeEvent(
      initialState,
      'goal.active',
      'production_workflow',
      {
        objective: initialState.brief,
        status: 'active',
        round: 1,
        maxRounds: initialState.maxSteps,
      },
    );
    await this.context.state.initializeTasks(initialState);
    const settled = await this.context.state.runUntilSettled(
      threadId,
      initialState,
      initialState,
    );
    await this.context.events.traceLangfuse(settled);
    const result = this.context.events.view(threadId, settled, userId);
    await this.context.events.emitWorkflowState(settled);
    await this.context.events.saveWorkflowIndex(result);
    return result;
  }

  async startAsync(
    dto: StartProductionWorkflowDto,
    userId: string,
    tenantId?: string,
  ) {
    const { key, requestHash } = this.startRequestIdentity(dto, userId, tenantId);
    if (dto.requestId && this.context.domainEvents) {
      const accepted = await this.viewAcceptedRequest(key, requestHash, userId, tenantId);
      if (accepted) return accepted;
    }
    const threadId = dto.threadId ?? randomUUID();
    if (dto.threadId) {
      const pending = this.context.pendingStates.get(threadId);
      if (pending) {
        if (
          pending.userId !== userId ||
          !this.context.state.tenantMatches(pending.tenantId, tenantId)
        ) {
          throw new Error('workflow not found');
        }
        return this.context.events.view(threadId, pending, userId);
      }
      const checkpoint = await this.context.state.getState(threadId);
      if (checkpoint?.projectId) {
        const existing = await this.context.state.getOwnedState(
          threadId,
          userId,
          tenantId,
        );
        return this.context.events.view(threadId, existing, userId);
      }
    }
    const initialState = await this.context.state.createInitialState(
      dto,
      userId,
      threadId,
      tenantId,
    );
    const job = {
      id: this.context.state.workflowJobId('start', threadId),
      operation: 'start' as const,
      threadId,
      userId,
      tenantId,
      dto: { ...dto, threadId },
    };
    const transactional = Boolean(
      this.context.domainEvents &&
      this.context.agentRuns &&
      this.context.tasks,
    );
    if (transactional) {
      try {
        await this.context.domainEvents!.transaction((manager) =>
          this.context.state.createAcceptedRecords(
            manager, initialState, job, key, requestHash,
          ),
        );
      } catch (error) {
        const accepted = await this.viewAcceptedRequest(key, requestHash, userId, tenantId);
        if (accepted) return accepted;
        throw error;
      }
    } else {
      await this.context.state.ensureRun(initialState);
      await this.context.state.initializeTasks(initialState);
    }
    if (transactional) {
      try {
        await this.context.state.ensureRun(initialState);
        await this.context.state.initializeTasks(initialState);
      } catch (error) {
        this.context.logger.warn(
          `workflow ${threadId} accepted; post-commit event repair pending: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    this.context.pendingStates.set(threadId, initialState);
    await this.context.events.saveWorkflowIndexBestEffort(
      this.context.events.view(threadId, initialState, userId),
    );
    const queued = await this.context.state.enqueueWorkflowJob(job, transactional);
    if ((!queued || this.context.workflowQueue?.isEnabled?.() === false) && !this.context.workflowQueue?.isRequired?.()) {
      this.context.state.schedule(threadId, userId, () =>
        this.start({ ...dto, threadId }, userId, tenantId),
      );
    }
    return this.context.events.view(threadId, initialState, userId);
  }

  async resume(
    threadId: string,
    dto: ResumeProductionWorkflowDto,
    userId: string,
    tenantId?: string,
    allowCheckpointRecovery = false,
    approvalCheckpointIdentity?: WorkflowApprovalCheckpointIdentity,
    queueAttempt = 1,
  ) {
    const current = await this.context.state.getOwnedState(
      threadId,
      userId,
      tenantId,
    );
    await this.context.state.ensureRun(current);
    if (current.approval === 'rejected' && dto.approval !== 'rejected') {
      throw new Error('a rejected approval is awaiting persistence');
    }
    if (dto.approval === 'rejected' && current.status === 'revision_required') {
      return this.context.revision.rejectForRevision(
        threadId,
        current,
        dto,
        userId,
      );
    }
    if (allowCheckpointRecovery && dto.approval === 'approved') {
      if (!approvalCheckpointIdentity && queueAttempt > 1) {
        throw new Error('审批重试任务缺少原始检查点身份，拒绝重新应用审批。');
      }
      if (
        approvalCheckpointIdentity &&
        queueAttempt > 1 &&
        this.approvalCheckpointIsRunningInPlace(
          current,
          approvalCheckpointIdentity,
        )
      ) {
        // Approval was consumed, but its batch has not advanced yet. Resume
        // the existing running checkpoint without invoking the approval again.
        const settled = await this.context.state.runUntilSettled(
          threadId,
          current,
        );
        return this.finalizeApprovedCheckpoint(
          threadId,
          settled,
          dto,
          userId,
          approvalCheckpointIdentity,
          true,
        );
      }
      if (
        approvalCheckpointIdentity &&
        this.approvalCheckpointHasAdvanced(current, approvalCheckpointIdentity)
      ) {
        // The original approval already advanced the workflow. If it reached a
        // later pending_approval, only finish the old job's bookkeeping; never
        // apply its approval to the newer batch.
        const settled =
          current.status === 'running' &&
          current.revisionNumber === approvalCheckpointIdentity.revisionNumber
            ? await this.context.state.runUntilSettled(threadId, current)
            : current;
        return this.finalizeApprovedCheckpoint(
          threadId,
          settled,
          dto,
          userId,
          approvalCheckpointIdentity,
          true,
        );
      }
      if (
        approvalCheckpointIdentity &&
        current.status === 'pending_approval' &&
        !this.matchesApprovalCheckpoint(current, approvalCheckpointIdentity)
      ) {
        throw new Error('审批任务与当前待审批批次不匹配，拒绝应用旧审批。');
      }
    }
    if (current.status !== 'pending_approval') {
      throw new Error(`workflow is not pending approval: ${current.status}`);
    }
    if (dto.approval === 'rejected') {
      if (
        approvalCheckpointIdentity &&
        !this.matchesApprovalCheckpoint(current, approvalCheckpointIdentity)
      ) {
        throw new Error('驳回请求与当前待审批批次不匹配。');
      }
      return this.context.revision.rejectForRevision(
        threadId,
        current,
        dto,
        userId,
      );
    }
    if (
      approvalCheckpointIdentity &&
      !this.matchesApprovalCheckpoint(current, approvalCheckpointIdentity)
    ) {
      throw new Error('审批请求与当前待审批批次不匹配。');
    }
    if (
      allowCheckpointRecovery &&
      queueAttempt > 1 &&
      !approvalCheckpointIdentity
    ) {
      throw new Error('审批重试任务缺少原始检查点身份，拒绝应用审批。');
    }
    const state = await this.context.app.invoke(
      {
        approval: dto.approval,
        feedback: dto.feedback?.trim() ?? '',
        rerunRoles: dto.rerunRoles ?? [],
      },
      this.context.events.config(threadId),
    );
    const settled = await this.context.state.runUntilSettled(threadId, state);
    return this.finalizeApprovedCheckpoint(
      threadId,
      settled,
      dto,
      userId,
      approvalCheckpointIdentity,
      false,
    );
  }

  async resumeAsync(
    threadId: string,
    dto: ResumeProductionWorkflowDto,
    userId: string,
    tenantId?: string,
  ) {
    const current = await this.context.state.getOwnedState(
      threadId,
      userId,
      tenantId,
    );
    await this.context.state.ensureRun(current);
    if (current.status !== 'pending_approval') {
      if (
        dto.approval === 'rejected' &&
        current.status === 'revision_required'
      ) {
        return this.context.revision.rejectForRevision(
          threadId,
          current,
          dto,
          userId,
        );
      }
      throw new Error(`workflow is not pending approval: ${current.status}`);
    }
    if (dto.approval === 'rejected') {
      return this.resume(threadId, dto, userId, tenantId);
    }
    const pending = {
      ...current,
      status: 'running' as const,
      approval: dto.approval,
      feedback: dto.feedback?.trim() ?? '',
      rerunRoles: dto.rerunRoles ?? [],
    };
    this.context.pendingStates.set(threadId, pending);
    await this.context.events.saveWorkflowIndexBestEffort(
      this.context.events.view(threadId, pending, userId),
    );
    const queuedJob: ResumeWorkflowJobWithCheckpoint = {
      id: this.context.state.workflowJobId(
        'resume',
        threadId,
        `${current.stepCount}-${current.batchIndex}`,
      ),
      operation: 'resume',
      threadId,
      userId,
      tenantId,
      dto,
      approvalCheckpointIdentity:
        this.captureApprovalCheckpointIdentity(current),
    };
    const queued = await this.context.state.enqueueWorkflowJob(queuedJob);
    if (!queued && !this.context.workflowQueue?.isRequired?.()) {
      this.context.state.schedule(threadId, userId, () =>
        this.resume(threadId, dto, userId, tenantId),
      );
    }
    return this.context.events.view(threadId, pending, userId);
  }

  captureApprovalCheckpointIdentity(
    state: ProductionWorkflowStateType,
  ): WorkflowApprovalCheckpointIdentity {
    return {
      runId: state.runId,
      batchIndex: state.batchIndex,
      stepCount: state.stepCount,
      revisionNumber: state.revisionNumber ?? 1,
      currentBatch: [...state.currentBatch],
      pendingApprovalRoles: [...state.pendingApprovalRoles],
    };
  }

  matchesApprovalCheckpoint(
    state: ProductionWorkflowStateType,
    identity: WorkflowApprovalCheckpointIdentity,
  ): boolean {
    return (
      state.runId === identity.runId &&
      state.batchIndex === identity.batchIndex &&
      state.stepCount === identity.stepCount &&
      (state.revisionNumber ?? 1) === identity.revisionNumber &&
      this.sameRoles(state.currentBatch, identity.currentBatch) &&
      this.sameRoles(state.pendingApprovalRoles, identity.pendingApprovalRoles)
    );
  }

  approvalCheckpointHasAdvanced(
    state: ProductionWorkflowStateType,
    identity: WorkflowApprovalCheckpointIdentity,
  ): boolean {
    if (
      state.runId !== identity.runId ||
      !identity.currentBatch.every((role) =>
        state.completedRoles.includes(role),
      )
    ) {
      return false;
    }
    if ((state.revisionNumber ?? 1) > identity.revisionNumber) return true;
    return (
      (state.revisionNumber ?? 1) === identity.revisionNumber &&
      state.batchIndex > identity.batchIndex &&
      state.stepCount > identity.stepCount
    );
  }

  approvalCheckpointIsRunningInPlace(
    state: ProductionWorkflowStateType,
    identity: WorkflowApprovalCheckpointIdentity,
  ): boolean {
    return (
      state.status === 'running' &&
      state.approval === null &&
      state.runId === identity.runId &&
      (state.revisionNumber ?? 1) === identity.revisionNumber &&
      state.batchIndex === identity.batchIndex &&
      state.stepCount > identity.stepCount &&
      this.sameRoles(state.currentBatch, identity.currentBatch) &&
      state.pendingApprovalRoles.length === 0 &&
      state.rerunRoles.length === 0 &&
      identity.currentBatch.some((role) => !state.completedRoles.includes(role))
    );
  }

  sameRoles(left: ProductionRole[], right: ProductionRole[]): boolean {
    return (
      left.length === right.length &&
      left.every((role, index) => role === right[index])
    );
  }

  async finalizeApprovedCheckpoint(
    threadId: string,
    state: ProductionWorkflowStateType,
    dto: ResumeProductionWorkflowDto,
    userId: string,
    identity?: WorkflowApprovalCheckpointIdentity,
    resumedFromCheckpoint = false,
  ) {
    await this.context.events.traceLangfuse(state);
    const result = this.context.events.view(threadId, state, userId);
    await this.context.events.emitRuntimeEvent(
      state,
      'approval.approved',
      'human_reviewer',
      {
        feedback: dto.feedback?.trim() ?? '',
        rerunRoles: dto.rerunRoles ?? [],
        ...(identity ? { approvedBatchIndex: identity.batchIndex } : {}),
        ...(resumedFromCheckpoint ? { resumedFromCheckpoint: true } : {}),
      },
    );
    await this.context.events.emitWorkflowState(state);
    await this.context.events.saveWorkflowIndex(result);
    return result;
  }

  /**
   * 驳回后只让被指定岗位及其下游失效；保留原 Artifact 与审核意见，
   * 避免把一次局部修订误当成全流程重新生成。
   */
  async revise(
    threadId: string,
    dto: ReviseProductionWorkflowDto,
    userId: string,
    tenantId?: string,
    allowCheckpointRecovery = false,
  ) {
    const current = await this.context.state.getOwnedState(
      threadId,
      userId,
      tenantId,
    );
    const recoveringRunningRevision =
      allowCheckpointRecovery &&
      current.status === 'running' &&
      current.revisionNumber > 1 &&
      current.rerunRoles.length > 0 &&
      current.supplementalMaterials ===
        (dto.supplementalMaterials?.trim() ?? current.supplementalMaterials);
    if (current.status !== 'revision_required' && !recoveringRunningRevision) {
      throw new Error(`workflow does not require revision: ${current.status}`);
    }
    let state = current;
    if (!recoveringRunningRevision) {
      const allowed = current.rerunRoles.length
        ? current.rerunRoles
        : current.currentBatch;
      const requested = dto.rerunRoles?.length
        ? dto.rerunRoles.filter((role) => allowed.includes(role))
        : allowed;
      if (!requested.length)
        throw new Error('at least one rejected role must be revised');
      const supplementalMaterials =
        dto.supplementalMaterials?.trim() ??
        current.supplementalMaterials ??
        '';
      const revisionHistory = this.context.events.withRevisionPackage(
        current.revisionHistory ?? [],
        supplementalMaterials,
        requested,
      );
      await this.context.app.updateState(this.context.events.config(threadId), {
        status: 'running',
        rerunRoles: requested,
        pendingApprovalRoles: [],
        approval: null,
        supplementalMaterials,
        revisionHistory,
        error: '',
      });
      state = await this.context.state.getOwnedState(
        threadId,
        userId,
        tenantId,
      );
      await this.context.events.emitRuntimeEvent(
        state,
        'revision.started',
        'human_reviewer',
        {
          revision: state.revisionNumber ?? 1,
          rerunRoles: requested,
          feedback: state.feedback,
          supplementalMaterialsLength: supplementalMaterials.length,
        },
      );
    }
    const settled = await this.context.state.runUntilSettled(threadId, state);
    await this.context.events.traceLangfuse(settled);
    const result = this.context.events.view(threadId, settled, userId);
    await this.context.events.emitWorkflowState(settled);
    await this.context.events.saveWorkflowIndex(result);
    return result;
  }

  async reviseAsync(
    threadId: string,
    dto: ReviseProductionWorkflowDto,
    userId: string,
    tenantId?: string,
  ) {
    const current = await this.context.state.getOwnedState(
      threadId,
      userId,
      tenantId,
    );
    if (current.status !== 'revision_required') {
      throw new Error(`workflow does not require revision: ${current.status}`);
    }
    const allowed = current.rerunRoles.length
      ? current.rerunRoles
      : current.currentBatch;
    const requested = dto.rerunRoles?.length
      ? dto.rerunRoles.filter((role) => allowed.includes(role))
      : allowed;
    if (!requested.length)
      throw new Error('at least one rejected role must be revised');
    const supplementalMaterials =
      dto.supplementalMaterials?.trim() ?? current.supplementalMaterials ?? '';
    const pending = {
      ...current,
      status: 'running' as const,
      rerunRoles: requested,
      pendingApprovalRoles: [],
      supplementalMaterials,
    };
    this.context.pendingStates.set(threadId, pending);
    await this.context.events.saveWorkflowIndexBestEffort(
      this.context.events.view(threadId, pending, userId),
    );
    const queued = await this.context.state.enqueueWorkflowJob({
      id: this.context.state.workflowJobId(
        'revise',
        threadId,
        `${current.revisionNumber}-${requested.join(',')}`,
      ),
      operation: 'revise',
      threadId,
      userId,
      tenantId,
      dto,
    });
    if (!queued && !this.context.workflowQueue?.isRequired?.()) {
      this.context.state.schedule(threadId, userId, () =>
        this.revise(threadId, dto, userId, tenantId),
      );
    }
    return this.context.events.view(threadId, pending, userId);
  }

  async cancel(
    threadId: string,
    userId: string,
    tenantId?: string,
    reason = '用户取消工作流',
  ) {
    let state: ProductionWorkflowStateType;
    try {
      state = await this.context.state.getOwnedState(
        threadId,
        userId,
        tenantId,
      );
    } catch (error) {
      const pending = this.context.pendingStates.get(threadId);
      if (
        !pending ||
        pending.userId !== userId ||
        !this.context.state.tenantMatches(pending.tenantId, tenantId)
      ) {
        throw error;
      }
      state = pending;
    }
    if (['completed', 'failed', 'cancelled'].includes(state.status)) {
      return this.context.events.view(threadId, state, userId);
    }

    const cancelReason = reason.trim().slice(0, 500) || '用户取消工作流';
    const markerKey = this.context.state.workflowCancelKey(threadId);
    if (this.context.redisProvider.isEnabled()) {
      await this.context.redisProvider.setRequiredOrThrow(
        markerKey,
        `cancelled:${cancelReason}`,
        WORKFLOW_CANCEL_MARKER_TTL_SECONDS,
      );
    } else if (
      this.context.configService?.get<boolean>('core.requireDependencies') ===
        true ||
      this.context.configService?.get<string>('nodeEnv') === 'production'
    ) {
      throw new Error('取消标记无法持久化，工作流状态未更改。');
    } else if (
      state.status === 'running' &&
      !this.context.cancellationControllers.has(threadId)
    ) {
      throw new Error(
        '工作流正在其他执行器中运行，Redis 不可用时无法安全取消。',
      );
    }

    this.context.cancellationControllers
      .get(threadId)
      ?.abort(new ProductionWorkflowCancelledError(cancelReason));

    if (state.status !== 'running') {
      state = await this.context.state.persistWorkflowCancelled(
        threadId,
        state,
        cancelReason,
      );
    }
    return {
      ...this.context.events.view(threadId, state, userId),
      cancellationRequested: state.status !== 'cancelled',
    };
  }
}
