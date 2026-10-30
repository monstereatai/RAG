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
import { ProductionWorkflowRevisionBase } from './production-workflow.revision';

@Injectable()
export class ProductionWorkflowService
  extends ProductionWorkflowRevisionBase
  implements OnModuleInit
{
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
    super({
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
}
