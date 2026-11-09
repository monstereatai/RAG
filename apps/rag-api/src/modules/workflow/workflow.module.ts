import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { LlmModule } from '../../providers/llm/llm.module';
import { ProductionWorkflowService } from './production-workflow.service';
import { RagModule } from '../../rag/rag.module';
import { ArtifactsModule } from '../artifacts/artifacts.module';
import { ProductionWorkflowTools } from './production-workflow.tools';
import { ObservabilityModule } from '../../providers/observability/observability.module';
import { AgentCollaborationModule } from '../agent-collaboration/agent-collaboration.module';
import { AgentTasksModule } from '../agent-tasks/agent-tasks.module';
import { AgentRuntimeEventsModule } from '../agent-runtime-events/agent-runtime-events.module';
import { ToolsModule } from '../../tools/tools.module';
import { AgentRunsModule } from '../agent-runs/agent-runs.module';
import { PluginRuntimeModule } from '../plugin-runtime/plugin-runtime.module';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { AgentLoopModule } from '../agent-loop/agent-loop.module';
import { GraphModule } from '../graph/graph.module';
import { ProductionWorkflowQueueService } from './production-workflow-queue.service';
import { ProductionArtifactStudioService } from './production-artifact-studio.service';
import { ProductionProjectWorkspaceService } from './production-project-workspace.service';
import { ProductionProjectWorkspaceAgentService } from './production-project-workspace-agent.service';
import { CodingTaskService } from './coding-task.service';
import { ProductionTestAgentService } from './production-test-agent.service';

@Module({
  imports: [
    LlmModule,
    RagModule,
    ArtifactsModule,
    ObservabilityModule,
    AgentCollaborationModule,
    AgentTasksModule,
    AgentRuntimeEventsModule,
    ToolsModule,
    AgentRunsModule,
    PluginRuntimeModule,
    DomainEventsModule,
    AgentLoopModule,
    GraphModule,
  ],
  controllers: [WorkflowController],
  providers: [
    ProductionWorkflowService,
    ProductionWorkflowTools,
    ProductionWorkflowQueueService,
    ProductionArtifactStudioService,
    ProductionProjectWorkspaceService,
    ProductionProjectWorkspaceAgentService,
    ProductionTestAgentService,
    CodingTaskService,
  ],
  exports: [
    ProductionWorkflowService,
    ProductionArtifactStudioService,
    ProductionProjectWorkspaceService,
    ProductionProjectWorkspaceAgentService,
    ProductionTestAgentService,
    CodingTaskService,
  ],
})
export class WorkflowModule {}
