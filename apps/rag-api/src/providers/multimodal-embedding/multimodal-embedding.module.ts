import { Module } from '@nestjs/common';
import { MetricsModule } from '../../modules/metrics/metrics.module';
import { LlmModule } from '../llm/llm.module';
import { MultimodalEmbeddingProvider } from './multimodal-embedding.provider';

/**
 * 多模态嵌入模块（DashScope multimodal-embedding）
 * 文本与图片同一向量空间，供图片索引/检索（ImageIndexService）使用
 */
@Module({
  imports: [LlmModule, MetricsModule],
  providers: [MultimodalEmbeddingProvider],
  exports: [MultimodalEmbeddingProvider],
})
export class MultimodalEmbeddingModule {}
