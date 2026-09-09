import { Module } from '@nestjs/common';
import { MetricsModule } from '../../modules/metrics/metrics.module';
import { DeepseekLlmProvider } from './deepseek-llm.provider';
import { LlmProvider } from './llm.provider';
import { QwenLlmProvider } from './qwen-llm.provider';
import { ZhipuLlmProvider } from './zhipu-llm.provider';

@Module({
  imports: [MetricsModule],
  providers: [
    LlmProvider,
    QwenLlmProvider,
    DeepseekLlmProvider,
    ZhipuLlmProvider,
  ],
  exports: [LlmProvider],
})
export class LlmModule {}
