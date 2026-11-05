import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { RedisCheckpointer } from '../../providers/langgraph-checkpointer/redis-checkpointer';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { ProductionWorkflowStateType } from './production-workflow.state';
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
import { ProductionWorkflowDependencies } from './production-workflow.shared';
import type { ProductionWorkflowEvents } from './production-workflow.events';
import type { ProductionWorkflowStateService } from './production-workflow.state-service';
import type { ProductionWorkflowRoleSupport } from './production-workflow.role-support';
import type { ProductionWorkflowExecution } from './production-workflow.execution';
import type { ProductionWorkflowControl } from './production-workflow.control';
import type { ProductionWorkflowQuery } from './production-workflow.query';
import type { ProductionWorkflowRevision } from './production-workflow.revision';

export interface ProductionWorkflowGraph {
  getState(config: {
    configurable: { thread_id: string };
  }): Promise<{ values?: ProductionWorkflowStateType } | undefined>;
  invoke(
    input: Partial<ProductionWorkflowStateType>,
    config: { configurable: { thread_id: string } },
  ): Promise<ProductionWorkflowStateType>;
  updateState(
    config: { configurable: { thread_id: string } },
    values: Partial<ProductionWorkflowStateType>,
  ): Promise<unknown>;
}

export class ProductionWorkflowRuntime {
  events!: ProductionWorkflowEvents;
  state!: ProductionWorkflowStateService;
  roleSupport!: ProductionWorkflowRoleSupport;
  execution!: ProductionWorkflowExecution;
  control!: ProductionWorkflowControl;
  query!: ProductionWorkflowQuery;
  revision!: ProductionWorkflowRevision;
  app!: ProductionWorkflowGraph;
  readonly llmProvider: LlmProvider;
  readonly redisProvider: RedisProvider;
  readonly roleTools: ProductionWorkflowTools;
  readonly artifacts: ArtifactsService;
  readonly langfuseProvider?: LangfuseProvider;
  readonly collaboration?: AgentCollaborationService;
  readonly tasks?: AgentTasksService;
  readonly runtimeEvents?: AgentRuntimeEventsService;
  readonly toolPolicy?: ToolExecutionPolicyService;
  readonly toolExecution?: ToolExecutionService;
  readonly agentRuns?: AgentRunsService;
  readonly agentGoals?: AgentGoalService;
  readonly plugins?: PluginRuntimeService;
  readonly domainEvents?: DomainEventsService;
  readonly dingTalk?: DingTalkProvider;
  readonly workflowQueue?: ProductionWorkflowQueueService;
  readonly configService?: ConfigService;

  readonly logger = new Logger('ProductionWorkflowService');

  readonly checkpointer: RedisCheckpointer;

  readonly activeRuns = new Map<string, Promise<void>>();

  readonly cancellationControllers = new Map<string, AbortController>();

  readonly lostLeases = new Set<string>();

  readonly rejectionOperations = new Set<string>();

  readonly pendingStates = new Map<string, ProductionWorkflowStateType>();

  readonly workflowIndexMemory = new Map<string, Record<string, unknown>>();

  constructor(dependencies: ProductionWorkflowDependencies) {
    this.llmProvider = dependencies.llmProvider;
    this.redisProvider = dependencies.redisProvider;
    this.roleTools = dependencies.roleTools;
    this.artifacts = dependencies.artifacts;
    this.langfuseProvider = dependencies.langfuseProvider;
    this.collaboration = dependencies.collaboration;
    this.tasks = dependencies.tasks;
    this.runtimeEvents = dependencies.runtimeEvents;
    this.toolPolicy = dependencies.toolPolicy;
    this.toolExecution = dependencies.toolExecution;
    this.agentRuns = dependencies.agentRuns;
    this.agentGoals = dependencies.agentGoals;
    this.plugins = dependencies.plugins;
    this.domainEvents = dependencies.domainEvents;
    this.dingTalk = dependencies.dingTalk;
    this.workflowQueue = dependencies.workflowQueue;
    this.configService = dependencies.configService;
    this.checkpointer = new RedisCheckpointer(
      this.redisProvider,
      0, // 产研工作流历史状态长期保留，不设置短期 TTL。
      undefined,
      this.configService?.get<boolean>('core.requireDependencies') === true ||
        this.configService?.get<string>('nodeEnv') === 'production',
    );
  }
}
