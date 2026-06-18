import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { BaseMessageLike } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ILLMProvider } from './llm-provider.interface';

/**
 * 通义千问 LLM Provider
 * 通过 OpenAI 兼容接口调用 DashScope
 */
@Injectable()
export class QwenLlmProvider implements ILLMProvider {
  private readonly model: ChatOpenAI;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('llm.qwen.apiKey');
    const baseUrl = this.config.get<string>('llm.qwen.baseUrl');
    const modelName = this.config.get<string>('llm.qwen.model');

    if (!apiKey) {
      throw new Error('QWEN_API_KEY is required');
    }

    this.model = new ChatOpenAI({
      temperature: 0.7,
      model: modelName,
      apiKey,
      configuration: { baseURL: baseUrl },
    });
  }

  async invoke(messages: string | BaseMessageLike[]): Promise<string> {
    const response = await this.model.invoke(messages);
    return typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
  }

  getModel(): BaseChatModel {
    return this.model;
  }
}
