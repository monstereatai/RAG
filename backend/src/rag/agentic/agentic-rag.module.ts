import { Module } from '@nestjs/common';
import { AgenticRagService } from './agentic-rag.service';
import { KarpathyRagModule } from '../karpathy/karpathy-rag.module';
import { LlmModule } from '../../providers/llm/llm.module';
import { ToolsModule } from '../../tools/tools.module';
import { PromptModule } from '../prompts/prompt.module';
import { MetricsModule } from '../../modules/metrics/metrics.module';
import { TracingModule } from '../../modules/tracing/tracing.module';
import { GraphModule } from '../../modules/graph/graph.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgenticStructuredArtifactEntity } from '../../providers/db/entities/agentic-structured-artifact.entity';

@Module({
  imports: [
    KarpathyRagModule,
    LlmModule,
    ToolsModule,
    PromptModule,
    MetricsModule,
    TracingModule,
    GraphModule,
    TypeOrmModule.forFeature([AgenticStructuredArtifactEntity]),
  ],
  providers: [AgenticRagService],
  exports: [AgenticRagService],
})
export class AgenticRagModule {}
