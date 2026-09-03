import { Module } from '@nestjs/common';
import { MultimodalEmbeddingProvider } from './multimodal-embedding.provider';

/**
 * 多模态嵌入模块（DashScope multimodal-embedding）
 * 文本与图片同一向量空间，供图片索引/检索（ImageIndexService）使用
 */
@Module({
  providers: [MultimodalEmbeddingProvider],
  exports: [MultimodalEmbeddingProvider],
})
export class MultimodalEmbeddingModule {}
