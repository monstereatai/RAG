import { Injectable } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { BaseMessageLike } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ILLMProvider } from './llm-provider.interface';
import { MetricsService } from '../../modules/metrics/metrics.service';
import { LlmInvocationError } from './llm-invocation.error';

/**
 * 通义千问 LLM Provider
 * 通过 OpenAI 兼容接口调用 DashScope
 */
@Injectable()
export class QwenLlmProvider implements ILLMProvider {
  private readonly logger = new Logger(QwenLlmProvider.name);
  private readonly model: ChatOpenAI;
  private readonly modelName: string;

  constructor(
    private readonly config: ConfigService,
    private readonly metricsService: MetricsService,
  ) {
    const apiKey = this.config.get<string>('llm.qwen.apiKey');
    const baseUrl = this.config.get<string>('llm.qwen.baseUrl');
    const modelName = this.config.get<string>('llm.qwen.model');
    this.modelName = modelName ?? 'unknown';
    const timeoutMs = this.config.get<number>('llm.qwen.timeoutMs') ?? 60000;
    const maxTokens = this.config.get<number>('llm.qwen.maxTokens') ?? 4096;
    const maxRetries = this.config.get<number>('llm.qwen.maxRetries') ?? 2;
    const temperature = this.config.get<number>('llm.qwen.temperature') ?? 0.2;

    if (!apiKey) {
      throw new Error('QWEN_API_KEY is required');
    }

    this.model = new ChatOpenAI({
      temperature,
      model: modelName,
      apiKey,
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
      const timeoutMs = this.config.get<number>('llm.qwen.timeoutMs') ?? 60000;
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
        '[QwenLlmProvider] invoke failed; propagating controlled provider error',
      );
      this.observeCall(start, 'error', inputTokensEstimated, '');
      throw new LlmInvocationError('qwen', err);
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
      'qwen',
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
