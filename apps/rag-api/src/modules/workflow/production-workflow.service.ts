import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { ProductionWorkflowTools } from './production-workflow.tools';
import { LangfuseProvider } from '../../providers/observability/langfuse.provider';
import { DingTalkProvider } from '../../providers/notify/dingtalk.provider';
import { AgentCollaborationService } from '../agent-collaboration/agent-collaboration.service';
import { AgentTasksService } from '../agent-tasks/agent-tasks.service';
import { AgentRuntimeEventsService } from '../agent-runtime-events/agent-runtime-events.service';
import { ToolExecutionPolicyService } from '../../tools/tool-execution-policy.service';
import { ToolExecutionService } from '../../tools/tool-execution.service';
import { AgentRunsService } from '../agent-runs/agent-runs.service';
import { AgentGoalService } from '../agent-runs/agent-goal.service';
import { PluginRuntimeService } from '../plugin-runtime/plugin-runtime.service';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { ProductionWorkflowQueueService } from './production-workflow-queue.service';
import type { ProductionWorkflowContext } from './production-workflow.context';
import { composeProductionWorkflow } from './production-workflow.composition';

/**
 * 产研工作流的 Nest 入口。
 * composeProductionWorkflow 按职责组装组件，service 保留稳定的对外方法。
 * startAsync/resumeAsync/reviseAsync 在 control 中入队；Worker 调用同步入口。
 * state-service.runUntilSettled 推进图：prepare 选批次，execution 按岗位
 * generateRole（检索与生成）→ persistRole（产物、交接、任务），审批/修订再入队。
 * 旧 Checkpoint 继续走 executeBatch，查询与导出由 query 提供。
 */
@Injectable()
export class ProductionWorkflowService implements OnModuleInit {
  private readonly context: ProductionWorkflowContext;

  constructor(
    llmProvider: LlmProvider,
    redisProvider: RedisProvider,
    roleTools: ProductionWorkflowTools,
    artifacts: ArtifactsService,
    @Optional() langfuseProvider?: LangfuseProvider,
    @Optional() collaboration?: AgentCollaborationService,
    @Optional() tasks?: AgentTasksService,
    @Optional() runtimeEvents?: AgentRuntimeEventsService,
    @Optional() toolPolicy?: ToolExecutionPolicyService,
    @Optional() toolExecution?: ToolExecutionService,
    @Optional() agentRuns?: AgentRunsService,
    @Optional() agentGoals?: AgentGoalService,
    @Optional() plugins?: PluginRuntimeService,
    @Optional() domainEvents?: DomainEventsService,
    @Optional() dingTalk?: DingTalkProvider,
    @Optional()
    workflowQueue?: ProductionWorkflowQueueService,
    @Optional() configService?: ConfigService,
  ) {
    this.context = composeProductionWorkflow({
      llmProvider,
      redisProvider,
      roleTools,
      artifacts,
      langfuseProvider,
      collaboration,
      tasks,
      runtimeEvents,
      toolPolicy,
      toolExecution,
      agentRuns,
      agentGoals,
      plugins,
      domainEvents,
      dingTalk,
      workflowQueue,
      configService,
    });
  }

  onModuleInit(): void {
    this.context.control.onModuleInit();
  }

  start(...args: Parameters<ProductionWorkflowContext['control']['start']>) {
    return this.context.control.start(...args);
  }

  startAsync(
    ...args: Parameters<ProductionWorkflowContext['control']['startAsync']>
  ) {
    return this.context.control.startAsync(...args);
  }

  resume(...args: Parameters<ProductionWorkflowContext['control']['resume']>) {
    return this.context.control.resume(...args);
  }

  resumeAsync(
    ...args: Parameters<ProductionWorkflowContext['control']['resumeAsync']>
  ) {
    return this.context.control.resumeAsync(...args);
  }

  revise(...args: Parameters<ProductionWorkflowContext['control']['revise']>) {
    return this.context.control.revise(...args);
  }

  reviseAsync(
    ...args: Parameters<ProductionWorkflowContext['control']['reviseAsync']>
  ) {
    return this.context.control.reviseAsync(...args);
  }

  cancel(...args: Parameters<ProductionWorkflowContext['control']['cancel']>) {
    return this.context.control.cancel(...args);
  }

  status(...args: Parameters<ProductionWorkflowContext['query']['status']>) {
    return this.context.query.status(...args);
  }

  list(...args: Parameters<ProductionWorkflowContext['query']['list']>) {
    return this.context.query.list(...args);
  }

  codingContext(
    ...args: Parameters<ProductionWorkflowContext['query']['codingContext']>
  ) {
    return this.context.query.codingContext(...args);
  }

  assertOwnedThread(
    ...args: Parameters<ProductionWorkflowContext['query']['assertOwnedThread']>
  ) {
    return this.context.query.assertOwnedThread(...args);
  }

  handoffManifest(
    ...args: Parameters<ProductionWorkflowContext['query']['handoffManifest']>
  ) {
    return this.context.query.handoffManifest(...args);
  }

  playwayPreview(
    ...args: Parameters<ProductionWorkflowContext['query']['playwayPreview']>
  ) {
    return this.context.query.playwayPreview(...args);
  }

  generateProject(
    ...args: Parameters<ProductionWorkflowContext['query']['generateProject']>
  ) {
    return this.context.query.generateProject(...args);
  }

  generateProjectZip(
    ...args: Parameters<
      ProductionWorkflowContext['query']['generateProjectZip']
    >
  ) {
    return this.context.query.generateProjectZip(...args);
  }
}
