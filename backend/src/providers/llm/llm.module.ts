import { Module } from '@nestjs/common';
import { MetricsModule } from '../../modules/metrics/metrics.module';
import { LlmProvider } from './llm.provider';
import { QwenLlmProvider } from './qwen-llm.provider';

@Module({
  imports: [MetricsModule],
  providers: [LlmProvider, QwenLlmProvider],
  exports: [LlmProvider],
})
export class LlmModule {}
