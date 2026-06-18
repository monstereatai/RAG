import { Module } from '@nestjs/common';
import { AgenticRagService } from './agentic-rag.service';
import { KarpathyRagModule } from '../karpathy/karpathy-rag.module';
import { LlmModule } from '../../providers/llm/llm.module';
import { ToolsModule } from '../../tools/tools.module';
import { PromptModule } from '../prompts/prompt.module';

@Module({
  imports: [KarpathyRagModule, LlmModule, ToolsModule, PromptModule],
  providers: [AgenticRagService],
  exports: [AgenticRagService],
})
export class AgenticRagModule {}
