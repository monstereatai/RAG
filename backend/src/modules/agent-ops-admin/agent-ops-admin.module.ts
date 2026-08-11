import { Module } from '@nestjs/common';
import { AgentEvalModule } from '../agent-evals/agent-eval.module';
import { ChatModule } from '../chat/chat.module';
import { TracingModule } from '../tracing/tracing.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { AgentOpsAdminController } from './agent-ops-admin.controller';
import { AgenticRagModule } from '../../rag/agentic/agentic-rag.module';

@Module({
  imports: [
    WorkflowModule,
    AgentEvalModule,
    ChatModule,
    TracingModule,
    AgenticRagModule,
  ],
  controllers: [AgentOpsAdminController],
})
export class AgentOpsAdminModule {}
