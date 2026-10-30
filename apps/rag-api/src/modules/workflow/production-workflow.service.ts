import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StateGraph, START, END } from '@langchain/langgraph';
import { createHash, randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { z } from 'zod';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { RedisCheckpointer } from '../../providers/langgraph-checkpointer/redis-checkpointer';
import { ArtifactsService } from '../artifacts/artifacts.service';
import {
  PRODUCTION_ROLES,
  ProductionClaim,
  ProductionDeliverable,
  ProductionEvidence,
  ProductionLowCodeSchema,
  ProductionLowCodeSchemaKind,
  ProductionRole,
  ProductionRiskLevel,
  ProductionStageResult,
  ProductionWorkflowState,
  ProductionWorkflowStateType,
} from './production-workflow.state';
import {
  ResumeProductionWorkflowDto,
  ReviseProductionWorkflowDto,
  StartProductionWorkflowDto,
} from './production-workflow.dto';
import {
  buildProductionExecutionBatches,
  dependenciesForProductionRole,
  normalizeProductionRoles,
} from './production-workflow.plan';
import { ProductionWorkflowTools } from './production-workflow.tools';
import { renderPlaywayPreview } from './playway-preview';
import { LangfuseProvider } from '../../providers/observability/langfuse.provider';
import { DingTalkProvider } from '../../providers/notify/dingtalk.provider';
import { AgentCollaborationService } from '../agent-collaboration/agent-collaboration.service';
import { AgentTasksService } from '../agent-tasks/agent-tasks.service';
import { AgentRuntimeEventsService } from '../agent-runtime-events/agent-runtime-events.service';
import { ToolExecutionPolicyService } from '../../tools/tool-execution-policy.service';
import {
  executeWithToolTimeout,
  getRegisteredToolTimeoutMs,
  ToolExecutionService,
} from '../../tools/tool-execution.service';
import { AgentRunsService } from '../agent-runs/agent-runs.service';
import { AgentGoalService } from '../agent-runs/agent-goal.service';
import { PluginRuntimeService } from '../plugin-runtime/plugin-runtime.service';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { ProductionWorkflowQueueService } from './production-workflow-queue.service';
import type { ProductionWorkflowJob } from './production-workflow-queue.service';
import { buildProductionRoleSystemPrompt } from './production-role.prompts';
import { getPromptVersion } from '../../rag/prompts/prompt-registry';
import { countTextTokens } from '../document/chunking.util';

const roleSchema = z.object({
  summary: z.string().min(1).max(4_000),
  deliverables: z
    .array(
      z.object({
        type: z.string().min(1).max(64),
        title: z.string().min(1).max(256),
        markdown: z.string().min(20).max(30_000),
      }),
    )
    .min(1)
    .max(4),
  claims: z
    .array(
      z.object({
        statement: z.string().min(1).max(2_000),
        evidenceIds: z.array(z.string().min(1)).max(8),
        status: z.enum(['supported', 'pending_confirmation']),
      }),
    )
    .max(20),
  issues: z.array(z.string().min(1)).max(12),
  downstreamRisks: z.array(z.string().min(1)).max(12),
  riskLevel: z.enum(['low', 'medium', 'high']),
  readyForApproval: z.boolean(),
  lowCodeSchemas: z
    .array(
      z.object({
        schemaVersion: z.literal(1),
        role: z.enum(PRODUCTION_ROLES),
        kind: z.enum([
          'pageSchema',
          'apiSchema',
          'trackingSchema',
          'validationSchema',
          'acceptanceSchema',
        ]),
        title: z.string().min(1).max(256),
        source: z.enum(['llm', 'fallback']).optional(),
        components: z.array(z.record(z.string(), z.unknown())).optional(),
        apis: z.array(z.record(z.string(), z.unknown())).optional(),
        events: z.array(z.record(z.string(), z.unknown())).optional(),
        rules: z.array(z.record(z.string(), z.unknown())).optional(),
        checks: z.array(z.record(z.string(), z.unknown())).optional(),
        notes: z.array(z.string().max(500)).optional(),
      }),
    )
    .max(8)
    .optional(),
});

const WORKFLOW_INPUT_SAFETY_RATIO = 0.1;
const WORKFLOW_MIN_INPUT_SAFETY_TOKENS = 256;
const WORKFLOW_EVIDENCE_EXCERPT_CHAR_BUDGET = 1_200;

interface ProductionPreviousRoleContext {
  role: ProductionRole;
  summary: string;
  deliverables: Array<{ type: string; title: string; markdownExcerpt: string }>;
  claims: ProductionClaim[];
  issues: string[];
  downstreamRisks: string[];
  riskLevel: ProductionRiskLevel;
}

const projectFileSchema = z.object({
  path: z
    .string()
    .regex(/^[A-Za-z0-9_.\-/]+$/)
    .max(180),
  content: z.string().max(80_000),
  purpose: z.string().max(500),
});

const projectSchema = z.object({
  projectName: z.string().min(1).max(120),
  framework: z.string().min(1).max(120),
  files: z.array(projectFileSchema).min(3).max(30),
  runCommand: z.string().min(1).max(300),
  notes: z.array(z.string().max(500)).max(12),
});

const RISK_RANK: Record<ProductionRiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const ROLE_LLM_TIMEOUT_MS = 75_000;
const ROLE_LLM_RETRY_BACKOFF_MS = 1_000;
const WORKFLOW_CANCEL_MARKER_TTL_SECONDS = 24 * 60 * 60;

interface WorkflowApprovalCheckpointIdentity {
  runId: string;
  batchIndex: number;
  stepCount: number;
  revisionNumber: number;
  currentBatch: ProductionRole[];
  pendingApprovalRoles: ProductionRole[];
}

type ResumeWorkflowJobWithCheckpoint = Extract<
  ProductionWorkflowJob,
  { operation: 'resume' }
> & {
  approvalCheckpointIdentity: WorkflowApprovalCheckpointIdentity;
};

class ProductionWorkflowCancelledError extends Error {
  constructor(message = '用户取消工作流') {
    super(message);
    this.name = 'ProductionWorkflowCancelledError';
  }
}

@Injectable()
export class ProductionWorkflowService implements OnModuleInit {
  /**
   * 产研运任务的状态机编排器：负责状态、依赖、审批与审计，不在控制器中直接执行岗位逻辑。
   * `threadId` 是恢复、驳回局部重跑和 Artifact 版本关联的稳定主键。
   */
  private readonly logger = new Logger(ProductionWorkflowService.name);
  private readonly checkpointer: RedisCheckpointer;
  private readonly app: ReturnType<ProductionWorkflowService['buildGraph']>;
  private readonly activeRuns = new Map<string, Promise<void>>();
  private readonly cancellationControllers = new Map<string, AbortController>();
  private readonly lostLeases = new Set<string>();
  private readonly rejectionOperations = new Set<string>();
  private readonly pendingStates = new Map<
    string,
    ProductionWorkflowStateType
  >();
  private readonly workflowIndexMemory = new Map<
    string,
    Record<string, unknown>
  >();

  constructor(
    private readonly llmProvider: LlmProvider,
    private readonly redisProvider: RedisProvider,
    private readonly roleTools: ProductionWorkflowTools,
    private readonly artifacts: ArtifactsService,
    @Optional() private readonly langfuseProvider?: LangfuseProvider,
    @Optional() private readonly collaboration?: AgentCollaborationService,
    @Optional() private readonly tasks?: AgentTasksService,
    @Optional() private readonly runtimeEvents?: AgentRuntimeEventsService,
    @Optional() private readonly toolPolicy?: ToolExecutionPolicyService,
    @Optional() private readonly toolExecution?: ToolExecutionService,
    @Optional() private readonly agentRuns?: AgentRunsService,
    @Optional() private readonly agentGoals?: AgentGoalService,
    @Optional() private readonly plugins?: PluginRuntimeService,
    @Optional() private readonly domainEvents?: DomainEventsService,
    @Optional() private readonly dingTalk?: DingTalkProvider,
    @Optional()
    private readonly workflowQueue?: ProductionWorkflowQueueService,
    @Optional() private readonly configService?: ConfigService,
  ) {
    this.checkpointer = new RedisCheckpointer(
      redisProvider,
      86400 * 30,
      undefined,
      configService?.get<boolean>('core.requireDependencies') === true ||
        configService?.get<string>('nodeEnv') === 'production',
    );
    this.app = this.buildGraph();
  }

  onModuleInit(): void {
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

  private async dispatchRetryTask(task: {
    id: string;
    threadId: string;
    role: string;
    retryCount: number;
  }): Promise<void> {
    const state = await this.getState(task.threadId);
    if (!state?.projectId) throw new Error('workflow not found');
    if (this.workflowQueue?.isEnabled()) {
      const queued = await this.workflowQueue.enqueue({
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

  private async retryTask(task: {
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
        throw new Error(
          '审批重试任务缺少原始检查点身份，拒绝重新应用审批。',
        );
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
        throw new Error(
          '审批任务与当前待审批批次不匹配，拒绝应用旧审批。',
        );
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
    if (allowCheckpointRecovery && queueAttempt > 1 && !approvalCheckpointIdentity) {
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
      if (dto.approval === 'rejected' && current.status === 'revision_required') {
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
      approvalCheckpointIdentity: this.captureApprovalCheckpointIdentity(current),
    };
    const queued = await this.enqueueWorkflowJob(queuedJob);
    if (!queued && !this.workflowQueue?.isRequired?.()) {
      this.schedule(threadId, userId, () =>
        this.resume(threadId, dto, userId, tenantId),
      );
    }
    return this.view(threadId, pending, userId);
  }

  private captureApprovalCheckpointIdentity(
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

  private matchesApprovalCheckpoint(
    state: ProductionWorkflowStateType,
    identity: WorkflowApprovalCheckpointIdentity,
  ): boolean {
    return (
      state.runId === identity.runId &&
      state.batchIndex === identity.batchIndex &&
      state.stepCount === identity.stepCount &&
      (state.revisionNumber ?? 1) === identity.revisionNumber &&
      this.sameRoles(state.currentBatch, identity.currentBatch) &&
      this.sameRoles(
        state.pendingApprovalRoles,
        identity.pendingApprovalRoles,
      )
    );
  }

  private approvalCheckpointHasAdvanced(
    state: ProductionWorkflowStateType,
    identity: WorkflowApprovalCheckpointIdentity,
  ): boolean {
    if (
      state.runId !== identity.runId ||
      !identity.currentBatch.every((role) => state.completedRoles.includes(role))
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

  private approvalCheckpointIsRunningInPlace(
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

  private sameRoles(left: ProductionRole[], right: ProductionRole[]): boolean {
    return (
      left.length === right.length &&
      left.every((role, index) => role === right[index])
    );
  }

  private async finalizeApprovedCheckpoint(
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
    if (
      current.status !== 'revision_required' &&
      !recoveringRunningRevision
    ) {
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
        dto.supplementalMaterials?.trim() ?? current.supplementalMaterials ?? '';
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
      throw new Error('工作流正在其他执行器中运行，Redis 不可用时无法安全取消。');
    }

    this.cancellationControllers
      .get(threadId)
      ?.abort(new ProductionWorkflowCancelledError(cancelReason));

    if (state.status !== 'running') {
      state = await this.persistWorkflowCancelled(threadId, state, cancelReason);
    }
    return {
      ...this.view(threadId, state, userId),
      cancellationRequested: state.status !== 'cancelled',
    };
  }

  async status(threadId: string, userId: string, tenantId?: string) {
    let state: ProductionWorkflowStateType;
    try {
      state = await this.getOwnedState(threadId, userId, tenantId);
    } catch (error) {
      const pending = this.pendingStates.get(threadId);
      if (
        !pending ||
        pending.userId !== userId ||
        !this.tenantMatches(pending.tenantId, tenantId)
      )
        throw error;
      state = pending;
    }
    // 持久队列启用后由 BullMQ Worker 推进，状态查询不能再抢占为本进程执行，
    // 否则会与 Worker 产生同一 Checkpoint 的并发推进。
    if (
      state.status === 'running' &&
      !this.activeRuns.has(threadId) &&
      !this.workflowQueue?.isEnabled() &&
      !this.workflowQueue?.isRequired?.()
    ) {
      this.schedule(threadId, userId, () =>
        this.runUntilSettled(threadId, state),
      );
    }
    const result = this.view(threadId, state, userId);
    void this.saveWorkflowIndexBestEffort(result);
    return result;
  }

  async list(userId: string, tenantId?: string) {
    const ids = await this.redisProvider.zrange(
      `production:workflows:${userId}`,
      0,
      -1,
      'REV',
    );
    const items = await Promise.all(
      ids.map((threadId) =>
        this.redisProvider.get(this.workflowIndexKey(userId, threadId)),
      ),
    );
    const redisItems = items
      .filter((item): item is string => Boolean(item))
      .map((item) => JSON.parse(item) as Record<string, unknown>)
      .filter((item) => this.tenantMatches(item.tenantId, tenantId));
    const memoryItems = [...this.workflowIndexMemory.values()].filter(
      (item) =>
        item.userId === userId && this.tenantMatches(item.tenantId, tenantId),
    );
    const merged = new Map<string, Record<string, unknown>>();
    [...redisItems, ...memoryItems].forEach((item) => {
      const threadId = String(item.threadId ?? '');
      if (threadId) merged.set(threadId, item);
    });
    const workflows = [...merged.values()].sort((a, b) =>
      String(b.updatedAt).localeCompare(String(a.updatedAt)),
    );
    await Promise.all(
      workflows.map((item) => this.ensureIndexedRun(item, userId)),
    );
    return workflows;
  }

  async codingContext(threadId: string, userId: string, tenantId?: string) {
    const state = await this.getOwnedState(threadId, userId, tenantId);
    if (state.status !== 'completed') {
      throw new Error(`workflow is not completed: ${state.status}`);
    }
    const stages = state.selectedRoles
      .map((role) => state.results[role])
      .filter((result): result is ProductionStageResult => Boolean(result));
    const notReady = stages.filter(
      (result) =>
        result.reviewStatus !== 'approved' || !result.readyForApproval,
    );
    if (stages.length !== state.selectedRoles.length || notReady.length > 0) {
      const roles = [
        ...state.selectedRoles.filter((role) => !state.results[role]),
        ...notReady.map((result) => result.role),
      ];
      throw new Error(
        `workflow handoff is not accepted for export: ${[...new Set(roles)].join(', ')}`,
      );
    }
    return {
      threadId: state.threadId,
      projectId: state.projectId,
      status: state.status,
      selectedRoles: state.selectedRoles,
      completedRoles: state.completedRoles,
      brief: state.brief,
      stages: stages.map((result) => ({
        role: result.role,
        revision: result.revision,
        reviewStatus: result.reviewStatus,
        summary: result.summary,
        riskLevel: result.riskLevel,
        evidenceCoverage: result.evidenceCoverage,
        claims: result.claims,
        issues: result.issues,
        downstreamRisks: result.downstreamRisks,
        deliverables: result.deliverables,
        evidence: result.evidence,
        generatedArtifact: result.generatedArtifact,
        lowCodeSchemas: result.lowCodeSchemas,
      })),
    };
  }

  /** 管理端任务重跑前的租户边界校验；不新增任务表 owner 列，直接复用工作流状态 owner。 */
  async assertOwnedThread(threadId: string, userId: string): Promise<void> {
    await this.getOwnedState(threadId, userId);
  }

  /** 页面目录导出、项目 ZIP 和 MCP 共同消费的唯一交接契约。 */
  async handoffManifest(threadId: string, userId: string, tenantId?: string) {
    const context = await this.codingContext(threadId, userId, tenantId);
    const schemas = context.stages.flatMap((stage) =>
      (stage.lowCodeSchemas ?? []).map((schema) => ({
        ...schema,
        role: stage.role,
      })),
    );
    const citations = context.stages.flatMap((stage) =>
      (stage.evidence ?? []).map((evidence) => ({
        role: stage.role,
        ...evidence,
      })),
    );
    const stages = context.stages.map((stage) => ({
      role: stage.role,
      revision: stage.revision,
      reviewStatus: stage.reviewStatus,
      evidenceCoverage: stage.evidenceCoverage,
      generatedArtifact: stage.generatedArtifact,
      deliverables: stage.deliverables.map((item) => ({
        type: item.type,
        title: item.title,
        sha256: this.handoffHash(item.markdown),
      })),
      schemaSha256: this.handoffHash(
        JSON.stringify(stage.lowCodeSchemas ?? []),
      ),
      evidenceSha256: this.handoffHash(JSON.stringify(stage.evidence ?? [])),
    }));
    const markdown = this.buildHandoffMarkdown(context);
    const contentHash = this.handoffHash(
      JSON.stringify({
        threadId: context.threadId,
        projectId: context.projectId,
        stages,
        markdown,
      }),
    );
    return {
      formatVersion: 1,
      artifactName: `${context.projectId}-handoff`,
      threadId: context.threadId,
      projectId: context.projectId,
      contentHash,
      context,
      manifest: {
        contentHash,
        selectedRoles: context.selectedRoles,
        completedRoles: context.completedRoles,
        stages,
      },
      markdown,
      schemas,
      citations,
    };
  }

  async playwayPreview(threadId: string, userId: string, tenantId?: string) {
    const context = await this.codingContext(threadId, userId, tenantId);
    const schemas = context.stages.flatMap(
      (stage) => stage.lowCodeSchemas ?? [],
    );
    return renderPlaywayPreview(schemas, context.projectId, context.brief);
  }

  async generateProject(threadId: string, userId: string, tenantId?: string) {
    const context = await this.codingContext(threadId, userId, tenantId);
    const run = await this.agentRuns?.findLatestByThread(threadId);
    const handoff = context.stages
      .map(
        (stage) =>
          `${stage.role}\n${stage.summary}\n\n结构化 Schema：\n${JSON.stringify(stage.lowCodeSchemas ?? []).slice(0, 12_000)}\n\n${stage.deliverables.map((item) => `## ${item.title}\n${item.markdown.slice(0, 12_000)}`).join('\n\n')}`,
      )
      .join('\n\n');
    const messages = [
      {
        role: 'system',
        content:
          '你是资深前端工程师。只返回一个 JSON 对象，不要返回解释文字、Markdown 围栏或只返回 notes。JSON 必须严格包含且只能包含这些字段：projectName（字符串）、framework（字符串）、files（数组）、runCommand（字符串）、notes（字符串数组）。files 至少 4 项，每项必须包含 path、content、purpose 三个字段；content 必须是完整可运行源码，不能用省略号代替。优先生成 React + Vite + TypeScript；不确定的后端接口使用 mock 数据并在 notes 数组说明。文件路径必须是相对路径，禁止绝对路径、..、node_modules 和二进制文件。',
      },
      {
        role: 'user',
        content: `活动：${context.projectId}\n需求背景：${context.brief.slice(0, 8_000)}\n\n已审批岗位交付物和低代码 Schema：\n${handoff.slice(0, 80_000)}\n\n现在只输出 JSON。必须优先参考 pageSchema、apiSchema、trackingSchema、validationSchema 和 acceptanceSchema 生成代码；必须生成 package.json、index.html、src/main.tsx 或 src/main.jsx、主要页面和样式文件。`,
      },
    ];
    const generate = async (signal?: AbortSignal) => {
      let lastError: unknown;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const output = await this.llmProvider.runWithSignal(signal, () =>
            this.llmProvider
              .getModel()
              .withStructuredOutput(projectSchema, { method: 'jsonMode' })
              .invoke(messages),
          );
          const normalized = {
            ...output,
            notes: Array.isArray(output.notes)
              ? output.notes
              : [String(output.notes ?? '')].filter(Boolean),
          };
          return this.validateGeneratedProject({
            ...normalized,
            activityName: context.projectId,
            sourceThreadId: context.threadId,
          });
        } catch (error) {
          lastError = error;
          if (attempt === 1)
            messages.push({
              role: 'user',
              content:
                '上一次输出不符合 JSON schema 或无法运行。请重新输出完整 JSON，禁止只返回 notes；files 必须是包含完整源码的数组，package.json 要有 dev 与 build 脚本，入口文件要实际挂载页面。',
            });
        }
      }
      throw new Error(
        `项目代码结构化生成失败：${lastError instanceof Error ? lastError.message : String(lastError)}`,
      );
    };
    const execution = this.toolExecution
      ? await this.toolExecution.execute({
          toolName: 'artifact_generate',
          threadId,
          runId: run?.id,
          ownerUserId: userId,
          mode: 'production',
          actor: 'code_delivery',
          input: {
            projectId: context.projectId,
            stageCount: context.stages.length,
            type: 'runnable_project',
          },
          approvalPolicy: 'auto',
          approvalGranted: true,
          execute: (signal) => generate(signal),
        })
      : {
          status: 'success' as const,
          output: await executeWithToolTimeout(
            'artifact_generate',
            getRegisteredToolTimeoutMs('artifact_generate'),
            (signal) => generate(signal),
          ),
          durationMs: 0,
        };
    if (!execution.output)
      throw new Error(
        ('error' in execution ? execution.error : undefined) ??
          '项目代码生成未完成，请在运行中心查看工具执行记录。',
      );
    return execution.output;
  }

  async generateProjectZip(
    threadId: string,
    userId: string,
    tenantId?: string,
  ): Promise<Buffer> {
    const handoff = await this.handoffManifest(threadId, userId, tenantId);
    const context = handoff.context;
    const generated = await this.generateProject(threadId, userId, tenantId);
    const zip = new JSZip();
    generated.files.forEach((file) => zip.file(file.path, file.content));
    zip.file(
      'RAG_WORKFLOW_CONTEXT.json',
      JSON.stringify({ ...context, generatedProject: generated }, null, 2),
    );
    zip.file(
      'HANDOFF_MANIFEST.json',
      JSON.stringify(handoff.manifest, null, 2),
    );
    zip.file(
      'LOW_CODE_SCHEMAS.json',
      JSON.stringify(
        context.stages.flatMap((stage) => stage.lowCodeSchemas ?? []),
        null,
        2,
      ),
    );
    const evidence = context.stages.flatMap((stage) =>
      (stage.evidence ?? []).map((item) => ({ role: stage.role, ...item })),
    );
    zip.file('RAG_EVIDENCE.json', JSON.stringify(evidence, null, 2));
    zip.file('RAG_EVIDENCE.md', this.buildEvidenceMarkdown(evidence));
    zip.file('HANDOFF.md', handoff.markdown);
    zip.file(
      'README.md',
      `# ${generated.projectName}\n\n框架：${generated.framework}\n\n启动：\`${generated.runCommand}\`\n\n${generated.notes.map((note) => `- ${note}`).join('\n')}\n`,
    );
    zip.file(
      'DELIVERY_VERIFICATION.json',
      JSON.stringify(this.deliveryVerification(generated), null, 2),
    );
    context.stages.forEach((stage) => {
      if ((stage.lowCodeSchemas ?? []).length > 0) {
        zip.file(
          `schemas/${stage.role}.json`,
          JSON.stringify(stage.lowCodeSchemas, null, 2),
        );
      }
      stage.deliverables.forEach((deliverable, index) => {
        const safeTitle = deliverable.title.replace(/[\\/:*?"<>|]/g, '-');
        zip.file(
          `handoff/${stage.role}/${String(index + 1).padStart(2, '0')}-${safeTitle}.md`,
          deliverable.markdown,
        );
      });
    });
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  private buildHandoffMarkdown(
    context: Awaited<ReturnType<ProductionWorkflowService['codingContext']>>,
  ): string {
    const stages = context.stages.map((stage) =>
      [
        `## ${stage.role}`,
        stage.summary,
        ...stage.deliverables.map(
          (item) => `### ${item.title}\n\n${item.markdown}`,
        ),
      ].join('\n\n'),
    );
    return [
      `# ${context.projectId} 产研运交接包`,
      '本文件供 Codex、Claude、Cursor 等 AI Coding 工具读取。结构化 Schema 见 `LOW_CODE_SCHEMAS.json` 或 `schemas/`，引用证据见 `RAG_EVIDENCE.md`。',
      ...stages,
    ].join('\n\n');
  }

  private buildEvidenceMarkdown(
    evidence: Array<ProductionEvidence & { role: string }>,
  ): string {
    const lines = evidence.map(
      (item) =>
        `- [${item.role}] ${item.id}：文档 ${item.docId}／片段 ${item.chunkIndex}／评分 ${item.totalScore}\n  - ${item.excerpt}`,
    );
    return [
      '# RAG 引用证据',
      lines.length > 0
        ? lines.join('\n')
        : '本次工作流未检索到可引用的 RAG 证据。',
    ].join('\n\n');
  }

  private handoffHash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private async createInitialState(
    dto: StartProductionWorkflowDto,
    userId: string,
    threadId: string,
    tenantId?: string,
  ): Promise<ProductionWorkflowStateType> {
    const selectedRoles = normalizeProductionRoles(dto.roles);
    const composition = this.plugins
      ? await this.plugins.resolve(dto.pluginKeys, 'production', [
          'workflow.production-base',
        ])
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

  private async initializeTasks(
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

  private async ensureRun(state: ProductionWorkflowStateType): Promise<void> {
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

  private async ensureIndexedRun(
    item: Record<string, unknown>,
    userId: string,
  ): Promise<void> {
    if (!this.agentRuns) return;
    const threadId = String(item.threadId ?? '');
    if (!threadId || (await this.agentRuns.findLatestByThread(threadId)))
      return;
    const selectedRoles = Array.isArray(item.selectedRoles)
      ? item.selectedRoles
      : [];
    const completedRoles = Array.isArray(item.completedRoles)
      ? item.completedRoles
      : [];
    const status = String(item.status ?? 'running');
    const projectId = String(item.projectId ?? '未命名活动');
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
      objective: String(item.brief ?? projectId),
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
            ? String(
                item.error ??
                  (status === 'cancelled' ? '用户取消工作流' : '历史工作流失败'),
              )
            : undefined,
        cancelledAt: status === 'cancelled' ? new Date() : undefined,
        cancelReason:
          status === 'cancelled'
            ? String(item.error ?? '用户取消工作流')
            : undefined,
        resultSummary: `${projectId}：历史工作流补建运行记录，已完成 ${completedRoles.length}/${selectedRoles.length} 个岗位。`,
      });
    }
  }

  private schedule(
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
  private workflowJobId(
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

  private async markScheduledFailure(
    threadId: string,
    userId: string,
    error: unknown,
  ): Promise<void> {
    const message =
      (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
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

  private async enqueueWorkflowJob(
    job: ProductionWorkflowJob,
  ): Promise<boolean> {
    try {
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

  private assertLeaseOwned(threadId: string): void {
    const signal = this.cancellationControllers.get(threadId)?.signal;
    if (signal?.aborted) throw this.cancellationError(signal.reason);
    if (this.lostLeases.has(threadId)) {
      throw new Error('production workflow lease was lost');
    }
  }

  private cancellationError(reason: unknown): Error {
    if (reason instanceof ProductionWorkflowCancelledError) return reason;
    return reason instanceof Error
      ? reason
      : new Error('工作流取消状态检查失败，已停止继续执行。');
  }

  private workflowCancelKey(threadId: string): string {
    return `production:workflow:cancel:${threadId}`;
  }

  private buildGraph() {
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

  private async prepareNode(
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

  private async executeBatchNode(
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

  private async runRole(
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
        const output = await this.llmProvider.runWithSignal(
          requestSignal,
          () =>
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

  private async budgetRoleInput(
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

  private getWorkflowInputTokenBudget(): number {
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
          Number(this.configService?.get<number>(`llm.${provider}.maxTokens`)) ||
            4_096,
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

  private async recordRoleHandoff(
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

  private degradedRoleResult(
    role: ProductionRole,
    state: ProductionWorkflowStateType,
    toolResult: Awaited<ReturnType<ProductionWorkflowTools['gather']>>,
    error: Error | null,
  ): ProductionStageResult {
    const evidenceList = toolResult.evidence.length
      ? toolResult.evidence
          .map((item) => `- [${item.id}] ${item.docId}：${item.excerpt}`)
          .join('\n')
      : '- 当前没有检索到可用证据。';
    return {
      role,
      revision: state.revisionNumber ?? 1,
      reviewStatus: 'pending',
      summary: `${role} 节点模型调用失败，已生成证据保全版交付物，待人工补充。`,
      deliverables: [
        {
          type: 'degraded-review',
          title: `${state.projectId}-${role}-降级交付物`,
          markdown: [
            `# ${state.projectId} ${role} 降级交付物`,
            '',
            '## 当前状态',
            '',
            '结构化模型调用未在预算内完成。本文件只保留任务背景和已检索证据，不生成未经证实的业务结论。',
            '',
            '## 任务背景',
            '',
            state.brief,
            '',
            '## 已检索证据',
            '',
            evidenceList,
            '',
            '## 后续动作',
            '',
            '- 由当前岗位负责人核对证据并补齐结论。',
            '- 修复模型调用后，只重跑当前岗位。',
          ].join('\n'),
        },
      ],
      claims: [
        {
          statement: '当前岗位结论尚未完成人工或模型确认。',
          evidenceIds: [],
          status: 'pending_confirmation',
        },
      ],
      evidence: toolResult.evidence,
      evidenceCoverage: 0,
      issues: [error?.message ?? 'structured model output unavailable'],
      downstreamRisks: ['下游不得把本岗位降级交付物视为已确认结论。'],
      riskLevel: 'high',
      toolExecutions: toolResult.executions,
      lowCodeSchemas: this.normalizeLowCodeSchemas(role, state, []),
      readyForApproval: false,
      completedAt: new Date().toISOString(),
    };
  }

  private validateClaims(
    claims: ProductionClaim[],
    evidence: ProductionStageResult['evidence'],
  ): ProductionClaim[] {
    const allowedIds = new Set(evidence.map((item) => item.id));
    return claims.map((claim) => {
      const evidenceIds = claim.evidenceIds.filter((id) => allowedIds.has(id));
      return {
        ...claim,
        evidenceIds,
        status:
          claim.status === 'supported' && evidenceIds.length > 0
            ? 'supported'
            : 'pending_confirmation',
      };
    });
  }

  private evidenceCoverage(claims: ProductionClaim[]): number {
    if (claims.length === 0) return 1;
    const supported = claims.filter(
      (claim) => claim.status === 'supported',
    ).length;
    return Number((supported / claims.length).toFixed(4));
  }

  private sleep(durationMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  }

  private async publishRoleArtifact(
    state: ProductionWorkflowStateType,
    result: ProductionStageResult,
  ) {
    this.assertLeaseOwned(state.threadId);
    const startedAt = Date.now();
    const authorization = this.toolPolicy?.decide('artifact_generate', {
      mode: 'production',
      role: result.role,
      pluginKeys: state.pluginKeys,
      allowedToolNames: state.pluginTools,
    });
    if (authorization && !authorization.allowed) {
      result.toolExecutions.push({
        tool: 'artifact_generate',
        status: 'blocked',
        durationMs: Date.now() - startedAt,
        evidenceCount: 0,
        fallback: '交付内容保留在工作流状态中，等待管理员修正工具授权。',
        error: authorization.reason,
      });
      await this.emitRuntimeEvent(state, 'policy.denied', result.role, {
        tool: 'artifact_generate',
        reason: authorization.reason,
      });
      return undefined;
    }
    const sourceText = this.renderDeliverables(
      result.deliverables,
      result.claims,
      result.lowCodeSchemas,
    );
    try {
      const execution = this.toolExecution
        ? await this.toolExecution.execute({
            toolName: 'artifact_generate',
            threadId: state.threadId,
            runId: state.runId || undefined,
            ownerUserId: state.userId,
            mode: 'production',
            role: result.role,
            actor: result.role,
            pluginKeys: state.pluginKeys,
            allowedToolNames: state.pluginTools,
            input: {
              title: `${state.projectId}-${result.role}-交付物`,
              size: sourceText.length,
            },
            // 岗位交付物只写入受权限保护的内部 Artifact；它是否继续流转由后续岗位审批门禁决定。
            approvalPolicy: 'auto',
            approvalGranted: true,
            sideEffect: true,
            idempotencyKey: `workflow-artifact:${state.threadId}:${result.role}:${this.contentHash(sourceText)}`,
            execute: () =>
              this.artifacts.create({
                ownerUserId: state.userId,
                threadId: state.threadId,
                title: `${state.projectId}-${result.role}-交付物`,
                kind: 'markdown',
                sourceText,
              }),
          })
        : {
            status: 'success' as const,
            output: await executeWithToolTimeout(
              'artifact_generate',
              getRegisteredToolTimeoutMs('artifact_generate'),
              () =>
                this.artifacts.create({
                  ownerUserId: state.userId,
                  threadId: state.threadId,
                  title: `${state.projectId}-${result.role}-交付物`,
                  kind: 'markdown',
                  sourceText,
                }),
            ),
            durationMs: Date.now() - startedAt,
          };
      if (!execution.output)
        throw new Error(
          ('error' in execution ? execution.error : undefined) ??
            '交付物等待审批或执行结果未知。',
        );
      const artifact = execution.output;
      result.toolExecutions.push({
        tool: 'artifact_generate',
        status: 'success',
        durationMs: execution.durationMs,
        evidenceCount: 0,
      });
      return {
        id: String(artifact.id),
        title: String(artifact.title),
        kind: String(artifact.kind),
        status: String(artifact.status),
      };
    } catch (error) {
      result.toolExecutions.push({
        tool: 'artifact_generate',
        status: 'failed',
        durationMs: Date.now() - startedAt,
        evidenceCount: 0,
        fallback: '交付内容保留在工作流结果中，可稍后重新生成文件。',
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private renderDeliverables(
    deliverables: ProductionDeliverable[],
    claims: ProductionClaim[],
    lowCodeSchemas: ProductionLowCodeSchema[] = [],
  ): string {
    const sections = deliverables.map(
      (item) => `# ${item.title}\n\n${item.markdown}`,
    );
    const claimLines = claims.map(
      (claim) =>
        `- [${claim.status}] ${claim.statement}${
          claim.evidenceIds.length
            ? `（证据：${claim.evidenceIds.join('、')}）`
            : ''
        }`,
    );
    const schemaSection =
      lowCodeSchemas.length > 0
        ? [
            '# 低代码 / AI Coding 结构化 Schema',
            '```json',
            JSON.stringify(lowCodeSchemas, null, 2),
            '```',
          ]
        : [];
    return [
      ...sections,
      ...schemaSection,
      '# 事实声明与证据',
      ...claimLines,
    ].join('\n\n');
  }

  private normalizeLowCodeSchemas(
    role: ProductionRole,
    state: ProductionWorkflowStateType,
    input: unknown,
  ): ProductionLowCodeSchema[] {
    const rawSchemas = Array.isArray(input) ? input : [];
    const normalized = rawSchemas
      .map((item) => this.normalizeLowCodeSchemaItem(role, item))
      .filter((item): item is ProductionLowCodeSchema => Boolean(item));
    return normalized.length > 0
      ? normalized
      : this.defaultLowCodeSchemas(role, state);
  }

  private normalizeLowCodeSchemaItem(
    role: ProductionRole,
    item: unknown,
  ): ProductionLowCodeSchema | null {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const kind = String(record.kind ?? '') as ProductionLowCodeSchemaKind;
    if (
      ![
        'pageSchema',
        'apiSchema',
        'trackingSchema',
        'validationSchema',
        'acceptanceSchema',
      ].includes(kind)
    ) {
      return null;
    }
    const ownerRole = PRODUCTION_ROLES.includes(record.role as ProductionRole)
      ? (record.role as ProductionRole)
      : role;
    return {
      schemaVersion: 1,
      role: ownerRole,
      kind,
      title: String(record.title ?? `${ownerRole}-${kind}`),
      source: record.source === 'fallback' ? 'fallback' : 'llm',
      components: this.recordArray(record.components),
      apis: this.recordArray(record.apis),
      events: this.recordArray(record.events),
      rules: this.recordArray(record.rules),
      checks: this.recordArray(record.checks),
      notes: Array.isArray(record.notes)
        ? record.notes.map((note) => String(note)).slice(0, 12)
        : [],
    };
  }

  private recordArray(value: unknown): Array<Record<string, unknown>> {
    return Array.isArray(value)
      ? value
          .filter(
            (item) => item && typeof item === 'object' && !Array.isArray(item),
          )
          .map((item) => item as Record<string, unknown>)
      : [];
  }

  private defaultLowCodeSchemas(
    role: ProductionRole,
    state: ProductionWorkflowStateType,
  ): ProductionLowCodeSchema[] {
    const base = {
      schemaVersion: 1 as const,
      role,
      source: 'fallback' as const,
    };
    if (role === 'backend') {
      return [
        {
          ...base,
          kind: 'apiSchema',
          title: `${state.projectId} 接口契约 Schema`,
          apis: [
            {
              name: 'activityInfo',
              method: 'GET',
              path: `/api/${state.projectId}/info`,
              purpose: '读取活动基础信息、时间、状态和页面配置。',
              request: { query: ['activityId'] },
              response: { code: 'number', data: 'ActivityInfo' },
            },
          ],
          notes: [
            '模型未返回接口 Schema 时由系统兜底生成，供 AI Coding 起步。',
          ],
        },
      ];
    }
    if (role === 'qa') {
      return [
        {
          ...base,
          kind: 'acceptanceSchema',
          title: `${state.projectId} 测试验收 Schema`,
          checks: [
            {
              id: 'happy-path',
              name: '主流程可完成',
              expected: '用户能从活动入口进入、完成核心交互并看到结果反馈。',
              status: 'pending_confirmation',
            },
          ],
          notes: [
            '模型未返回验收 Schema 时由系统兜底生成，后续人工补齐真实用例。',
          ],
        },
      ];
    }
    if (role === 'operations') {
      return [
        {
          ...base,
          kind: 'trackingSchema',
          title: `${state.projectId} 运营埋点 Schema`,
          events: [
            {
              eventId: 'activity_page_view',
              trigger: '活动页面曝光',
              params: ['activityId', 'channel', 'region'],
            },
          ],
          notes: [
            '模型未返回埋点 Schema 时由系统兜底生成，后续对齐埋点平台字段。',
          ],
        },
      ];
    }
    return [
      {
        ...base,
        kind: 'pageSchema',
        title: `${state.projectId} 页面结构 Schema`,
        components: [
          {
            id: 'activity-root',
            type: 'page',
            name: '活动主页面',
            children: ['hero', 'rule', 'cta'],
          },
          { id: 'hero', type: 'section', name: '首屏视觉与活动入口' },
          { id: 'rule', type: 'section', name: '活动规则说明' },
          { id: 'cta', type: 'button', name: '核心行动按钮' },
        ],
        notes: [
          '模型未返回页面 Schema 时由系统兜底生成，保证下游代码生成有结构输入。',
        ],
      },
      {
        ...base,
        kind: 'validationSchema',
        title: `${state.projectId} 前置校验 Schema`,
        rules: [
          {
            field: 'activityId',
            rule: 'required',
            message: '必须带活动 ID，避免多活动共用页面时串配置。',
          },
        ],
      },
    ];
  }

  private contentHash(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 32);
  }

  private validateGeneratedProject<
    T extends {
      files: Array<{ path: string; content: string }>;
      runCommand: string;
    },
  >(project: T): T {
    const paths = new Set(project.files.map((file) => file.path));
    const packageFile = project.files.find(
      (file) => file.path === 'package.json',
    );
    const entryFile = project.files.find((file) =>
      /^src\/main\.(tsx|jsx)$/.test(file.path),
    );
    if (!packageFile || !entryFile || !paths.has('index.html'))
      throw new Error(
        '生成代码缺少 package.json、index.html 或 src/main.tsx／src/main.jsx。',
      );
    let packageJson: { scripts?: Record<string, string> };
    try {
      packageJson = JSON.parse(packageFile.content) as {
        scripts?: Record<string, string>;
      };
    } catch {
      throw new Error('生成的 package.json 不是合法 JSON。');
    }
    if (!packageJson.scripts?.dev || !packageJson.scripts?.build)
      throw new Error('生成的 package.json 缺少 dev 或 build 脚本。');
    if (!/createRoot|ReactDOM\.render/.test(entryFile.content))
      throw new Error('项目入口没有挂载 React 页面。');
    if (
      project.files.some(
        (file) => file.path.includes('..') || file.path.startsWith('/'),
      )
    )
      throw new Error('项目文件路径不安全。');
    return project;
  }

  private deliveryVerification(project: {
    projectName: string;
    framework: string;
    files: Array<{ path: string; content: string }>;
    runCommand: string;
    sourceThreadId: string;
  }) {
    const paths = project.files.map((file) => file.path);
    return {
      schemaVersion: 1,
      status: 'static_verified',
      projectName: project.projectName,
      framework: project.framework,
      sourceThreadId: project.sourceThreadId,
      checkedAt: new Date().toISOString(),
      checks: [
        {
          name: 'required_files',
          passed:
            paths.includes('package.json') &&
            paths.includes('index.html') &&
            paths.some((path) => /^src\/main\.(tsx|jsx)$/.test(path)),
        },
        {
          name: 'safe_relative_paths',
          passed: paths.every(
            (path) => !path.includes('..') && !path.startsWith('/'),
          ),
        },
        { name: 'package_scripts', passed: true },
        { name: 'react_mount', passed: true },
      ],
      runCommand: project.runCommand,
      note: '本系统不在服务端执行模型生成代码；已完成结构、路径、入口和启动脚本静态验收。下载后请在隔离目录执行依赖安装与构建。',
    };
  }

  private requiresRoleApproval(
    role: ProductionRole,
    result: ProductionStageResult,
    state: ProductionWorkflowStateType,
  ): boolean {
    if (state.approvalMode === 'required') return true;
    if (state.approvalRoles.includes(role)) return true;
    if (state.approvalMode !== 'risk_based') return false;
    return (
      RISK_RANK[result.riskLevel] >= RISK_RANK[state.riskApprovalThreshold]
    );
  }

  private unionRoles(
    current: ProductionRole[],
    additions: ProductionRole[],
  ): ProductionRole[] {
    const included = new Set([...current, ...additions]);
    return PRODUCTION_ROLES.filter((role) => included.has(role));
  }

  private async getOwnedState(
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
  private tenantMatches(resourceTenantId?: unknown, requestedTenantId?: string) {
    const requested = requestedTenantId?.trim();
    if (!requested) return true;
    const resource = typeof resourceTenantId === 'string' ? resourceTenantId.trim() : '';
    return Boolean(resource) && resource === requested;
  }

  private async getState(threadId: string) {
    const snapshot = await this.app.getState(this.config(threadId));
    return snapshot?.values as ProductionWorkflowStateType | undefined;
  }

  private async runUntilSettled(
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

  private async persistWorkflowCancelled(
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

  private config(threadId: string) {
    return { configurable: { thread_id: `production:${threadId}` } };
  }

  private workflowIndexKey(userId: string, threadId: string) {
    return `production:workflow:${userId}:${threadId}`;
  }

  private async saveWorkflowIndex(
    view: ReturnType<ProductionWorkflowService['view']>,
  ) {
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
    this.workflowIndexMemory.set(`${view.userId}:${view.threadId}`, index);
    await this.redisProvider.set(
      this.workflowIndexKey(view.userId, view.threadId),
      JSON.stringify(index),
      86400 * 30,
    );
    await this.redisProvider.zadd(
      `production:workflows:${view.userId}`,
      Date.now(),
      view.threadId,
    );
  }

  private async saveWorkflowIndexBestEffort(
    view: ReturnType<ProductionWorkflowService['view']>,
  ): Promise<void> {
    try {
      await this.saveWorkflowIndex(view);
    } catch (error) {
      this.logger.warn(
        `production workflow ${view.threadId} index persistence failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async traceLangfuse(
    state: ProductionWorkflowStateType,
  ): Promise<void> {
    if (!this.langfuseProvider) return;
    await this.langfuseProvider.traceProductionWorkflow({
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

  private async emitWorkflowState(
    state: ProductionWorkflowStateType,
  ): Promise<void> {
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
        },
      );
      await this.emitRuntimeEvent(state, 'goal.paused', 'production_workflow', {
        objective: state.brief,
        status: 'paused',
        round: state.stepCount,
        maxRounds: state.maxSteps,
        reason: 'Artifact 已驳回，等待人工确认后启动修订。',
      });
      if (runId) {
        await this.agentRuns?.finish(runId, {
          route: 'production_workflow',
          status: 'waiting_approval',
          requiresApproval: true,
          resultSummary: `${state.projectId}：Artifact 已驳回，等待 v${state.revisionNumber} 修订。`,
        });
      }
      return;
    }
    if (state.status === 'pending_approval') {
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
        await this.agentRuns?.finish(runId, {
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
        await this.agentRuns?.finish(runId, {
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
        await this.agentRuns?.finish(runId, {
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
        await this.agentRuns?.finish(runId, {
          route: 'production_workflow',
          status: 'failed',
          errorMessage: state.error,
          resultSummary: `${state.projectId}：工作流失败。`,
        });
      }
    }
  }

  private async emitRuntimeEvent(
    state: ProductionWorkflowStateType,
    eventType: string,
    actor: string,
    payload: unknown,
  ): Promise<void> {
    if (!this.runtimeEvents) return;
    try {
      await this.runtimeEvents.emit({
        tenantId: state.tenantId,
        threadId: state.threadId,
        runId: state.runId || undefined,
        eventType,
        actor,
        target: state.projectId,
        payload,
      });
    } catch (error) {
      this.logger.warn(
        `Runtime event skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async emitDomainEvent(
    eventType: string,
    state: ProductionWorkflowStateType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.domainEvents?.emit({
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
      this.logger.warn(
        `Domain event skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private view(
    threadId: string,
    state: ProductionWorkflowStateType,
    userId: string,
  ) {
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

  private revisionAwareBrief(state: ProductionWorkflowStateType): string {
    if (!state.supplementalMaterials) return state.brief;
    return `${state.brief}\n\n本次修订的人工补充资料（待核验）：\n${state.supplementalMaterials}`;
  }

  private withRevisionPackage(
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

  private async rejectForRevision(
    threadId: string,
    current: ProductionWorkflowStateType,
    dto: ResumeProductionWorkflowDto,
    userId: string,
  ) {
    const lockKey = `production:workflow:rejection:${threadId}`;
    const lockToken = randomUUID();
    let acquiredRedisLock = false;
    if (this.redisProvider.isEnabled()) {
      acquiredRedisLock = await this.redisProvider.setIfAbsent(
        lockKey,
        lockToken,
        300,
      );
      if (!acquiredRedisLock) {
        throw new Error('workflow rejection is already being persisted');
      }
    } else {
      if (
        this.configService?.get<boolean>('core.requireDependencies') === true ||
        this.configService?.get<string>('nodeEnv') === 'production'
      ) {
        throw new Error('Redis rejection lock is required in production.');
      }
      if (this.rejectionOperations.has(threadId)) {
        throw new Error('workflow rejection is already being persisted');
      }
      this.rejectionOperations.add(threadId);
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
      this.rejectionOperations.delete(threadId);
      if (acquiredRedisLock) {
        try {
          await this.redisProvider.releaseLock(lockKey, lockToken);
        } catch (error) {
          this.logger.warn(
            `workflow rejection lock release failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  private matchesRejectedRevisionRequest(
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
      !this.sameRoles(state.rerunRoles, latest.rejectedRoles) ||
      !this.sameRoles(state.staleRoles, latest.staleRoles)
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

  private sameRoleSet(left: ProductionRole[], right: ProductionRole[]): boolean {
    return (
      left.length === right.length &&
      left.every((role) => right.includes(role))
    );
  }

  private async completeRejectedRevision(
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
      staleRoles = this.downstreamRoles(
        rejectedRoles,
        current.selectedRoles,
      );
      rejectedResults = Object.fromEntries(
        Object.entries(current.results).map(([role, result]) => [
          role,
          result
            ? {
                ...result,
                reviewStatus: rejectedRoles.includes(role as ProductionRole)
                  ? 'rejected'
                  : current.currentBatch.includes(role as ProductionRole)
                    ? 'approved'
                    : staleRoles.includes(role as ProductionRole)
                      ? 'stale'
                      : result.reviewStatus,
              }
            : result,
        ]),
      ) as ProductionWorkflowStateType['results'];
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
      await this.app.updateState(this.config(threadId), {
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
        this.tasks?.updateForRole(threadId, role, {
          status: 'revision_required',
          summary: feedback,
          approvalRequired: true,
        }),
      ),
      ...staleRoles.map((role) =>
        this.tasks?.updateForRole(threadId, role, {
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
          ? this.artifacts.markReviewState(artifactId, {
              reviewStatus,
              revision: result.revision ?? current.revisionNumber ?? 1,
              feedback,
            })
          : Promise.resolve();
      }),
    );
    // Keep the rejection marker until Task and Artifact review state has been
    // persisted, so a repeated request can complete a partial write.
    await this.app.updateState(this.config(threadId), {
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
    const state = await this.getOwnedState(threadId, userId);
    return this.finalizeRejectedRevision(threadId, state, userId);
  }

  private async finalizeRejectedRevision(
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
    await this.domainEvents?.emit({
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

    await this.emitRevisionRuntimeEventOnce(
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
    await this.emitRevisionRuntimeEventOnce(
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
    await this.emitRevisionRuntimeEventOnce(
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

    if (state.runId && this.agentRuns) {
      const run = await this.agentRuns.get(
        state.runId,
        state.tenantId ?? undefined,
      );
      const resultSummary = `${state.projectId}：Artifact 已驳回，等待 v${nextRevision} 修订。`;
      const runUpdatedEventExists = this.runtimeEvents
        ? await this.runtimeEvents.hasMatchingEvent({
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
        await this.agentRuns.finish(state.runId, {
          route: 'production_workflow',
          status: 'waiting_approval',
          requiresApproval: true,
          resultSummary,
        });
      }
    }

    const result = this.view(threadId, state, userId);
    await this.saveWorkflowIndex(result);
    return result;
  }

  private async emitRevisionRuntimeEventOnce(
    state: ProductionWorkflowStateType,
    eventType: string,
    actor: string,
    payload: Record<string, unknown>,
    revisionField: 'revision' | 'nextRevision',
    revision: number,
  ): Promise<void> {
    if (!this.runtimeEvents) return;
    const events = await this.runtimeEvents.list(
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
    await this.runtimeEvents.emit({
      tenantId: state.tenantId,
      threadId: state.threadId,
      runId: state.runId || undefined,
      eventType,
      actor,
      target: state.projectId,
      payload,
    });
  }

  private downstreamRoles(
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
