import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseMessageLike } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../../modules/metrics/metrics.service';
import { ILLMProvider } from './llm-provider.interface';
import { LlmInvocationError } from './llm-invocation.error';

/**
 * DeepSeek LLM Provider
 * 通过 OpenAI 兼容接口调用 DeepSeek。
 */
@Injectable()
export class DeepseekLlmProvider implements ILLMProvider {
  private readonly logger = new Logger(DeepseekLlmProvider.name);
  private readonly model: ChatOpenAI;
  private readonly modelName: string;

  constructor(
    private readonly config: ConfigService,
    private readonly metricsService: MetricsService,
  ) {
    const apiKey = this.config.get<string>('llm.deepseek.apiKey');
    const baseUrl = this.config.get<string>('llm.deepseek.baseUrl');
    const modelName = this.config.get<string>('llm.deepseek.model');
    this.modelName = modelName ?? 'unknown';
    const timeoutMs =
      this.config.get<number>('llm.deepseek.timeoutMs') ?? 30000;
    const maxTokens = this.config.get<number>('llm.deepseek.maxTokens') ?? 4096;
    const maxRetries = this.config.get<number>('llm.deepseek.maxRetries') ?? 1;
    const temperature =
      this.config.get<number>('llm.deepseek.temperature') ?? 0.2;

    this.model = new ChatOpenAI({
      temperature,
      model: modelName,
      apiKey: apiKey || 'missing-deepseek-api-key',
      timeout: timeoutMs,
      maxTokens,
      maxRetries,
      configuration: { baseURL: baseUrl },
    });
  }

  async invoke(messages: string | BaseMessageLike[]): Promise<string> {
    const start = process.hrtime.bigint();
    const inputTokensEstimated = this.estimateTokens(
      typeof messages === 'string' ? messages : JSON.stringify(messages),
    );
    try {
      const timeoutMs =
        this.config.get<number>('llm.deepseek.timeoutMs') ?? 30000;
      const response = await this.model.invoke(messages, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      const answer =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);
      this.observeCall(start, 'success', inputTokensEstimated, answer);
      return answer;
    } catch (err) {
      this.logger.warn(
        '[DeepseekLlmProvider] invoke failed; propagating controlled provider error',
      );
      this.observeCall(start, 'error', inputTokensEstimated, '');
      throw new LlmInvocationError('deepseek', err);
    }
  }

  getModel(): BaseChatModel {
    return this.model;
  }

  private observeCall(
    start: bigint,
    status: 'success' | 'error',
    inputTokensEstimated: number,
    answer: string,
  ): void {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    this.metricsService.observeLlmCall(
      'deepseek',
      this.modelName,
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
