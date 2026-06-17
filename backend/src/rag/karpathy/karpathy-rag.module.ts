import { Module } from '@nestjs/common';
import { KarpathyRagService } from './karpathy-rag.service';
import { LlmModule } from '../../providers/llm/llm.module';
import { EmbeddingModule } from '../../providers/embedding/embedding.module';
import { VectorStoreModule } from '../../providers/vector-store/vector-store.module';

@Module({
  imports: [LlmModule, EmbeddingModule, VectorStoreModule],
  providers: [KarpathyRagService],
  exports: [KarpathyRagService],
})
export class KarpathyRagModule {}
