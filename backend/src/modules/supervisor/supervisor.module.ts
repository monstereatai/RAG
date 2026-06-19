import { Module } from '@nestjs/common';
import { SupervisorService } from './supervisor.service';
import { SupervisorController } from './supervisor.controller';
import { AgentsModule } from '../../rag/agents/agents.module';
import { LlmModule } from '../../providers/llm/llm.module';

@Module({
  imports: [AgentsModule, LlmModule],
  controllers: [SupervisorController],
  providers: [SupervisorService],
  exports: [SupervisorService],
})
export class SupervisorModule {}
