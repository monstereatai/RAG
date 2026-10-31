import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MetricsModule } from '../../modules/metrics/metrics.module';
import { LlmModule } from '../llm/llm.module';
import { VisionProvider } from './vision.provider';
import { MockVisionProvider } from './mock-vision.provider';
import { OpenAiVisionProvider } from './openai-vision.provider';

@Global()
@Module({
  imports: [ConfigModule, LlmModule, MetricsModule],
  providers: [MockVisionProvider, OpenAiVisionProvider, VisionProvider],
  exports: [VisionProvider],
})
export class VisionModule {}
