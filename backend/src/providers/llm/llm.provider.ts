import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ILLMProvider } from './llm-provider.interface';
import { QwenLlmProvider } from './qwen-llm.provider';

/**
 * LLM Provider 工厂
 * 按 config.llm.provider 注入对应实现
 */
@Injectable()
export class LlmProvider implements ILLMProvider, OnModuleInit {
  private provider: ILLMProvider;

  constructor(
    private readonly config: ConfigService,
    private readonly qwenProvider: QwenLlmProvider,
  ) {}

  onModuleInit() {
    const providerName = this.config.get<string>('llm.provider') ?? 'qwen';
    switch (providerName) {
      case 'qwen':
        this.provider = this.qwenProvider;
        break;
      default:
        throw new Error(`Unsupported LLM provider: ${providerName}`);
    }
  }

  invoke(
    messages: string | Parameters<ILLMProvider['invoke']>[0],
  ): Promise<string> {
    return this.provider.invoke(messages);
  }

  getModel(): BaseChatModel {
    return this.provider.getModel();
  }
}
