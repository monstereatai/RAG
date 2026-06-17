import { Module } from '@nestjs/common';
import { LlmProvider } from './llm.provider';
import { QwenLlmProvider } from './qwen-llm.provider';

@Module({
  providers: [LlmProvider, QwenLlmProvider],
  exports: [LlmProvider],
})
export class LlmModule {}
