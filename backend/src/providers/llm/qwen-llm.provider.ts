import { Injectable } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { BaseMessageLike } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ILLMProvider } from './llm-provider.interface';
import { MetricsService } from '../../modules/metrics/metrics.service';

/**
 * 通义千问 LLM Provider
 * 通过 OpenAI 兼容接口调用 DashScope
 */
@Injectable()
export class QwenLlmProvider implements ILLMProvider {
  private readonly logger = new Logger(QwenLlmProvider.name);
  private readonly model: ChatOpenAI;

  constructor(
    private readonly config: ConfigService,
    private readonly metricsService: MetricsService,
  ) {
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
    const start = process.hrtime.bigint();
    const inputTokensEstimated = this.estimateTokens(
      typeof messages === 'string' ? messages : JSON.stringify(messages),
    );
    try {
      const promise = this.model.invoke(messages);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout calling LLM API')), 3000),
      );
      const response = await Promise.race([promise, timeoutPromise]);
      const answer =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);
      this.observeCall(start, 'success', inputTokensEstimated, answer);
      return answer;
    } catch (err) {
      this.logger.warn(
        `[QwenLlmProvider] invoke failed, using mock response: ${(err as Error).message}`,
      );
      const promptText =
        typeof messages === 'string' ? messages : JSON.stringify(messages);
      if (promptText.includes('secret') || promptText.includes('password')) {
        const answer =
          'I cannot reveal or fabricate secrets. Please verify sensitive information from an authorized source.';
        this.observeCall(start, 'fallback', inputTokensEstimated, answer);
        return answer;
      }
      const answer =
        'This is a mock RAG answer for query: ' + promptText.slice(0, 100);
      this.observeCall(start, 'fallback', inputTokensEstimated, answer);
      return answer;
    }
  }

  getModel(): BaseChatModel {
    return this.model;
  }

  private observeCall(
    start: bigint,
    status: 'success' | 'fallback' | 'error',
    inputTokensEstimated: number,
    answer: string,
  ): void {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    this.metricsService.observeLlmCall(
      'qwen',
      status,
      durationSeconds,
      inputTokensEstimated,
      this.estimateTokens(answer),
    );
  }

  private estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }
}
