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

export abstract class ProductionWorkflowRuntimeBase {
  protected abstract readonly app: {
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
  };
  protected readonly llmProvider: LlmProvider;
  protected readonly redisProvider: RedisProvider;
  protected readonly roleTools: ProductionWorkflowTools;
  protected readonly artifacts: ArtifactsService;
  protected readonly langfuseProvider?: LangfuseProvider;
  protected readonly collaboration?: AgentCollaborationService;
  protected readonly tasks?: AgentTasksService;
  protected readonly runtimeEvents?: AgentRuntimeEventsService;
  protected readonly toolPolicy?: ToolExecutionPolicyService;
  protected readonly toolExecution?: ToolExecutionService;
  protected readonly agentRuns?: AgentRunsService;
  protected readonly agentGoals?: AgentGoalService;
  protected readonly plugins?: PluginRuntimeService;
  protected readonly domainEvents?: DomainEventsService;
  protected readonly dingTalk?: DingTalkProvider;
  protected readonly workflowQueue?: ProductionWorkflowQueueService;
  protected readonly configService?: ConfigService;

  protected readonly logger = new Logger('ProductionWorkflowService');

  protected readonly checkpointer: RedisCheckpointer;

  protected readonly activeRuns = new Map<string, Promise<void>>();

  protected readonly cancellationControllers = new Map<
    string,
    AbortController
  >();

  protected readonly lostLeases = new Set<string>();

  protected readonly rejectionOperations = new Set<string>();

  protected readonly pendingStates = new Map<
    string,
    ProductionWorkflowStateType
  >();

  protected readonly workflowIndexMemory = new Map<
    string,
    Record<string, unknown>
  >();

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
      86400 * 30,
      undefined,
      this.configService?.get<boolean>('core.requireDependencies') === true ||
        this.configService?.get<string>('nodeEnv') === 'production',
    );
  }
}
