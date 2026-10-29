import { Module } from '@nestjs/common';
import { LlmModule } from '../../providers/llm/llm.module';
import { ResearcherAgent } from './researcher.agent';
import { AnalystAgent } from './analyst.agent';
import { WriterAgent } from './writer.agent';
import { CriticAgent } from './critic.agent';
import { EditorAgent } from './editor.agent';
import { AgentPipelineService } from './agent-pipeline.service';

@Module({
  imports: [LlmModule],
  providers: [
    ResearcherAgent,
    AnalystAgent,
    WriterAgent,
    CriticAgent,
    EditorAgent,
    AgentPipelineService,
  ],
  exports: [AgentPipelineService],
})
export class AgentsModule {}
