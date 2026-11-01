import { randomUUID } from 'node:crypto';
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
import { ProductionWorkflowExecutionBase } from './production-workflow.execution';
import { WORKFLOW_DISPATCH_REQUESTED_EVENT, parseWorkflowDispatch } from './workflow-dispatch-contract';

export abstract class ProductionWorkflowControlBase extends ProductionWorkflowExecutionBase {
  protected abstract rejectForRevision(
    threadId: string,
    current: ProductionWorkflowStateType,
    dto: ResumeProductionWorkflowDto,
    userId: string,
  ): Promise<ReturnType<ProductionWorkflowControlBase['view']>>;

  onModuleInit(): void {
    // DomainEventOutbox is the durable intent; its handler can safely be retried.
    this.domainEvents?.registerInternalHandler?.(
      WORKFLOW_DISPATCH_REQUESTED_EVENT,
      async (event) => {
        const job = parseWorkflowDispatch(event.payload, event.aggregateId, event.tenantId);
        if (!this.workflowQueue?.isEnabled()) {
          throw new Error('Workflow queue is unavailable; retain dispatch intent for retry');
        }
        const accepted = await this.workflowQueue.enqueue(job);
        if (!accepted) throw new Error('Workflow queue did not accept persisted dispatch');
      },
    );
    this.tasks?.registerRetryHandler((task) => this.dispatchRetryTask(task));
    this.workflowQueue?.registerProcessor(async (job, attempt) => {
      if (job.operation === 'retry_task') {
        try {
          await this.retryTask(job);
        } catch (error) {
          if (attempt.finalAttempt) {
            await this.tasks?.markRetryFailed(job.taskId, error);
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
        } else {
          await this.revise(
            job.threadId,
            job.dto,
            job.userId,
            job.tenantId,
            true,
          );
        }
      } catch (error) {
        if (attempt.finalAttempt) {
          await this.markScheduledFailure(job.threadId, job.userId, error);
        } else {
          this.logger.warn(
            `production workflow ${job.threadId} attempt ${attempt.attempt} failed; queue will retry`,
          );
        }
        throw error;
      }
    });
  }

  protected async dispatchRetryTask(task: {
    id: string;
    threadId: string;
    role: string;
    retryCount: number;
  }): Promise<void> {
    const state = await this.getState(task.threadId);
    if (!state?.projectId) throw new Error('workflow not found');
    if (this.workflowQueue?.isEnabled()) {
      const queued = await this.enqueueWorkflowJob({
        id: this.workflowJobId(
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
    if (this.workflowQueue?.isRequired?.()) {
      throw new Error(
        '生产工作流要求使用 Redis 持久队列，队列不可用时拒绝进程内重试。',
      );
    }
    await this.retryTask(task);
  }

  protected async retryTask(task: {
    threadId: string;
    role: string;
  }): Promise<void> {
    const state = await this.getState(task.threadId);
    if (!state?.projectId) throw new Error('workflow not found');
    const role = task.role as ProductionRole;
    if (!state.selectedRoles.includes(role)) {
      throw new Error(`task role ${task.role} is not part of the workflow`);
    }
    if (state.status === 'cancelled') {
      await this.tasks?.updateForRole(task.threadId, role, {
        status: 'cancelled',
        errorMessage: state.error || '用户取消工作流',
      });
      return;
    }
    await this.app.updateState(this.config(task.threadId), {
      status: 'running',
      currentBatch: [role],
      rerunRoles: [role],
      pendingApprovalRoles: [],
      approval: null,
      feedback: '',
      error: '',
    });
    const settled = await this.runUntilSettled(
      task.threadId,
      await this.getOwnedState(task.threadId, state.userId),
    );
    await this.traceLangfuse(settled);
    const result = this.view(task.threadId, settled, state.userId);
    await this.emitWorkflowState(settled);
    await this.saveWorkflowIndex(result);
    await this.tasks?.updateForRole(task.threadId, role, {
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
      const checkpoint = await this.getState(threadId);
      if (checkpoint?.projectId) {
        // 已存在的 Checkpoint 必须先通过 owner／tenant 校验，不能把“无权访问”
        // 当成“首次执行”并覆盖另一个用户或租户的工作流。
        const existing = await this.getOwnedState(threadId, userId, tenantId);
        if (existing.status === 'running') {
          const settled = await this.runUntilSettled(threadId, existing);
          await this.traceLangfuse(settled);
          const result = this.view(threadId, settled, userId);
          await this.emitWorkflowState(settled);
          await this.saveWorkflowIndex(result);
          return result;
        }
        return this.view(threadId, existing, userId);
      }
    }
    const initialState = await this.createInitialState(
      dto,
      userId,
      threadId,
      tenantId,
    );
    await this.ensureRun(initialState);
    await this.emitRuntimeEvent(
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
    await this.emitRuntimeEvent(
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
    await this.initializeTasks(initialState);
    const settled = await this.runUntilSettled(
      threadId,
      initialState,
      initialState,
    );
    await this.traceLangfuse(settled);
    const result = this.view(threadId, settled, userId);
    await this.emitWorkflowState(settled);
    await this.saveWorkflowIndex(result);
    return result;
  }

  async startAsync(
    dto: StartProductionWorkflowDto,
    userId: string,
    tenantId?: string,
  ) {
    const threadId = dto.threadId ?? randomUUID();
    if (dto.threadId) {
      const pending = this.pendingStates.get(threadId);
      if (pending) {
        if (
          pending.userId !== userId ||
          !this.tenantMatches(pending.tenantId, tenantId)
        ) {
          throw new Error('workflow not found');
        }
        return this.view(threadId, pending, userId);
      }
      const checkpoint = await this.getState(threadId);
      if (checkpoint?.projectId) {
        const existing = await this.getOwnedState(threadId, userId, tenantId);
        return this.view(threadId, existing, userId);
      }
    }
    const initialState = await this.createInitialState(
      dto,
      userId,
      threadId,
      tenantId,
    );
    await this.ensureRun(initialState);
    // 任务计划是工作流的业务记录，必须先落库再入队，避免 API 与 Worker 并发创建两份计划。
    await this.initializeTasks(initialState);
    this.pendingStates.set(threadId, initialState);
    await this.saveWorkflowIndexBestEffort(
      this.view(threadId, initialState, userId),
    );
    const queued = await this.enqueueWorkflowJob({
      id: this.workflowJobId('start', threadId),
      operation: 'start',
      threadId,
      userId,
      tenantId,
      dto: { ...dto, threadId },
    });
    if (!queued && !this.workflowQueue?.isRequired?.()) {
      this.schedule(threadId, userId, () =>
        this.start({ ...dto, threadId }, userId, tenantId),
      );
    }
    return this.view(threadId, initialState, userId);
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
    const current = await this.getOwnedState(threadId, userId, tenantId);
    await this.ensureRun(current);
    if (current.approval === 'rejected' && dto.approval !== 'rejected') {
      throw new Error('a rejected approval is awaiting persistence');
    }
    if (dto.approval === 'rejected' && current.status === 'revision_required') {
      return this.rejectForRevision(threadId, current, dto, userId);
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
        const settled = await this.runUntilSettled(threadId, current);
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
            ? await this.runUntilSettled(threadId, current)
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
      return this.rejectForRevision(threadId, current, dto, userId);
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
    const state = await this.app.invoke(
      {
        approval: dto.approval,
        feedback: dto.feedback?.trim() ?? '',
        rerunRoles: dto.rerunRoles ?? [],
      },
      this.config(threadId),
    );
    const settled = await this.runUntilSettled(threadId, state);
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
    const current = await this.getOwnedState(threadId, userId, tenantId);
    await this.ensureRun(current);
    if (current.status !== 'pending_approval') {
      if (
        dto.approval === 'rejected' &&
        current.status === 'revision_required'
      ) {
        return this.rejectForRevision(threadId, current, dto, userId);
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
    this.pendingStates.set(threadId, pending);
    await this.saveWorkflowIndexBestEffort(
      this.view(threadId, pending, userId),
    );
    const queuedJob: ResumeWorkflowJobWithCheckpoint = {
      id: this.workflowJobId(
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
    const queued = await this.enqueueWorkflowJob(queuedJob);
    if (!queued && !this.workflowQueue?.isRequired?.()) {
      this.schedule(threadId, userId, () =>
        this.resume(threadId, dto, userId, tenantId),
      );
    }
    return this.view(threadId, pending, userId);
  }

  protected captureApprovalCheckpointIdentity(
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

  protected matchesApprovalCheckpoint(
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

  protected approvalCheckpointHasAdvanced(
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

  protected approvalCheckpointIsRunningInPlace(
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

  protected sameRoles(
    left: ProductionRole[],
    right: ProductionRole[],
  ): boolean {
    return (
      left.length === right.length &&
      left.every((role, index) => role === right[index])
    );
  }

  protected async finalizeApprovedCheckpoint(
    threadId: string,
    state: ProductionWorkflowStateType,
    dto: ResumeProductionWorkflowDto,
    userId: string,
    identity?: WorkflowApprovalCheckpointIdentity,
    resumedFromCheckpoint = false,
  ) {
    await this.traceLangfuse(state);
    const result = this.view(threadId, state, userId);
    await this.emitRuntimeEvent(state, 'approval.approved', 'human_reviewer', {
      feedback: dto.feedback?.trim() ?? '',
      rerunRoles: dto.rerunRoles ?? [],
      ...(identity ? { approvedBatchIndex: identity.batchIndex } : {}),
      ...(resumedFromCheckpoint ? { resumedFromCheckpoint: true } : {}),
    });
    await this.emitWorkflowState(state);
    await this.saveWorkflowIndex(result);
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
    const current = await this.getOwnedState(threadId, userId, tenantId);
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
      const revisionHistory = this.withRevisionPackage(
        current.revisionHistory ?? [],
        supplementalMaterials,
        requested,
      );
      await this.app.updateState(this.config(threadId), {
        status: 'running',
        rerunRoles: requested,
        pendingApprovalRoles: [],
        approval: null,
        supplementalMaterials,
        revisionHistory,
        error: '',
      });
      state = await this.getOwnedState(threadId, userId, tenantId);
      await this.emitRuntimeEvent(state, 'revision.started', 'human_reviewer', {
        revision: state.revisionNumber ?? 1,
        rerunRoles: requested,
        feedback: state.feedback,
        supplementalMaterialsLength: supplementalMaterials.length,
      });
    }
    const settled = await this.runUntilSettled(threadId, state);
    await this.traceLangfuse(settled);
    const result = this.view(threadId, settled, userId);
    await this.emitWorkflowState(settled);
    await this.saveWorkflowIndex(result);
    return result;
  }

  async reviseAsync(
    threadId: string,
    dto: ReviseProductionWorkflowDto,
    userId: string,
    tenantId?: string,
  ) {
    const current = await this.getOwnedState(threadId, userId, tenantId);
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
    this.pendingStates.set(threadId, pending);
    await this.saveWorkflowIndexBestEffort(
      this.view(threadId, pending, userId),
    );
    const queued = await this.enqueueWorkflowJob({
      id: this.workflowJobId(
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
    if (!queued && !this.workflowQueue?.isRequired?.()) {
      this.schedule(threadId, userId, () =>
        this.revise(threadId, dto, userId, tenantId),
      );
    }
    return this.view(threadId, pending, userId);
  }

  async cancel(
    threadId: string,
    userId: string,
    tenantId?: string,
    reason = '用户取消工作流',
  ) {
    let state: ProductionWorkflowStateType;
    try {
      state = await this.getOwnedState(threadId, userId, tenantId);
    } catch (error) {
      const pending = this.pendingStates.get(threadId);
      if (
        !pending ||
        pending.userId !== userId ||
        !this.tenantMatches(pending.tenantId, tenantId)
      ) {
        throw error;
      }
      state = pending;
    }
    if (['completed', 'failed', 'cancelled'].includes(state.status)) {
      return this.view(threadId, state, userId);
    }

    const cancelReason = reason.trim().slice(0, 500) || '用户取消工作流';
    const markerKey = this.workflowCancelKey(threadId);
    if (this.redisProvider.isEnabled()) {
      await this.redisProvider.setRequiredOrThrow(
        markerKey,
        `cancelled:${cancelReason}`,
        WORKFLOW_CANCEL_MARKER_TTL_SECONDS,
      );
    } else if (
      this.configService?.get<boolean>('core.requireDependencies') === true ||
      this.configService?.get<string>('nodeEnv') === 'production'
    ) {
      throw new Error('取消标记无法持久化，工作流状态未更改。');
    } else if (
      state.status === 'running' &&
      !this.cancellationControllers.has(threadId)
    ) {
      throw new Error(
        '工作流正在其他执行器中运行，Redis 不可用时无法安全取消。',
      );
    }

    this.cancellationControllers
      .get(threadId)
      ?.abort(new ProductionWorkflowCancelledError(cancelReason));

    if (state.status !== 'running') {
      state = await this.persistWorkflowCancelled(
        threadId,
        state,
        cancelReason,
      );
    }
    return {
      ...this.view(threadId, state, userId),
      cancellationRequested: state.status !== 'cancelled',
    };
  }
}
