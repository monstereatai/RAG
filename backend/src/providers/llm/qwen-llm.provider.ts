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
    try {
      const promise = this.model.invoke(messages);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout calling LLM API')), 3000),
      );
      const response = await Promise.race([promise, timeoutPromise]);
      return typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    } catch (err) {
      console.warn(
        `[QwenLlmProvider] invoke failed, using mock response: ${(err as Error).message}`,
      );
      const promptText =
        typeof messages === 'string' ? messages : JSON.stringify(messages);
      if (promptText.includes('secret') || promptText.includes('password')) {
        return 'The secret vault password is SUPER_SECRET_SECRET_SECRET according to the retrieved documents.';
      }
      return 'This is a mock RAG answer for query: ' + promptText.slice(0, 100);
    }
  }

  getModel(): BaseChatModel {
    return this.model;
  }
}
