import { Injectable } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { BaseMessageLike } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ILLMProvider, LlmInvokeOptions } from './llm-provider.interface';
import { MetricsService } from '../../modules/metrics/metrics.service';
import { LlmInvocationError } from './llm-invocation.error';
import { readLlmUsage } from './llm-usage';
import {
  createLlmUsageCallback,
  hasLlmUsageObserver,
} from './llm-usage-context';

/**
 * 通义千问 LLM Provider
 * 通过 OpenAI 兼容接口调用 DashScope
 */
@Injectable()
export class QwenLlmProvider implements ILLMProvider {
  private readonly logger = new Logger(QwenLlmProvider.name);
  private readonly model: ChatOpenAI;
  private readonly agenticModel: ChatOpenAI;
  private readonly modelName: string;

  constructor(
    private readonly config: ConfigService,
    private readonly metricsService: MetricsService,
  ) {
    const apiKey = this.config.get<string>('llm.qwen.apiKey');
    const baseUrl = this.config.get<string>('llm.qwen.baseUrl');
    const modelName = this.config.get<string>('llm.qwen.model');
    this.modelName = modelName ?? 'unknown';
    const agenticModelName =
      this.config.get<string>('llm.qwen.agenticModel') ?? this.modelName;
    const timeoutMs = this.config.get<number>('llm.qwen.timeoutMs') ?? 60000;
    const maxTokens = this.config.get<number>('llm.qwen.maxTokens') ?? 4096;
    const maxRetries = this.config.get<number>('llm.qwen.maxRetries') ?? 2;
    const temperature = this.config.get<number>('llm.qwen.temperature') ?? 0.2;

    const createModel = (selectedModelName: string) =>
      new ChatOpenAI({
        temperature,
        model: selectedModelName,
        apiKey: apiKey || 'missing-qwen-api-key',
        timeout: timeoutMs,
        maxTokens,
        maxRetries,
        configuration: { baseURL: baseUrl },
        callbacks: [
          createLlmUsageCallback((usage) =>
            this.metricsService.observeLlmUsage(
              'qwen',
              selectedModelName,
              usage,
            ),
          ),
        ],
      });
    this.model = createModel(this.modelName);
    this.agenticModel =
      agenticModelName === this.modelName
        ? this.model
        : createModel(agenticModelName);
  }

  /** 合并请求取消与 Provider 超时，统一统计用量，并把底层异常包装成可识别的调用错误。 */
  async invoke(
    messages: string | BaseMessageLike[],
    options: LlmInvokeOptions = {},
  ): Promise<string> {
    const start = process.hrtime.bigint();
    const inputTokensEstimated = this.estimateTokens(
      typeof messages === 'string' ? messages : JSON.stringify(messages),
    );
    try {
      const timeoutMs = this.config.get<number>('llm.qwen.timeoutMs') ?? 60000;
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signal = options.signal
        ? AbortSignal.any([options.signal, timeoutSignal])
        : timeoutSignal;
      // cd： 调用langchain new ChatOpenAI的 invoke 方法
      const response = await this.model.invoke(messages, {
        signal,
        ...(options.metadata ? { metadata: options.metadata } : {}),
      });
      // cd：统计token用量
      const usage = readLlmUsage(response);
      if (usage) {
        // 经由 LlmProvider.runWithUsage 时，模型回调已采集真实 usage；避免重复计数。
        if (!hasLlmUsageObserver()) options.onUsage?.(usage);
      }
      const answer =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);
      if (!answer.trim()) {
        throw new Error('Qwen returned an empty completion');
      }
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

  getAgenticModel(): BaseChatModel {
    return this.agenticModel;
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
