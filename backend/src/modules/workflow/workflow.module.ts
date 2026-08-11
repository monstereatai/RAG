import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { LlmModule } from '../../providers/llm/llm.module';
import { ProductionWorkflowService } from './production-workflow.service';
import { KarpathyRagModule } from '../../rag/karpathy/karpathy-rag.module';
import { ArtifactsModule } from '../artifacts/artifacts.module';
import { ProductionWorkflowTools } from './production-workflow.tools';
import { ObservabilityModule } from '../../providers/observability/observability.module';

@Module({
  imports: [
    LlmModule,
    KarpathyRagModule,
    ArtifactsModule,
    ObservabilityModule,
  ],
  controllers: [WorkflowController],
  providers: [ProductionWorkflowService, ProductionWorkflowTools],
  exports: [ProductionWorkflowService],
})
export class WorkflowModule {}
