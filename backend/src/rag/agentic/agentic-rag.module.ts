import { Module } from '@nestjs/common';
import { AgenticRagService } from './agentic-rag.service';
import { KarpathyRagModule } from '../karpathy/karpathy-rag.module';
import { LlmModule } from '../../providers/llm/llm.module';

@Module({
  imports: [KarpathyRagModule, LlmModule],
  providers: [AgenticRagService],
  exports: [AgenticRagService],
})
export class AgenticRagModule {}
