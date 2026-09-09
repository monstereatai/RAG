import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { LlmModule } from '../../providers/llm/llm.module';
import { ProductionWorkflowService } from './production-workflow.service';
import { KarpathyRagModule } from '../../rag/karpathy/karpathy-rag.module';
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

@Module({
  imports: [
    LlmModule,
    KarpathyRagModule,
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
  providers: [ProductionWorkflowService, ProductionWorkflowTools],
  exports: [ProductionWorkflowService],
})
export class WorkflowModule {}
