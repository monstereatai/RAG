import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KarpathyRagService } from './karpathy-rag.service';
import { LlmModule } from '../../providers/llm/llm.module';
import { EmbeddingModule } from '../../providers/embedding/embedding.module';
import { VectorStoreModule } from '../../providers/vector-store/vector-store.module';

@Module({
  imports: [ConfigModule, LlmModule, EmbeddingModule, VectorStoreModule],
  providers: [KarpathyRagService],
  exports: [KarpathyRagService],
})
export class KarpathyRagModule {}
