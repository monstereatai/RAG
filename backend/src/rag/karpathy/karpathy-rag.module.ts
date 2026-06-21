import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KarpathyRagService } from './karpathy-rag.service';
import { LlmModule } from '../../providers/llm/llm.module';
import { EmbeddingModule } from '../../providers/embedding/embedding.module';
import { VectorStoreModule } from '../../providers/vector-store/vector-store.module';
import { MetricsModule } from '../../modules/metrics/metrics.module';

@Module({
  imports: [
    ConfigModule,
    LlmModule,
    EmbeddingModule,
    VectorStoreModule,
    MetricsModule,
  ],
  providers: [KarpathyRagService],
  exports: [KarpathyRagService],
})
export class KarpathyRagModule {}
