import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AgentRunEntity } from '../../providers/db/entities/agent-run.entity';
import { AgentTaskEntity } from '../../providers/db/entities/agent-task.entity';
import { AgentRuntimeEventsService } from '../agent-runtime-events/agent-runtime-events.service';
import { AgentRunsService } from '../agent-runs/agent-runs.service';
import { AgentLoopResumeError } from '../agent-loop/agent-loop.types';
import { AgentTasksService } from '../agent-tasks/agent-tasks.service';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { ProductionProjectWorkspaceAgentService } from './production-project-workspace-agent.service';
import { ProductionProjectWorkspaceService } from './production-project-workspace.service';
import { ProductionTestAgentService } from './production-test-agent.service';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { resolveProductionRoleAgentPlan } from './production-role-agent-policy';
import { WorkspaceTaskLeaseLostError } from './production-project-workspace.support';
import type {
  ProductionWorkflowJobAttempt,
} from './production-workflow-queue.service';
import { ProductionWorkflowQueueService } from './production-workflow-queue.service';
import type {
  ReviewWorkspaceCodingTaskDto,
  SubmitWorkspaceCodingTaskDto,
} from './production-project-workspace.dto';

type CodingTaskJob = Extract<
  import('./production-workflow-queue.service').ProductionWorkflowJob,
  { operation: 'coding_task' }
>;
type CodingTaskContext = {
  artifactId: string;
  instruction: string;
  role: 'frontend' | 'backend' | 'qa';
  task: 'code' | 'verify';
  strictRole: boolean;
  parentRunId: string | null;
};

const CODING_TASK_DISPATCH_EVENT = 'workflow.dispatch.requested';
const CODING_TASK_DISPATCH_NAMESPACE = 'coding-task-dispatch';

@Injectable()
export class CodingTaskService implements OnModuleInit {
  private readonly logger = new Logger(CodingTaskService.name);

  constructor(
    private readonly tasks: AgentTasksService,
    private readonly runs: AgentRunsService,
    private readonly runtimeEvents: AgentRuntimeEventsService,
    private readonly domainEvents: DomainEventsService,
    private readonly queue: ProductionWorkflowQueueService,
    private readonly workspaceAgent: ProductionProjectWorkspaceAgentService,
    private readonly workspace: ProductionProjectWorkspaceService,
    private readonly testAgent: ProductionTestAgentService,
    private readonly artifacts: ArtifactsService,
  ) {}

  onModuleInit(): void {
    this.queue.registerCodingTaskProcessor((job, attempt) =>
      this.processQueuedJob(job, attempt),
    );
  }

  async submit(input: {
    threadId: string;
    ownerUserId: string;
    tenantId?: string;
    body: SubmitWorkspaceCodingTaskDto;
  }): Promise<{ taskId: string; runId: string; status: string }> {
    const threadId = input.threadId.trim();
    const ownerUserId = input.ownerUserId.trim();
    const tenantId = input.tenantId?.trim() || 'legacy';
    const artifactId = input.body.artifactId.trim();
    const instruction = input.body.instruction.trim();
    const requestId = input.body.requestId.trim().toLowerCase();
    const plan = resolveProductionRoleAgentPlan({
      role: input.body.role,
      task: input.body.task,
    });
    const strictRole =
      input.body.role !== undefined || input.body.task !== undefined;
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify([
          tenantId,
          ownerUserId,
          threadId,
          plan.role,
          plan.task,
          strictRole,
          artifactId,
          instruction,
        ]),
      )
      .digest('hex');

    const existing = await this.tasks.findCodingTaskByRequest({
      tenantId,
      ownerUserId,
      requestId,
    });
    if (existing) {
      return this.toAccepted(this.assertExisting(existing, requestHash, threadId));
    }

    const workflowContext = await this.workspace.validateCodingArtifact(
      threadId,
      ownerUserId,
      tenantId,
      artifactId,
      plan.role,
      plan.task,
      strictRole,
    );

