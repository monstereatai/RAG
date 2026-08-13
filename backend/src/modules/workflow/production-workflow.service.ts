import { Injectable, Logger, Optional } from '@nestjs/common';
import { StateGraph, START, END } from '@langchain/langgraph';
import { randomUUID } from 'node:crypto';
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
  ProductionRole,
  ProductionRiskLevel,
  ProductionStageResult,
  ProductionWorkflowState,
  ProductionWorkflowStateType,
} from './production-workflow.state';
import {
  ResumeProductionWorkflowDto,
  StartProductionWorkflowDto,
} from './production-workflow.dto';
import {
  buildProductionExecutionBatches,
  dependenciesForProductionRole,
  normalizeProductionRoles,
} from './production-workflow.plan';
import { ProductionWorkflowTools } from './production-workflow.tools';
import { LangfuseProvider } from '../../providers/observability/langfuse.provider';
import { AgentCollaborationService } from '../agent-collaboration/agent-collaboration.service';
import { AgentTasksService } from '../agent-tasks/agent-tasks.service';
import { AgentRuntimeEventsService } from '../agent-runtime-events/agent-runtime-events.service';
import { ToolExecutionPolicyService } from '../../tools/tool-execution-policy.service';

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
});

const projectFileSchema = z.object({
  path: z.string().regex(/^[A-Za-z0-9_.\-/]+$/).max(180),
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

const ROLE_GUIDANCE: Record<ProductionRole, string> = {
  product:
    '校验目标、范围、规则、边界条件、地区版本和验收口径，输出 PRD 审查结论。',
  design: '校验页面状态、交互闭环、尺寸规范、多语言适配和设计交付物。',
  frontend: '校验组件拆分、接口依赖、状态管理、埋点、性能和异常降级。',
  backend: '校验领域模型、接口契约、幂等、并发、资格校验、奖励发放和可观测性。',
  qa: '校验测试范围、前置条件、输入输出、边界、兼容性、回归和上线门禁。',
  operations: '校验发布计划、配置、灰度、监控、应急预案、客服口径和复盘指标。',
};

const RISK_RANK: Record<ProductionRiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const ROLE_LLM_TIMEOUT_MS = 75_000;
const ROLE_LLM_RETRY_BACKOFF_MS = 1_000;

@Injectable()
export class ProductionWorkflowService {
  private readonly logger = new Logger(ProductionWorkflowService.name);
  private readonly checkpointer: RedisCheckpointer;
  private readonly app: ReturnType<ProductionWorkflowService['buildGraph']>;
  private readonly activeRuns = new Map<string, Promise<void>>();
  private readonly pendingStates = new Map<
    string,
    ProductionWorkflowStateType
  >();
  private readonly workflowIndexMemory = new Map<string, Record<string, unknown>>();

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
  ) {
    this.checkpointer = new RedisCheckpointer(redisProvider, 86400 * 30);
    this.app = this.buildGraph();
  }

  async start(dto: StartProductionWorkflowDto, userId: string) {
    const threadId = dto.threadId ?? randomUUID();
    const initialState = this.createInitialState(dto, userId, threadId);
    await this.emitRuntimeEvent(initialState, 'workflow.started', 'production_workflow', {
      projectId: initialState.projectId,
      selectedRoles: initialState.selectedRoles,
      processType: initialState.processType,
    });
    await this.emitRuntimeEvent(initialState, 'goal.active', 'production_workflow', {
      objective: initialState.brief,
      status: 'active',
      round: 1,
      maxRounds: initialState.maxSteps,
    });
    await this.initializeTasks(initialState);
    const state = await this.app.invoke(initialState, this.config(threadId));
    const settled = await this.runUntilSettled(threadId, state);
    await this.traceLangfuse(settled);
    const result = this.view(threadId, settled, userId);
    await this.emitWorkflowState(settled);
    await this.saveWorkflowIndex(result);
    return result;
  }

  startAsync(dto: StartProductionWorkflowDto, userId: string) {
    const threadId = dto.threadId ?? randomUUID();
    const initialState = this.createInitialState(dto, userId, threadId);
    void this.initializeTasks(initialState);
    this.pendingStates.set(threadId, initialState);
    void this.saveWorkflowIndex(this.view(threadId, initialState, userId));
    this.schedule(threadId, userId, () =>
      this.start({ ...dto, threadId }, userId),
    );
    return this.view(threadId, initialState, userId);
  }

  async resume(
    threadId: string,
    dto: ResumeProductionWorkflowDto,
    userId: string,
  ) {
    const current = await this.getOwnedState(threadId, userId);
    if (current.status !== 'pending_approval') {
      throw new Error(`workflow is not pending approval: ${current.status}`);
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
    await this.traceLangfuse(settled);
    const result = this.view(threadId, settled, userId);
    await this.emitRuntimeEvent(settled, `approval.${dto.approval}`, 'human_reviewer', {
      feedback: dto.feedback?.trim() ?? '',
      rerunRoles: dto.rerunRoles ?? [],
    });
    await this.emitWorkflowState(settled);
    await this.saveWorkflowIndex(result);
    return result;
  }

  async resumeAsync(
    threadId: string,
    dto: ResumeProductionWorkflowDto,
    userId: string,
  ) {
    const current = await this.getOwnedState(threadId, userId);
    if (current.status !== 'pending_approval') {
      throw new Error(`workflow is not pending approval: ${current.status}`);
    }
    const pending = {
      ...current,
      status: 'running' as const,
      approval: dto.approval,
      feedback: dto.feedback?.trim() ?? '',
      rerunRoles: dto.rerunRoles ?? [],
    };
    this.pendingStates.set(threadId, pending);
    void this.saveWorkflowIndex(this.view(threadId, pending, userId));
    this.schedule(threadId, userId, () => this.resume(threadId, dto, userId));
    return this.view(threadId, pending, userId);
  }

  async status(threadId: string, userId: string) {
    let state: ProductionWorkflowStateType;
    try {
      state = await this.getOwnedState(threadId, userId);
    } catch (error) {
      const pending = this.pendingStates.get(threadId);
      if (!pending || pending.userId !== userId) throw error;
      state = pending;
    }
    if (state.status === 'running' && !this.activeRuns.has(threadId)) {
      this.schedule(threadId, userId, () =>
        this.runUntilSettled(threadId, state),
      );
    }
    const result = this.view(threadId, state, userId);
    void this.saveWorkflowIndex(result);
    return result;
  }

  async list(userId: string) {
    const ids = await this.redisProvider.zrange(
      `production:workflows:${userId}`,
      0,
      -1,
      'REV',
    );
    const items = await Promise.all(
      ids.map((threadId) => this.redisProvider.get(this.workflowIndexKey(userId, threadId))),
    );
    const redisItems = items
      .filter((item): item is string => Boolean(item))
      .map((item) => JSON.parse(item) as Record<string, unknown>);
    const memoryItems = [...this.workflowIndexMemory.values()].filter(
      (item) => item.userId === userId,
    );
    const merged = new Map<string, Record<string, unknown>>();
    [...redisItems, ...memoryItems].forEach((item) => {
      const threadId = String(item.threadId ?? '');
      if (threadId) merged.set(threadId, item);
    });
    return [...merged.values()]
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async codingContext(threadId: string, userId: string) {
    const state = await this.getOwnedState(threadId, userId);
    if (state.status !== 'completed') {
      throw new Error(`workflow is not completed: ${state.status}`);
    }
    return {
      threadId: state.threadId,
      projectId: state.projectId,
      status: state.status,
      selectedRoles: state.selectedRoles,
      completedRoles: state.completedRoles,
      brief: state.brief,
      stages: state.selectedRoles
        .map((role) => state.results[role])
        .filter((result): result is ProductionStageResult => Boolean(result))
        .map((result) => ({
          role: result.role,
          summary: result.summary,
          riskLevel: result.riskLevel,
          evidenceCoverage: result.evidenceCoverage,
          claims: result.claims,
          issues: result.issues,
          downstreamRisks: result.downstreamRisks,
          deliverables: result.deliverables,
          generatedArtifact: result.generatedArtifact,
        })),
    };
  }

  async generateProject(threadId: string, userId: string) {
    const context = await this.codingContext(threadId, userId);
    const handoff = context.stages
      .map((stage) => `${stage.role}\n${stage.summary}\n${stage.deliverables.map((item) => `## ${item.title}\n${item.markdown.slice(0, 12_000)}`).join('\n\n')}`)
      .join('\n\n');
    const messages = [
        {
          role: 'system',
          content:
            '你是资深前端工程师。只返回一个 JSON 对象，不要返回解释文字、Markdown 围栏或只返回 notes。JSON 必须严格包含且只能包含这些字段：projectName（字符串）、framework（字符串）、files（数组）、runCommand（字符串）、notes（字符串数组）。files 至少 4 项，每项必须包含 path、content、purpose 三个字段；content 必须是完整可运行源码，不能用省略号代替。优先生成 React + Vite + TypeScript；不确定的后端接口使用 mock 数据并在 notes 数组说明。文件路径必须是相对路径，禁止绝对路径、..、node_modules 和二进制文件。',
        },
        {
          role: 'user',
          content: `活动：${context.projectId}\n需求背景：${context.brief.slice(0, 8_000)}\n\n已审批岗位交付物：\n${handoff.slice(0, 80_000)}\n\n现在只输出 JSON。必须生成 package.json、index.html、src/main.tsx 或 src/main.jsx、主要页面和样式文件。`,
        },
      ];
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const output = await this.llmProvider
          .getModel()
          .withStructuredOutput(projectSchema, { method: 'jsonMode' })
          .invoke(messages);
        const normalized = {
          ...output,
          notes: Array.isArray(output.notes) ? output.notes : [String(output.notes ?? '')].filter(Boolean),
        };
        return { ...normalized, activityName: context.projectId, sourceThreadId: context.threadId };
      } catch (error) {
        lastError = error;
        if (attempt === 1) {
          messages.push({
            role: 'user',
            content: '上一次输出不符合 JSON schema。请重新输出完整 JSON，禁止只返回 notes；files 必须是包含完整源码的数组。',
          });
        }
      }
    }
    throw new Error(`项目代码结构化生成失败：${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  async generateProjectZip(threadId: string, userId: string): Promise<Buffer> {
    const context = await this.codingContext(threadId, userId);
    const generated = await this.generateProject(threadId, userId);
    const zip = new JSZip();
    generated.files.forEach((file) => zip.file(file.path, file.content));
    zip.file('RAG_WORKFLOW_CONTEXT.json', JSON.stringify({ ...context, generatedProject: generated }, null, 2));
    zip.file('README.md', `# ${generated.projectName}\n\n框架：${generated.framework}\n\n启动：\`${generated.runCommand}\`\n\n${generated.notes.map((note) => `- ${note}`).join('\n')}\n`);
    context.stages.forEach((stage) => {
      stage.deliverables.forEach((deliverable, index) => {
        const safeTitle = deliverable.title.replace(/[\\/:*?"<>|]/g, '-');
        zip.file(`handoff/${stage.role}/${String(index + 1).padStart(2, '0')}-${safeTitle}.md`, deliverable.markdown);
      });
    });
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  private createInitialState(
    dto: StartProductionWorkflowDto,
    userId: string,
    threadId: string,
  ): ProductionWorkflowStateType {
    const selectedRoles = normalizeProductionRoles(dto.roles);
    return {
      threadId,
      projectId: dto.projectId.trim(),
      userId,
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
      status: 'running',
      approval: null,
      feedback: '',
      results: {},
      error: '',
    };
  }

  private async initializeTasks(state: ProductionWorkflowStateType): Promise<void> {
    if (!this.tasks) return;
    const existing = await this.tasks.list(state.threadId);
    if (existing.length > 0) return;
    await this.tasks.createPlan({ threadId: state.threadId, roles: state.selectedRoles, processType: state.processType });
  }

  private schedule(
    threadId: string,
    userId: string,
    task: () => Promise<unknown>,
  ): void {
    if (this.activeRuns.has(threadId)) return;
    const run = Promise.resolve()
      .then(task)
      .then(() => undefined)
      .catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`production workflow ${threadId} failed: ${message}`);
        try {
          await this.app.updateState(this.config(threadId), {
            status: 'failed',
            error: message,
          });
        } catch {
          const pending = this.pendingStates.get(threadId);
          if (pending?.userId === userId) {
            this.pendingStates.set(threadId, {
              ...pending,
              status: 'failed',
              error: message,
            });
          }
        }
      })
      .finally(() => {
        this.activeRuns.delete(threadId);
        if (this.pendingStates.get(threadId)?.status !== 'failed') {
          this.pendingStates.delete(threadId);
        }
      });
    this.activeRuns.set(threadId, run);
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

  private prepareNode(
    state: ProductionWorkflowStateType,
  ): Partial<ProductionWorkflowStateType> {
    if (state.status === 'completed' || state.status === 'failed') return {};
    if (state.stepCount >= state.maxSteps) {
      return {
        status: 'failed',
        error: `maximum workflow steps exceeded (${state.maxSteps})`,
      };
    }

    let batchIndex = state.batchIndex;
    let completedRoles = state.completedRoles;
    if (state.status === 'pending_approval') {
      if (!state.approval) return {};
      if (state.approval === 'approved') {
        completedRoles = this.unionRoles(completedRoles, state.currentBatch);
        batchIndex += 1;
      } else {
        const requested = state.rerunRoles.length
          ? state.rerunRoles.filter((role) => state.currentBatch.includes(role))
          : state.currentBatch;
        return {
          status: 'running',
          approval: null,
          pendingApprovalRoles: [],
          rerunRoles: requested.length ? requested : state.currentBatch,
          stepCount: state.stepCount + 1,
          error: '',
        };
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
      stepCount: state.stepCount + 1,
      error: '',
    };
  }

  private async executeBatchNode(
    state: ProductionWorkflowStateType,
  ): Promise<Partial<ProductionWorkflowStateType>> {
    const rolesToRun = state.rerunRoles.length
      ? state.rerunRoles
      : state.currentBatch;
    const entries = await Promise.all(
      rolesToRun.map(
        async (role) => [role, await this.runRole(role, state)] as const,
      ),
    );
    const results = Object.fromEntries(entries) as Partial<
      Record<ProductionRole, ProductionStageResult>
    >;
    const mergedResults = { ...state.results, ...results };
    const pendingApprovalRoles = state.currentBatch.filter((role) => {
      const result = mergedResults[role];
      return result ? this.requiresRoleApproval(role, result, state) : false;
    });
    if (pendingApprovalRoles.length === 0) {
      const completedRoles = this.unionRoles(
        state.completedRoles,
        state.currentBatch,
      );
      return {
        currentRole: state.currentBatch[0],
        batchIndex: state.batchIndex + 1,
        stageIndex: completedRoles.length,
        completedRoles,
        status: 'running',
        results,
        rerunRoles: [],
      };
    }
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
    await this.emitRuntimeEvent(state, 'role.started', role, {
      role,
      dependencies: dependenciesForProductionRole(role, state.selectedRoles),
    });
    await this.tasks?.updateForRole(state.threadId, role, { status: 'running' });
    const dependencies = dependenciesForProductionRole(
      role,
      state.selectedRoles,
    );
    const previousResults = dependencies
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
      brief: state.brief,
      userId: state.userId,
    });
    await this.emitRuntimeEvent(state, 'retrieval.completed', role, {
      evidenceCount: toolResult.evidence.length,
      executions: toolResult.executions,
    });
    const model = this.llmProvider.getModel();
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const modelStartedAt = Date.now();
      try {
        await this.emitRuntimeEvent(state, 'model.started', role, { attempt });
        const output = await model
          .withStructuredOutput(roleSchema, { method: 'jsonMode' })
          .invoke(
            [
              {
                role: 'system',
                content: `你是游戏官网／活动产研运工作流的${role}节点。${ROLE_GUIDANCE[role]}请只返回一个符合给定 schema 的 json object。生成当前岗位可直接交接的 Markdown 交付物，而不是只列交付物名称。事实性声明必须引用给定 evidence id；没有证据时必须标记 pending_confirmation，禁止编造引用。只能处理当前岗位职责，不得替其他岗位作最终决定。`,
              },
              {
                role: 'user',
                content: `项目：${state.projectId}\n需求背景：${state.brief}\n前序结构化交付：${JSON.stringify(previousResults)}\n当前可用证据：${JSON.stringify(toolResult.evidence)}\n驳回意见：${state.feedback || '无'}\n请输出严格结构化结果。deliverables 只生成一份完整但精炼的 Markdown；claims 中 supported 声明必须填写当前证据 id。json 字段必须严格使用以下形状，不得改名、缺失或把数组改成字符串：{"summary":"岗位结论","deliverables":[{"type":"review","title":"交付物标题","markdown":"# 完整 Markdown"}],"claims":[{"statement":"事实声明","evidenceIds":["当前证据 id"],"status":"supported"}],"issues":[],"downstreamRisks":[],"riskLevel":"low","readyForApproval":false}。没有证据的声明使用空 evidenceIds 和 pending_confirmation。`,
              },
            ],
            { signal: AbortSignal.timeout(ROLE_LLM_TIMEOUT_MS) },
          );
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
          ...output,
          claims,
          evidence: toolResult.evidence,
          evidenceCoverage,
          toolExecutions: toolResult.executions,
          readyForApproval:
            output.readyForApproval &&
            output.deliverables.length > 0 &&
            claims.every((claim) => claim.status === 'supported'),
          completedAt: new Date().toISOString(),
        };
        result.generatedArtifact = await this.publishRoleArtifact(
          state,
          result,
        );
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

  private async recordRoleHandoff(
    state: ProductionWorkflowStateType,
    result: ProductionStageResult,
  ): Promise<void> {
    if (!this.collaboration) return;
    const downstreamRoles = PRODUCTION_ROLES.filter((candidate) =>
      dependenciesForProductionRole(candidate, state.selectedRoles).includes(result.role),
    );
    await Promise.all(downstreamRoles.map((toRole) => this.collaboration!.publishMessage({
      threadId: state.threadId,
      fromRole: result.role,
      toRole,
      messageType: 'artifact_handoff',
      subject: `${result.role} → ${toRole} 交接`,
      payload: { summary: result.summary, riskLevel: result.riskLevel, evidenceCoverage: result.evidenceCoverage, readyForApproval: result.readyForApproval },
      artifactIds: result.generatedArtifact?.id ? [result.generatedArtifact.id] : [],
    })));
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
    const startedAt = Date.now();
    const authorization = this.toolPolicy?.decide('artifact_generate', {
      mode: 'production',
      role: result.role,
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
    );
    try {
      const artifact = await this.artifacts.create({
        ownerUserId: state.userId,
        threadId: state.threadId,
        title: `${state.projectId}-${result.role}-交付物`,
        kind: 'markdown',
        sourceText,
      });
      result.toolExecutions.push({
        tool: 'artifact_generate',
        status: 'success',
        durationMs: Date.now() - startedAt,
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
    return [...sections, '# 事实声明与证据', ...claimLines].join('\n\n');
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

  private async getOwnedState(threadId: string, userId: string) {
    const snapshot = await this.app.getState(this.config(threadId));
    const state = snapshot?.values as ProductionWorkflowStateType | undefined;
    if (!state?.projectId) throw new Error('workflow not found');
    if (state.userId !== userId) throw new Error('workflow not found');
    return state;
  }

  private async runUntilSettled(
    threadId: string,
    initialState: ProductionWorkflowStateType,
  ): Promise<ProductionWorkflowStateType> {
    let state = initialState;
    while (state.status === 'running') {
      state = await this.app.invoke({}, this.config(threadId));
    }
    return state;
  }

  private config(threadId: string) {
    return { configurable: { thread_id: `production:${threadId}` } };
  }

  private workflowIndexKey(userId: string, threadId: string) {
    return `production:workflow:${userId}:${threadId}`;
  }

  private async saveWorkflowIndex(view: ReturnType<ProductionWorkflowService['view']>) {
    const index = {
      ...view,
      brief: undefined,
      updatedAt: new Date().toISOString(),
      results: Object.fromEntries(
        Object.entries(view.results).map(([role, result]) => [role, result ? {
          role: result.role,
          summary: result.summary,
          riskLevel: result.riskLevel,
          evidenceCoverage: result.evidenceCoverage,
          readyForApproval: result.readyForApproval,
          completedAt: result.completedAt,
          deliverables: result.deliverables.map((item) => ({ type: item.type, title: item.title })),
        } : result]),
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

  private async traceLangfuse(state: ProductionWorkflowStateType): Promise<void> {
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

  private async emitWorkflowState(state: ProductionWorkflowStateType): Promise<void> {
    if (state.status === 'pending_approval') {
      await this.emitRuntimeEvent(state, 'approval.required', 'production_workflow', {
        roles: state.pendingApprovalRoles,
      });
      await this.emitRuntimeEvent(state, 'goal.paused', 'production_workflow', {
        objective: state.brief,
        status: 'paused',
        round: state.stepCount,
        maxRounds: state.maxSteps,
        reason: '等待人工审批。',
      });
      return;
    }
    if (state.status === 'completed') {
      await this.emitRuntimeEvent(state, 'workflow.completed', 'production_workflow', {
        completedRoles: state.completedRoles,
      });
      await this.emitRuntimeEvent(state, 'goal.completed', 'production_workflow', {
        objective: state.brief,
        status: 'completed',
        round: state.stepCount,
        maxRounds: state.maxSteps,
      });
      return;
    }
    if (state.status === 'failed') {
      await this.emitRuntimeEvent(state, 'workflow.failed', 'production_workflow', {
        error: state.error,
      });
      await this.emitRuntimeEvent(state, 'goal.blocked', 'production_workflow', {
        objective: state.brief,
        status: 'blocked',
        round: state.stepCount,
        maxRounds: state.maxSteps,
        reason: state.error || '工作流失败。',
      });
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
        threadId: state.threadId,
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

  private view(
    threadId: string,
    state: ProductionWorkflowStateType,
    userId: string,
  ) {
    return {
      threadId,
      projectId: state.projectId,
      userId,
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
      status: state.status,
      feedback: state.feedback,
      results: state.results,
      error: state.error,
      requiresApproval: state.status === 'pending_approval',
    };
  }
}
