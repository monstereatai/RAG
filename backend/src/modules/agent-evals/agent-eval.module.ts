import { Module } from '@nestjs/common';
import { LlmModule } from '../../providers/llm/llm.module';
import { AgentEvalController } from './agent-eval.controller';
import { AgentEvalService } from './agent-eval.service';

@Module({
  imports: [LlmModule],
  controllers: [AgentEvalController],
  providers: [AgentEvalService],
  exports: [AgentEvalService],
})
export class AgentEvalModule {}
