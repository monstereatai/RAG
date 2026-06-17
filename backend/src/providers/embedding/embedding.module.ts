import { Module } from '@nestjs/common';
import { EmbeddingProvider } from './embedding.provider';
import { QwenEmbeddingProvider } from './qwen-embedding.provider';

@Module({
  providers: [EmbeddingProvider, QwenEmbeddingProvider],
  exports: [EmbeddingProvider],
})
export class EmbeddingModule {}
