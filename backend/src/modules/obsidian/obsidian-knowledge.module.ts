import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmModule } from '../../providers/llm/llm.module';
import { ObsidianGraphController } from './obsidian-graph.controller';
import { ObsidianKnowledgeService } from './obsidian-knowledge.service';
import { ObsidianProjectWorkflowController } from './obsidian-project-workflow.controller';

@Module({
  imports: [ConfigModule, LlmModule],
  controllers: [ObsidianGraphController, ObsidianProjectWorkflowController],
  providers: [ObsidianKnowledgeService],
  exports: [ObsidianKnowledgeService],
})
export class ObsidianKnowledgeModule {}