    const taskId = randomUUID();
    try {
      const created = await this.domainEvents.transaction(async (manager) => {
        const raced = await this.tasks.findCodingTaskByRequest({
          tenantId,
          ownerUserId,
          requestId,
        });
        if (raced) {
          return {
            task: this.assertExisting(raced, requestHash, threadId),
            run: null,
          };
        }

        const run = await this.runs.start(
          {
            threadId,
            userId: ownerUserId,
            tenantId,
            mode: 'coding',
            route: 'workspace_agent',
            maxSteps: plan.task === 'verify' ? 6 : 10,
            maxToolCalls: plan.task === 'verify' ? 4 : 8,
          },
          manager,
        );
        const task = await this.tasks.createCodingTask(
          {
            id: taskId,
            threadId,
            runId: run.id,
            tenantId,
            ownerUserId,
            requestId,
            requestHash,
            artifactId,
            instruction,
            role: plan.role,
            task: plan.task,
            strictRole,
            parentRunId: workflowContext.runId,
          },
          manager,
        );
        const job = this.toJob(task, false);
        await this.domainEvents.emitInTransaction(manager, {
          tenantId,
          eventType: CODING_TASK_DISPATCH_EVENT,
          aggregateType: 'coding_task',
          aggregateId: threadId,
          idempotencyKey: this.dispatchKey(task.id, task.retryCount),
          payload: { job, requestHash },
        });
        return { task, run };
      });

      if (created.run) {
        await this.runs.ensureStartedEvent(created.run as AgentRunEntity);
        await this.tasks.ensureCodingTaskEvent(
          created.task as AgentTaskEntity,
          'task.created',
          {
            status: 'queued',
            taskType: 'coding_task',
            role: plan.role,
            task: plan.task,
            parentRunId: workflowContext.runId,
          },
          `coding-task-created:${created.task!.id}`,
        );
      }
      const task = created.task as AgentTaskEntity;
      if (!task.runId) throw new ConflictException('Coding task has no runId');
      return { taskId: task.id, runId: task.runId, status: task.status };
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const winner = await this.tasks.findCodingTaskByRequest({
        tenantId,
        ownerUserId,
        requestId,
      });
      if (!winner) throw error;
      return this.toAccepted(this.assertExisting(winner, requestHash, threadId));
    }
  }

  async get(input: {
    taskId: string;
    threadId: string;
    ownerUserId: string;
    tenantId?: string;
  }) {
    const task = await this.tasks.findOwnedCodingTask(
      input.taskId,
      input.ownerUserId,
      input.tenantId?.trim() || 'legacy',
      input.threadId,
    );
    const context = this.parseContext(task.codingContext);
    const events = await this.runtimeEvents.list(
      task.threadId,
      task.runId ?? undefined,
      task.tenantId?.trim() || 'legacy',
      undefined,
      200,
    );
    return {
      taskId: task.id,
      runId: task.runId,
      traceId: task.runId,
      threadId: task.threadId,
      role: context.role,
      taskType: context.task,
      artifactId: context.artifactId,
      parentRunId: context.parentRunId,
      outputArtifactId: task.outputArtifactId,
      status: task.status,
      attempt: task.retryCount,
      lastCompletedStep: task.lastCompletedStep,
      summary: task.resultSummary,
      error: task.errorMessage,
      failureReason: task.errorMessage,
      verification: this.parseJson(task.verification),
      events,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  async getReportFile(input: {
    taskId: string;
    threadId: string;
    ownerUserId: string;
    tenantId?: string;
  }) {
    const task = await this.tasks.findOwnedCodingTask(
      input.taskId,
      input.ownerUserId,
      input.tenantId?.trim() || 'legacy',
      input.threadId,
    );
    const context = this.parseContext(task.codingContext);
    if (context.role !== 'qa' || context.task !== 'verify' || !task.outputArtifactId) {
      throw new ConflictException('QA report artifact is not available');
    }
    const artifact = await this.getQaArtifact(task, task.outputArtifactId, 'qa-report', input);
    return this.artifacts.getFileOwned(artifact.id, input.ownerUserId);
  }

  async getLogsFile(input: {
    taskId: string;
    threadId: string;
    ownerUserId: string;
    tenantId?: string;
  }) {
    const task = await this.tasks.findOwnedCodingTask(
      input.taskId,
      input.ownerUserId,
      input.tenantId?.trim() || 'legacy',
      input.threadId,
    );
    const context = this.parseContext(task.codingContext);
    const verification = this.parseJson(task.verification) as
      | Record<string, unknown>
      | null;
    const logsArtifactId = verification?.logsArtifactId;
    if (
      context.role !== 'qa' ||
      context.task !== 'verify' ||
      typeof logsArtifactId !== 'string'
    ) {
      throw new ConflictException('QA check logs are not available');
    }
    const artifact = await this.getQaArtifact(task, logsArtifactId, 'qa-logs', input);
    return this.artifacts.getFileOwned(artifact.id, input.ownerUserId);
  }

  async review(input: {
    taskId: string;
    threadId: string;
    ownerUserId: string;
    tenantId?: string;
    body: ReviewWorkspaceCodingTaskDto;
  }) {
    const tenantId = input.tenantId?.trim() || 'legacy';
    const task = await this.tasks.findOwnedCodingTask(
      input.taskId,
      input.ownerUserId,
      tenantId,
      input.threadId,
    );
    const context = this.parseContext(task.codingContext);
    if (context.role !== 'qa' || context.task !== 'verify' || !task.runId) {
      throw new ConflictException('Only a QA verification task can be reviewed');
    }
    const verification = this.parseJson(task.verification) as
      | Record<string, unknown>
      | null;
    const existingReview = verification?.review as
      | Record<string, unknown>
      | undefined;
    const comment = input.body.comment?.trim() || null;
    if (input.body.decision === 'rejected' && !comment) {
      throw new ConflictException('A rejection comment is required');
    }

    if (task.status === 'approved' || task.status === 'rejected') {
      if (
        existingReview?.reviewId !== input.body.reviewId ||
        existingReview?.reviewerUserId !== input.ownerUserId ||
        existingReview?.decision !== input.body.decision ||
        (existingReview?.comment ?? null) !== comment ||
        (existingReview?.remediationTaskId ?? null) !==
          (input.body.remediationTaskId ?? null)
      ) {
        throw new ConflictException('QA task already has a different review');
      }
      await this.emitReviewEvent(task, existingReview);
      return { taskId: task.id, status: task.status, review: existingReview };
    }
    if (
      task.status !== 'waiting_review' ||
      verification?.requiresHumanReview !== true ||
      !task.outputArtifactId
    ) {
      throw new ConflictException('QA task is not waiting for review');
    }
    if (input.body.remediationTaskId) {
      const remediationTask = await this.tasks.findOwnedCodingTask(
        input.body.remediationTaskId,
        input.ownerUserId,
        tenantId,
        input.threadId,
      );
      const remediationContext = this.parseContext(remediationTask.codingContext);
      if (
        remediationContext.task !== 'code' ||
        remediationContext.artifactId !== context.artifactId
      ) {
        throw new ConflictException(
          'Remediation task must be a coding task for the reviewed artifact.',
        );
      }
    }

    const review = {
      reviewId: input.body.reviewId,
      reviewerUserId: input.ownerUserId,
      reviewedAt: new Date().toISOString(),
      decision: input.body.decision,
      comment,
      qaTaskId: task.id,
      artifactId: context.artifactId,
      qaReportArtifactId: task.outputArtifactId,
      artifactVersion:
        typeof verification.artifactVersion === 'string'
          ? verification.artifactVersion
          : context.artifactId,
      remediationArtifactId:
        input.body.decision === 'rejected' ? context.artifactId : null,
      remediationTaskId: input.body.remediationTaskId ?? null,
    };
    const nextVerification = { ...verification, review };
    const updated = await this.tasks.transitionCodingTask(
      task.id,
      'waiting_review',
      {
        status: input.body.decision,
        verification: JSON.stringify(nextVerification),
        errorMessage:
          input.body.decision === 'rejected'
            ? comment
            : null,
        resultSummary:
          input.body.decision === 'approved'
            ? 'QA 报告已由人工审阅并批准。'
            : 'QA 报告已被驳回，需按审阅意见修复后重新提交 QA 任务。',
      },
    );
    if (!updated) {
      const latest = await this.tasks.findOwnedCodingTask(
        task.id,
        input.ownerUserId,
        tenantId,
        input.threadId,
      );
      const latestVerification = this.parseJson(latest.verification) as
        | Record<string, unknown>
        | null;
      const latestReview = latestVerification?.review as
        | Record<string, unknown>
        | undefined;
      if (
        (latest.status !== 'approved' && latest.status !== 'rejected') ||
        latestReview?.reviewId !== input.body.reviewId ||
        latestReview?.reviewerUserId !== input.ownerUserId ||
        latestReview?.decision !== input.body.decision ||
        (latestReview?.comment ?? null) !== comment ||
        (latestReview?.remediationTaskId ?? null) !==
          (input.body.remediationTaskId ?? null)
      ) {
        throw new ConflictException('QA task state changed before review');
      }
      await this.emitReviewEvent(latest, latestReview);
      return { taskId: latest.id, status: latest.status, review: latestReview };
    }
    await this.emitReviewEvent(updated, review);
    return { taskId: updated.id, status: updated.status, review };
  }

  async cancel(input: {
    taskId: string;
    threadId: string;
    ownerUserId: string;
    tenantId?: string;
    reason?: string;
  }) {
    const task = await this.tasks.findOwnedCodingTask(
      input.taskId,
      input.ownerUserId,
      input.tenantId?.trim() || 'legacy',
      input.threadId,
    );
    if (!task.runId) throw new ConflictException('Coding task has no runId');
    if (task.status === 'cancelled') {
      return { taskId: task.id, runId: task.runId, status: task.status };
    }
    const run = await this.runs.cancel(task.runId, input.reason);
    if (run.status !== 'cancelled') {
      return { taskId: task.id, runId: task.runId, status: task.status };
    }
    const current = await this.tasks.updateCodingTask(task.id, {
      status: 'cancelled',
      errorMessage: run.cancelReason ?? input.reason ?? '用户取消运行',
      resultSummary: run.resultSummary,
    });
    await this.tasks.ensureCodingTaskEvent(
      current,
      'task.cancelled',
      { status: 'cancelled', reason: current.errorMessage },
      `coding-task-cancelled:${current.id}`,
    );
    return { taskId: current.id, runId: current.runId, status: current.status };
  }

  async resume(input: {
    taskId: string;
    threadId: string;
    ownerUserId: string;
    tenantId?: string;
  }) {
    const tenantId = input.tenantId?.trim() || 'legacy';
    const task = await this.tasks.findOwnedCodingTask(
      input.taskId,
      input.ownerUserId,
      tenantId,
      input.threadId,
    );
    if (!task.runId || !['failed', 'blocked'].includes(task.status)) {
      throw new ConflictException('Coding task is not safely resumable');
    }
    const events = await this.runtimeEvents.list(
      task.threadId,
      task.runId,
      tenantId,
      undefined,
      500,
    );
    if (
      events.some((event) => event.eventType === 'tool.unknown') ||
      events.some(
        (event) =>
          event.eventType === 'run.failed' &&
          (event.payload as Record<string, unknown>)?.recovery === 'stale_run_sweeper',
      )
    ) {
      throw new ConflictException(
        'Coding task has an unknown or stale side effect and requires reconciliation before resume',
      );
    }

    const context = this.parseContext(task.codingContext);
    try {
      if (context.task === 'verify') {
        await this.testAgent.assertCanResume({
          threadId: task.threadId,
          userId: task.ownerUserId!,
          tenantId: task.tenantId ?? undefined,
          artifactId: context.artifactId,
          instruction: context.instruction,
          runId: task.runId,
          taskId: task.id,
        });
      } else {
        await this.workspaceAgent.assertCanResume(
          task.threadId,
          task.ownerUserId!,
          task.tenantId ?? undefined,
          context.artifactId,
          context.instruction,
          {
            runId: task.runId,
            taskId: task.id,
            role: context.role as 'frontend' | 'backend',
            strictRole: context.strictRole,
          },
        );
      }
    } catch (error) {
      if (error instanceof AgentLoopResumeError) {
        const nextStatus =
          error.code === 'budget_exceeded'
            ? 'budget_exceeded'
            : 'waiting_reconciliation';
        const saved = await this.tasks.updateCodingTask(
          task.id,
          { status: nextStatus, errorMessage: error.message.slice(0, 2_000) },
        );
        await this.tasks.ensureCodingTaskEvent(
          saved,
          nextStatus === 'budget_exceeded' ? 'task.blocked' : 'task.reconciliation_required',
          { status: nextStatus, reason: error.message, recoveryCode: error.code },
          `coding-task-resume-blocked:${saved.id}:${saved.retryCount}`,
        );
        throw new ConflictException(error.message);
      }
      throw error;
    }

    const resumed = await this.domainEvents.transaction(async (manager) => {
      const run = await this.runs.prepareCodingResume(task.runId!, manager);
      const nextTask = await this.tasks.updateCodingTask(
        task.id,
        {
          status: 'queued',
          retryCount: task.retryCount + 1,
          errorMessage: null,
          resultSummary: null,
          verification: null,
        },
        manager,
      );
      const job = this.toJob(nextTask, true);
      await this.domainEvents.emitInTransaction(manager, {
        tenantId,
        eventType: CODING_TASK_DISPATCH_EVENT,
        aggregateType: 'coding_task',
        aggregateId: input.threadId,
        idempotencyKey: this.dispatchKey(nextTask.id, nextTask.retryCount),
        payload: { job, requestHash: nextTask.requestHash },
      });
      return { task: nextTask, run };
    });
    await this.runs.ensureCodingResumeEvent(resumed.run);
    await this.tasks.ensureCodingTaskEvent(
      resumed.task,
      'task.retry',
      { status: 'queued', retryCount: resumed.task.retryCount },
      `coding-task-retry:${resumed.task.id}:${resumed.task.retryCount}`,
    );
    return {
      taskId: resumed.task.id,
      runId: resumed.task.runId,
      status: resumed.task.status,
      attempt: resumed.task.retryCount,
    };
  }

  private async processJob(
    job: CodingTaskJob,
    attempt: ProductionWorkflowJobAttempt,
  ): Promise<void> {
    const task = await this.tasks.findById(job.taskId);
    if (
      task.taskType !== 'coding_task' ||
      task.threadId !== job.threadId ||
      task.ownerUserId !== job.userId ||
      (task.tenantId ?? 'legacy') !== (job.tenantId ?? 'legacy') ||
      !task.runId
    ) {
      throw new ConflictException('Coding task dispatch identity mismatch');
    }
    if (this.isTaskClosed(task.status)) return;
    const context = this.parseContext(task.codingContext);
    try {
      await this.tasks.updateCodingTask(
        task.id,
        { status: 'running', errorMessage: null },
      );
    } catch (error) {
      const latest = await this.tasks.findById(task.id);
      if (this.isTaskClosed(latest.status)) return;
      throw error;
    }

    if (context.task === 'verify') {
      await this.processVerificationJob(task, job, attempt, context);
      return;
    }

    let output: Awaited<
      ReturnType<ProductionProjectWorkspaceAgentService['runWithExecutionOptions']>
    >;
    try {
      await this.workspace.validateCodingArtifact(
        task.threadId,
        task.ownerUserId!,
        task.tenantId ?? undefined,
        context.artifactId,
        context.role,
        'code',
        context.strictRole,
      );
      output = await this.workspaceAgent.runWithExecutionOptions(
        task.threadId,
        task.ownerUserId!,
        task.tenantId ?? undefined,
        context.artifactId,
        context.instruction,
        {
          runId: task.runId!,
          taskId: task.id,
          resume: job.resume || attempt.attempt > 1,
          role: context.role as 'frontend' | 'backend',
          strictRole: context.strictRole,
        },
      );
    } catch (error) {
      if (error instanceof WorkspaceTaskLeaseLostError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt.finalAttempt) {
        await this.workspace.assertWorkspaceTaskLeaseOwned();
        const status =
          error instanceof AgentLoopResumeError
            ? error.code === 'budget_exceeded'
              ? 'budget_exceeded'
              : 'waiting_reconciliation'
            : 'failed';
        const run = await this.runs.finish(task.runId!, {
          route: 'workspace_agent',
          status: 'failed',
          errorMessage: message.slice(0, 2_000),
          retryCount: job.taskAttempt,
        });
        const saved = await this.saveTaskResult(task, {
          status: run.status === 'cancelled' ? 'cancelled' : status,
          errorMessage: message.slice(0, 2_000),
          resultSummary: null,
        });
        if (saved) {
          await this.tasks.ensureCodingTaskEvent(
            saved,
            saved.status === 'failed'
              ? 'task.failed'
              : saved.status === 'cancelled'
                ? 'task.cancelled'
                : 'task.reconciliation_required',
            {
              status: saved.status,
              error: saved.errorMessage,
              attempt: attempt.attempt,
              ...(error instanceof AgentLoopResumeError
                ? { recoveryCode: error.code }
                : {}),
            },
            `coding-task-failed:${saved.id}:${job.taskAttempt}`,
          );
        }
      }
      this.logger.warn(
        `Coding task worker attempt failed taskId=${task.id} attempt=${attempt.attempt}: ${message.slice(0, 300)}`,
      );
      throw error;
    }

    if (output.status === 'completed') {
      let verification: Awaited<
        ReturnType<ProductionProjectWorkspaceService['verifyWorkspace']>
      >;
      try {
        verification = await this.workspace.verifyWorkspace(
          task.threadId,
          task.ownerUserId!,
          task.tenantId ?? undefined,
          context.artifactId,
          undefined,
          context.role,
          'code',
          context.strictRole,
        );
      } catch (error) {
        if (error instanceof WorkspaceTaskLeaseLostError) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        const check = {
          status: 'not_run' as const,
          command: null,
          exitCode: null,
          output: '',
          reason: reason.slice(0, 500),
        };
        verification = {
          checkedAt: new Date().toISOString(),
          diff: { added: [], modified: [], deleted: [] },
          checks: { lint: check, test: check, build: check },
        };
      }
      const checks = Object.values(verification.checks);
      const hasApplicableCheck = checks.some(
        (check) => check.status === 'passed' || check.status === 'failed',
      );
      const hasFailedCheck = checks.some((check) => check.status === 'failed');
      const hasDiff =
        verification.diff.added.length +
          verification.diff.modified.length +
          verification.diff.deleted.length >
        0;
      const currentTask = await this.tasks.findById(task.id);
      if (currentTask.status === 'cancelled') {
        await this.tasks.ensureCodingTaskEvent(
          currentTask,
          'task.cancelled',
          { status: 'cancelled' },
          `coding-task-cancelled:${currentTask.id}`,
        );
        return;
      }
      if (this.isTaskClosed(currentTask.status)) return;
      let outputArtifactId: string | null = null;
      if (hasDiff) {
        try {
          const outputArtifact = await this.workspace.exportWorkspace(
            task.threadId,
            task.ownerUserId!,
            task.tenantId ?? undefined,
            {
              taskId: task.id,
              role: context.role as 'frontend' | 'backend',
              parentRunId: context.parentRunId,
              traceId: task.runId!,
            },
          );
          outputArtifactId = outputArtifact.id;
        } catch (error) {
          if (error instanceof WorkspaceTaskLeaseLostError) throw error;
          if (attempt.finalAttempt) {
            await this.workspace.assertWorkspaceTaskLeaseOwned();
            const message = error instanceof Error ? error.message : String(error);
            const run = await this.runs.finish(task.runId!, {
              route: 'workspace_agent',
              status: 'failed',
              errorMessage: message.slice(0, 2_000),
              retryCount: job.taskAttempt,
            });
            const saved = await this.saveTaskResult(task, {
              status: run.status === 'cancelled' ? 'cancelled' : 'failed',
              errorMessage: `Coding ZIP Artifact 保存失败：${message.slice(0, 1_500)}`,
              resultSummary: output.summary.slice(0, 2_000),
            });
            if (saved) {
              await this.tasks.ensureCodingTaskEvent(
                saved,
                saved.status === 'cancelled' ? 'task.cancelled' : 'task.failed',
                { status: saved.status, error: saved.errorMessage },
                `coding-task-artifact-failed:${saved.id}:${job.taskAttempt}`,
              );
            }
          }
          throw error;
        }
      }
      const status = hasFailedCheck
        ? 'verification_failed'
        : !hasDiff || !hasApplicableCheck
          ? 'waiting_review'
          : 'completed';
      await this.workspace.assertWorkspaceTaskLeaseOwned();
      const run = await this.runs.finish(task.runId!, {
        route: 'workspace_agent',
        status: 'completed',
        resultSummary: output.summary.slice(0, 2_000),
        retryCount: job.taskAttempt,
      });
      const saved = await this.saveTaskResult(task, {
        status: run.status === 'cancelled' ? 'cancelled' : status,
        resultSummary: output.summary.slice(0, 2_000),
        errorMessage:
          status === 'verification_failed'
            ? '一项或多项声明的 package script 检查失败。'
            : null,
        verification: JSON.stringify(verification),
        outputArtifactId,
        lastCompletedStep: output.steps.length,
      });
      if (saved) {
        await this.tasks.ensureCodingTaskEvent(
          saved,
          saved.status === 'completed'
            ? 'task.completed'
            : saved.status === 'verification_failed'
              ? 'task.verification_failed'
              : saved.status === 'cancelled'
                ? 'task.cancelled'
                : 'task.updated',
          {
            status: saved.status,
            summary: saved.resultSummary,
            attempt: attempt.attempt,
            diff: {
              added: verification.diff.added.length,
              modified: verification.diff.modified.length,
              deleted: verification.diff.deleted.length,
            },
            verification: Object.fromEntries(
              Object.entries(verification.checks).map(([name, check]) => [
                name,
                { status: check.status, exitCode: check.exitCode },
              ]),
            ),
          },
          `coding-task-result:${saved.id}:${job.taskAttempt}`,
        );
      }
      return;
    }

    const events = await this.runtimeEvents.list(
      task.threadId,
      task.runId,
      task.tenantId?.trim() || 'legacy',
      undefined,
      500,
    );
    const hasUnknownTool = events.some(
      (event) => event.eventType === 'tool.unknown',
    );
    const status =
      output.status === 'cancelled'
        ? 'cancelled'
        : output.status === 'blocked'
          ? hasUnknownTool
            ? 'waiting_reconciliation'
            : 'blocked'
          : output.status === 'budget_exceeded'
            ? 'budget_exceeded'
            : 'failed';
    await this.workspace.assertWorkspaceTaskLeaseOwned();
    const run = await this.runs.finish(task.runId!, {
      route: 'workspace_agent',
      status: status === 'cancelled' ? 'cancelled' : 'failed',
      resultSummary: output.summary.slice(0, 2_000),
      errorMessage: output.summary.slice(0, 2_000),
      cancelReason: status === 'cancelled' ? output.summary.slice(0, 500) : undefined,
      cancelledAt: status === 'cancelled' ? new Date() : undefined,
      retryCount: job.taskAttempt,
    });
    const saved = await this.saveTaskResult(task, {
      status: run.status === 'cancelled' ? 'cancelled' : status,
      resultSummary: output.summary.slice(0, 2_000),
      errorMessage: output.summary.slice(0, 2_000),
      lastCompletedStep: output.steps.length,
    });
    if (saved) {
      await this.tasks.ensureCodingTaskEvent(
        saved,
        saved.status === 'cancelled'
          ? 'task.cancelled'
          : saved.status === 'waiting_reconciliation'
            ? 'task.reconciliation_required'
            : saved.status === 'blocked'
              ? 'task.blocked'
              : 'task.failed',
        { status: saved.status, summary: saved.resultSummary, attempt: attempt.attempt },
        `coding-task-result:${saved.id}:${job.taskAttempt}`,
      );
    }
  }

  private async saveTaskResult(
    task: AgentTaskEntity,
    input: Parameters<AgentTasksService['updateCodingTask']>[1],
  ): Promise<AgentTaskEntity | null> {
    await this.workspace.assertWorkspaceTaskLeaseOwned();
    const current = await this.tasks.findById(task.id);
    if (current.status === 'cancelled') return current;
    if (this.isTaskClosed(current.status)) return current;
    return this.tasks.updateCodingTask(
      task.id,
      input,
    );
  }

  private async processQueuedJob(
    job: CodingTaskJob,
    attempt: ProductionWorkflowJobAttempt,
  ): Promise<void> {
    const task = await this.tasks.findById(job.taskId);
    if (
      task.taskType !== 'coding_task' ||
      task.threadId !== job.threadId ||
      task.ownerUserId !== job.userId ||
      (task.tenantId ?? 'legacy') !== (job.tenantId ?? 'legacy') ||
      !task.runId
    ) {
      throw new ConflictException('Coding task dispatch identity mismatch');
    }
    if (this.isTaskClosed(task.status)) return;
    await this.workspace.withWorkspaceTaskLease(
      task.threadId,
      task.ownerUserId!,
      task.tenantId ?? undefined,
      () => this.processJob(job, attempt),
    );
  }

  private async processVerificationJob(
    task: AgentTaskEntity,
    job: CodingTaskJob,
    attempt: ProductionWorkflowJobAttempt,
    context: CodingTaskContext,
  ): Promise<void> {
    let output: Awaited<
      ReturnType<ProductionTestAgentService['runWithExecutionOptions']>
    >;
    try {
      output = await this.testAgent.runWithExecutionOptions({
        threadId: task.threadId,
        userId: task.ownerUserId!,
        tenantId: task.tenantId ?? undefined,
        artifactId: context.artifactId,
        instruction: context.instruction,
        runId: task.runId!,
        taskId: task.id,
        parentRunId: context.parentRunId ?? undefined,
        resume: job.resume || attempt.attempt > 1,
      });
    } catch (error) {
      if (error instanceof WorkspaceTaskLeaseLostError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt.finalAttempt) {
        await this.workspace.assertWorkspaceTaskLeaseOwned();
        const events = await this.runtimeEvents.list(
          task.threadId,
          task.runId!,
          task.tenantId?.trim() || 'legacy',
          undefined,
          500,
        );
        const hasUnknownTool = events.some(
          (event) => event.eventType === 'tool.unknown',
        );
        const status = hasUnknownTool
          ? 'waiting_reconciliation'
          : error instanceof AgentLoopResumeError &&
              error.code === 'budget_exceeded'
            ? 'budget_exceeded'
            : 'failed';
        const run = await this.runs.finish(task.runId!, {
          route: 'workspace_agent',
          status: 'failed',
          errorMessage: message.slice(0, 2_000),
          retryCount: job.taskAttempt,
        });
        const saved = await this.saveTaskResult(task, {
          status: run.status === 'cancelled' ? 'cancelled' : status,
          errorMessage: message.slice(0, 2_000),
          resultSummary: null,
        });
        if (saved) {
          await this.tasks.ensureCodingTaskEvent(
            saved,
            saved.status === 'waiting_reconciliation'
              ? 'task.reconciliation_required'
              : saved.status === 'cancelled'
                ? 'task.cancelled'
                : 'task.failed',
            {
              status: saved.status,
              error: saved.errorMessage,
              attempt: attempt.attempt,
            },
            `qa-task-failed:${saved.id}:${job.taskAttempt}`,
          );
        }
      }
      throw error;
    }

    let outputArtifactId: string | null = null;
    let qaReport = output.report;
    let logsArtifactId: string | null = null;
    if (output.report && output.logs) {
      const logsBody = Buffer.from(
        `${JSON.stringify(
          {
            taskId: task.id,
            artifactId: context.artifactId,
            checks: Object.fromEntries(
              Object.entries(output.logs).map(([name, check]) => [name, check]),
            ),
          },
          null,
          2,
        )}\n`,
      );
      try {
        const logsArtifact = await this.saveQaArtifact(task, {
          target: 'qa-logs',
          title: `QA 检查日志 ${task.id}`,
          filename: `qa-logs-${task.id}.json`,
          body: logsBody,
          artifactId: context.artifactId,
          parentRunId: context.parentRunId,
          traceId: task.runId!,
        });
        logsArtifactId = logsArtifact.id;
      } catch (error) {
        if (error instanceof WorkspaceTaskLeaseLostError) throw error;
        if (attempt.finalAttempt) {
          await this.workspace.assertWorkspaceTaskLeaseOwned();
          const message = error instanceof Error ? error.message : String(error);
          const run = await this.runs.finish(task.runId!, {
            route: 'workspace_agent',
            status: 'failed',
            errorMessage: message.slice(0, 2_000),
            retryCount: job.taskAttempt,
          });
          const saved = await this.saveTaskResult(task, {
            status: run.status === 'cancelled' ? 'cancelled' : 'failed',
            errorMessage: `QA 检查日志 Artifact 保存失败：${message.slice(0, 1_500)}`,
            resultSummary: output.summary.slice(0, 2_000),
          });
          if (saved) {
            await this.tasks.ensureCodingTaskEvent(
              saved,
              saved.status === 'cancelled' ? 'task.cancelled' : 'task.failed',
              { status: saved.status, error: saved.errorMessage },
              `qa-logs-artifact-failed:${saved.id}:${job.taskAttempt}`,
            );
          }
        }
        throw error;
      }
    }

    if (qaReport) {
      const report = {
        ...qaReport,
        logsArtifactId,
        checks: qaReport.checks.map((check) => ({
          ...check,
          logRef:
            logsArtifactId && !check.outputTruncated
              ? `${logsArtifactId}#${check.name}`
              : null,
          logPreview: check.outputTruncated ? check.summary : null,
        })),
        evidenceRefs: logsArtifactId ? [logsArtifactId] : [],
      };
      qaReport = report;
      const body = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
      try {
        const reportArtifact = await this.saveQaArtifact(task, {
          target: 'qa-report',
          title: `QA 报告 ${task.id}`,
          filename: `qa-report-${task.id}.json`,
          body,
          artifactId: context.artifactId,
          parentRunId: context.parentRunId,
          traceId: task.runId!,
          artifactVersion: report.artifactVersion,
          logsArtifactId,
        });
        outputArtifactId = reportArtifact.id;
      } catch (error) {
        if (error instanceof WorkspaceTaskLeaseLostError) throw error;
        if (attempt.finalAttempt) {
          await this.workspace.assertWorkspaceTaskLeaseOwned();
          const message = error instanceof Error ? error.message : String(error);
          const run = await this.runs.finish(task.runId!, {
            route: 'workspace_agent',
            status: 'failed',
            errorMessage: message.slice(0, 2_000),
            retryCount: job.taskAttempt,
          });
          const saved = await this.saveTaskResult(task, {
            status: run.status === 'cancelled' ? 'cancelled' : 'failed',
            errorMessage: `QA 报告 Artifact 保存失败：${message.slice(0, 1_500)}`,
            resultSummary: output.summary.slice(0, 2_000),
          });
          if (saved) {
            await this.tasks.ensureCodingTaskEvent(
              saved,
              saved.status === 'cancelled' ? 'task.cancelled' : 'task.failed',
              { status: saved.status, error: saved.errorMessage },
              `qa-report-artifact-failed:${saved.id}:${job.taskAttempt}`,
            );
          }
        }
        throw error;
      }
    }

    const events =
      output.status === 'blocked'
        ? await this.runtimeEvents.list(
            task.threadId,
            task.runId!,
            task.tenantId?.trim() || 'legacy',
            undefined,
            500,
          )
        : [];
    const hasUnknownTool = events.some(
      (event) => event.eventType === 'tool.unknown',
    );
    const taskStatus =
      output.status !== 'completed'
        ? output.status === 'cancelled'
          ? 'cancelled'
          : output.status === 'budget_exceeded'
            ? 'budget_exceeded'
            : output.status === 'blocked'
              ? hasUnknownTool
                ? 'waiting_reconciliation'
                : 'blocked'
              : 'failed'
        : qaReport?.status === 'failed'
          ? 'verification_failed'
          : 'waiting_review';
    const runStatus = output.status === 'completed' ? 'completed' : 'failed';
    await this.workspace.assertWorkspaceTaskLeaseOwned();
    const run = await this.runs.finish(task.runId!, {
      route: 'workspace_agent',
      status: runStatus,
      resultSummary: output.summary.slice(0, 2_000),
      errorMessage:
        output.status === 'completed' && qaReport?.status === 'failed'
          ? '一个或多个实际检查失败，请审阅 QA 报告。'
          : qaReport?.status === 'not_run'
            ? '没有实际可用的检查结果，请审阅 QA 报告。'
            : qaReport?.status === 'incomplete'
              ? '必需的 lint/test/build 检查未全部通过，请人工审阅。'
            : undefined,
      retryCount: job.taskAttempt,
    });
    const saved = await this.saveTaskResult(task, {
      status: run.status === 'cancelled' ? 'cancelled' : taskStatus,
      resultSummary: qaReport?.summary ?? output.summary.slice(0, 2_000),
      errorMessage:
        output.status !== 'completed'
          ? output.summary.slice(0, 2_000)
          : qaReport?.status === 'failed'
            ? '一个或多个实际检查失败，请审阅 QA 报告。'
            : qaReport?.status === 'not_run'
              ? '没有实际可用的检查结果，请审阅 QA 报告。'
              : qaReport?.status === 'incomplete'
                ? '必需的 lint/test/build 检查未全部通过，请人工审阅。'
              : null,
      verification: qaReport ? JSON.stringify(qaReport) : null,
      outputArtifactId,
      lastCompletedStep: output.toolCalls,
    });
    if (saved) {
      await this.tasks.ensureCodingTaskEvent(
        saved,
        saved.status === 'verification_failed'
          ? 'task.verification_failed'
          : saved.status === 'waiting_reconciliation'
            ? 'task.reconciliation_required'
          : saved.status === 'waiting_review'
            ? 'task.review_required'
            : saved.status === 'cancelled'
              ? 'task.cancelled'
              : saved.status === 'blocked'
                ? 'task.blocked'
                : saved.status === 'budget_exceeded'
                  ? 'task.blocked'
                  : 'task.failed',
        {
          status: saved.status,
          role: 'qa',
          taskType: 'verify',
          summary: saved.resultSummary,
          outputArtifactId: saved.outputArtifactId,
          reportStatus: qaReport?.status ?? null,
          attempt: attempt.attempt,
        },
        `qa-task-result:${saved.id}:${job.taskAttempt}`,
      );
    }
  }

  private isTaskClosed(status: string): boolean {
    return [
      'completed',
      'failed',
      'blocked',
      'budget_exceeded',
      'cancelled',
      'verification_failed',
      'waiting_review',
      'waiting_reconciliation',
      'approved',
      'rejected',
    ].includes(status);
  }

  private async getQaArtifact(
    task: AgentTaskEntity,
    artifactId: string,
    target: 'qa-report' | 'qa-logs',
    input: { threadId: string; ownerUserId: string; tenantId?: string },
  ) {
    const artifact = await this.artifacts.getOwned(artifactId, input.ownerUserId);
    const metadata = this.parseJson(artifact.metadata) as
      | Record<string, unknown>
      | null;
    if (
      artifact.status !== 'ready' ||
      artifact.threadId !== input.threadId ||
      (artifact.tenantId ?? 'legacy') !== (input.tenantId?.trim() || 'legacy') ||
      metadata?.studio !== 'qa' ||
      metadata?.target !== target ||
      metadata?.role !== 'qa' ||
      metadata?.taskType !== 'verify' ||
      metadata?.taskId !== task.id
    ) {
      throw new ConflictException(`QA ${target} artifact identity mismatch`);
    }
    return artifact;
  }

  private emitReviewEvent(
    task: AgentTaskEntity,
    review: Record<string, unknown>,
  ) {
    const reviewId = String(review.reviewId);
    return this.tasks.ensureCodingTaskEvent(
      task,
      `task.qa_${String(review.decision)}`,
      { status: review.decision, review },
      `qa-review:${task.id}:${reviewId}`,
      String(review.reviewerUserId),
    );
  }

  private async saveQaArtifact(
    task: AgentTaskEntity,
    input: {
      target: 'qa-report' | 'qa-logs';
      title: string;
      filename: string;
      body: Buffer;
      artifactId: string;
      parentRunId: string | null;
      traceId: string;
      artifactVersion?: string;
      logsArtifactId?: string | null;
    },
  ): Promise<{ id: string }> {
    const versions = await this.artifacts.listStudioVersions(
      task.ownerUserId!,
      task.threadId,
    );
    const existing = versions.find(
      (item) =>
        item.status === 'ready' &&
        item.metadata?.target === input.target &&
        item.metadata?.taskId === task.id,
    );
    if (existing) {
      const artifact = await this.artifacts.getOwned(
        existing.id,
        task.ownerUserId!,
      );
      const metadata = this.parseJson(artifact.metadata) as
        | Record<string, unknown>
        | null;
      if (
        artifact.status === 'ready' &&
        artifact.threadId === task.threadId &&
        (artifact.tenantId ?? 'legacy') === (task.tenantId ?? 'legacy') &&
        metadata?.studio === 'qa' &&
        metadata?.target === input.target &&
        metadata?.taskId === task.id
      ) {
        return { id: artifact.id };
      }
    }
    return this.artifacts.createStudioVersion({
      ownerUserId: task.ownerUserId!,
      tenantId: task.tenantId ?? undefined,
      threadId: task.threadId,
      title: input.title,
      kind: 'json',
      filename: input.filename,
      sourceText: input.body.toString('utf8'),
      body: input.body,
      contentType: 'application/json; charset=utf-8',
      metadata: {
        studio: 'qa',
        target: input.target,
        role: 'qa',
        taskType: 'verify',
        taskId: task.id,
        parentRunId: input.parentRunId,
        traceId: input.traceId,
        artifactId: input.artifactId,
        ...(input.artifactVersion
          ? { artifactVersion: input.artifactVersion }
          : {}),
        ...(input.logsArtifactId
          ? { logsArtifactId: input.logsArtifactId }
          : {}),
      },
    });
  }

  private toJob(task: AgentTaskEntity, resume: boolean): CodingTaskJob {
    const tenantId = task.tenantId ?? 'legacy';
    return {
      id: `production-workflow-coding_task-${task.id.replace(/-/g, '')}-r${task.retryCount}`,
      operation: 'coding_task',
      taskId: task.id,
      taskAttempt: task.retryCount,
      resume,
      threadId: task.threadId,
      userId: task.ownerUserId!,
      tenantId,
    };
  }

  private dispatchKey(taskId: string, attempt: number): string {
    return `${CODING_TASK_DISPATCH_NAMESPACE}:${taskId}:${attempt}`;
  }

  private assertExisting(
    task: AgentTaskEntity,
    requestHash: string,
    threadId: string,
  ): AgentTaskEntity {
    if (task.requestHash !== requestHash || task.threadId !== threadId || !task.runId) {
      throw new ConflictException('requestId 已被不同的 Coding Task 请求使用');
    }
    return task;
  }

  private toAccepted(task: AgentTaskEntity) {
    if (!task.runId) throw new ConflictException('Coding task has no runId');
    return { taskId: task.id, runId: task.runId, status: task.status };
  }

  private parseContext(raw: string | null): CodingTaskContext {
    try {
      const value = JSON.parse(raw ?? '') as Record<string, unknown>;
      if (
        value.source !== 'zip' ||
        typeof value.artifactId !== 'string' ||
        typeof value.instruction !== 'string'
      ) {
        throw new Error('invalid coding context');
      }
      const plan = resolveProductionRoleAgentPlan({
        role: typeof value.role === 'string' ? value.role : undefined,
        task: typeof value.task === 'string' ? value.task : undefined,
      });
      return {
        artifactId: value.artifactId,
        instruction: value.instruction,
        role: plan.role,
        task: plan.task,
        strictRole: value.strictRole === true,
        parentRunId:
          typeof value.parentRunId === 'string' ? value.parentRunId : null,
      };
    } catch {
      throw new ConflictException('Coding task context is unavailable');
    }
  }

  private parseJson(value: string | null): unknown {
    if (!value) return null;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const code = (error as { code?: unknown }).code;
    return code === '23505' || code === 'ER_DUP_ENTRY';
  }
}
