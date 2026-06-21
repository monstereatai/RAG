import { Module } from '@nestjs/common';
import { MetricsModule } from '../../modules/metrics/metrics.module';
import { EmbeddingProvider } from './embedding.provider';
import { QwenEmbeddingProvider } from './qwen-embedding.provider';

@Module({
  imports: [MetricsModule],
  providers: [EmbeddingProvider, QwenEmbeddingProvider],
  exports: [EmbeddingProvider],
})
export class EmbeddingModule {}
