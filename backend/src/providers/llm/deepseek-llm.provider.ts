import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseMessageLike } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../../modules/metrics/metrics.service';
import { ILLMProvider } from './llm-provider.interface';

/**
 * DeepSeek LLM Provider
 * 通过 OpenAI 兼容接口调用 DeepSeek。
 */
@Injectable()
export class DeepseekLlmProvider implements ILLMProvider {
  private readonly logger = new Logger(DeepseekLlmProvider.name);
  private readonly model: ChatOpenAI;

  constructor(
    private readonly config: ConfigService,
    private readonly metricsService: MetricsService,
  ) {
    const apiKey = this.config.get<string>('llm.deepseek.apiKey');
    const baseUrl = this.config.get<string>('llm.deepseek.baseUrl');
    const modelName = this.config.get<string>('llm.deepseek.model');
    const timeoutMs =
      this.config.get<number>('llm.deepseek.timeoutMs') ?? 30000;

    this.model = new ChatOpenAI({
      temperature: 0.7,
      model: modelName,
      apiKey: apiKey || 'missing-deepseek-api-key',
      timeout: timeoutMs,
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
      const timeoutMs =
        this.config.get<number>('llm.deepseek.timeoutMs') ?? 30000;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Timeout calling LLM API')),
          timeoutMs,
        ),
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
        `[DeepseekLlmProvider] invoke failed, using mock response: ${(err as Error).message}`,
      );
      const promptText =
        typeof messages === 'string' ? messages : JSON.stringify(messages);
      const answer =
        'This is a mock DeepSeek RAG answer for query: ' +
        promptText.slice(0, 100);
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
      'deepseek',
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
