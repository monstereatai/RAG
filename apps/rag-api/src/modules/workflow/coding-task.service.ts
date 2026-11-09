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
import type {
  ProductionWorkflowJobAttempt,
} from './production-workflow-queue.service';
import { ProductionWorkflowQueueService } from './production-workflow-queue.service';
import type { SubmitWorkspaceCodingTaskDto } from './production-project-workspace.dto';

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
      this.processJob(job, attempt),
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
    if (!task.outputArtifactId) {
      throw new ConflictException('QA report artifact is not available');
    }
    const artifact = await this.artifacts.getOwned(
      task.outputArtifactId,
      input.ownerUserId,
    );
    const metadata = this.parseJson(artifact.metadata) as
      | Record<string, unknown>
      | null;
    if (
      artifact.threadId !== input.threadId ||
      (artifact.tenantId ?? 'legacy') !==
        (input.tenantId?.trim() || 'legacy') ||
      metadata?.studio !== 'qa' ||
      metadata?.taskId !== task.id
    ) {
      throw new ConflictException('QA report artifact identity mismatch');
    }
    return this.artifacts.getFileOwned(artifact.id, input.ownerUserId);
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
      const message = error instanceof Error ? error.message : String(error);
      if (attempt.finalAttempt) {
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
          if (attempt.finalAttempt) {
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
    const current = await this.tasks.findById(task.id);
    if (current.status === 'cancelled') return current;
    if (this.isTaskClosed(current.status)) return current;
    return this.tasks.updateCodingTask(
      task.id,
      input,
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
      const message = error instanceof Error ? error.message : String(error);
      if (attempt.finalAttempt) {
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
    if (output.report) {
      const body = Buffer.from(`${JSON.stringify(output.report, null, 2)}\n`);
      try {
        const reportArtifact = await this.artifacts.createStudioVersion({
          ownerUserId: task.ownerUserId!,
          tenantId: task.tenantId ?? undefined,
          threadId: task.threadId,
          title: `QA 报告 ${task.id}`,
          kind: 'json',
          filename: `qa-report-${task.id}.json`,
          sourceText: body.toString('utf8'),
          body,
          contentType: 'application/json; charset=utf-8',
          metadata: {
            studio: 'qa',
            target: 'qa-report',
            role: 'qa',
            taskType: 'verify',
            taskId: task.id,
            parentRunId: context.parentRunId,
            traceId: task.runId,
            artifactId: context.artifactId,
            artifactVersion: output.report.artifactVersion,
          },
        });
        outputArtifactId = reportArtifact.id;
      } catch (error) {
        if (attempt.finalAttempt) {
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
        : output.report?.status === 'failed'
          ? 'verification_failed'
          : 'waiting_review';
    const runStatus = output.status === 'completed' ? 'completed' : 'failed';
    const run = await this.runs.finish(task.runId!, {
      route: 'workspace_agent',
      status: runStatus,
      resultSummary: output.summary.slice(0, 2_000),
      errorMessage:
        output.status === 'completed' && output.report?.status === 'failed'
          ? '一个或多个实际检查失败，请审阅 QA 报告。'
          : output.report?.status === 'not_run'
            ? '没有实际可用的检查结果，请审阅 QA 报告。'
            : undefined,
      retryCount: job.taskAttempt,
    });
    const saved = await this.saveTaskResult(task, {
      status: run.status === 'cancelled' ? 'cancelled' : taskStatus,
      resultSummary: output.report?.summary ?? output.summary.slice(0, 2_000),
      errorMessage:
        output.status !== 'completed'
          ? output.summary.slice(0, 2_000)
          : output.report?.status === 'failed'
            ? '一个或多个实际检查失败，请审阅 QA 报告。'
            : output.report?.status === 'not_run'
              ? '没有实际可用的检查结果，请审阅 QA 报告。'
              : null,
      verification: output.report ? JSON.stringify(output.report) : null,
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
          reportStatus: output.report?.status ?? null,
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
    ].includes(status);
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
