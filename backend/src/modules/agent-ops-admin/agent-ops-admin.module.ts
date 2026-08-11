import { Module } from '@nestjs/common';
import { AgentEvalModule } from '../agent-evals/agent-eval.module';
import { ChatModule } from '../chat/chat.module';
import { TracingModule } from '../tracing/tracing.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { AgentOpsAdminController } from './agent-ops-admin.controller';
import { AgenticRagModule } from '../../rag/agentic/agentic-rag.module';
import { AgentRunsModule } from '../agent-runs/agent-runs.module';
import { AgentCollaborationModule } from '../agent-collaboration/agent-collaboration.module';
import { AgentTasksModule } from '../agent-tasks/agent-tasks.module';
import { AgentRuntimeEventsModule } from '../agent-runtime-events/agent-runtime-events.module';

@Module({
  imports: [
    WorkflowModule,
    AgentEvalModule,
    ChatModule,
    TracingModule,
    AgenticRagModule,
    AgentRunsModule,
    AgentCollaborationModule,
    AgentTasksModule,
    AgentRuntimeEventsModule,
  ],
  controllers: [AgentOpsAdminController],
})
export class AgentOpsAdminModule {}
