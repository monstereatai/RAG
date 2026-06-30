import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VisionProvider } from './vision.provider';
import { MockVisionProvider } from './mock-vision.provider';
import { OpenAiVisionProvider } from './openai-vision.provider';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    MockVisionProvider,
    OpenAiVisionProvider,
    VisionProvider,
  ],
  exports: [VisionProvider],
})
export class VisionModule {}
