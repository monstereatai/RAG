import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseMessageLike } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../../modules/metrics/metrics.service';
import { ILLMProvider, LlmInvokeOptions } from './llm-provider.interface';
import { LlmInvocationError } from './llm-invocation.error';
import { readLlmUsage } from './llm-usage';
import {
  createLlmUsageCallback,
  hasLlmUsageObserver,
} from './llm-usage-context';

/** 智谱 GLM Provider：复用官方 OpenAI 兼容接口，不依赖专有 SDK。 */
@Injectable()
export class ZhipuLlmProvider implements ILLMProvider {
  private readonly logger = new Logger(ZhipuLlmProvider.name);
  private readonly model: ChatOpenAI;
  private readonly modelName: string;

  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {
    const apiKey = this.config.get<string>('llm.zhipu.apiKey');
    const baseUrl = this.config.get<string>('llm.zhipu.baseUrl');
    const model = this.config.get<string>('llm.zhipu.model');
    this.modelName = model ?? 'unknown';
    const timeout = this.config.get<number>('llm.zhipu.timeoutMs') ?? 60_000;
    this.model = new ChatOpenAI({
      model,
      // Provider 在 Nest 启动时全部实例化；未选择智谱前不应因暂未配置 Key 阻断 Qwen／DeepSeek。
      apiKey: apiKey || 'missing-zhipu-api-key',
      temperature: this.config.get<number>('llm.zhipu.temperature') ?? 0.2,
      timeout,
      maxTokens: this.config.get<number>('llm.zhipu.maxTokens') ?? 4096,
      maxRetries: this.config.get<number>('llm.zhipu.maxRetries') ?? 2,
      configuration: { baseURL: baseUrl },
      callbacks: [
        createLlmUsageCallback((usage) =>
          this.metrics.observeLlmUsage('zhipu', this.modelName, usage),
        ),
      ],
    });
  }

  async invoke(
    messages: string | BaseMessageLike[],
    options: LlmInvokeOptions = {},
  ): Promise<string> {
    const startedAt = process.hrtime.bigint();
    const input =
      typeof messages === 'string' ? messages : JSON.stringify(messages);
    try {
      const timeoutSignal = AbortSignal.timeout(
        this.config.get<number>('llm.zhipu.timeoutMs') ?? 60_000,
      );
      const signal = options.signal
        ? AbortSignal.any([options.signal, timeoutSignal])
        : timeoutSignal;
      const response = await this.model.invoke(messages, { signal });
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
        throw new Error('Zhipu returned an empty completion');
      }
      this.observe(startedAt, 'success', input, answer);
      return answer;
    } catch (error) {
      this.logger.warn(
        `[ZhipuLlmProvider] invoke failed: ${(error as Error).message}`,
      );
      this.observe(startedAt, 'error', input, '');
      throw new LlmInvocationError('zhipu', error);
    }
  }

  getModel(): BaseChatModel {
    return this.model;
  }

  private observe(
    startedAt: bigint,
    status: 'success' | 'error',
    input: string,
    output: string,
  ) {
    this.metrics.observeLlmCall(
      'zhipu',
      this.modelName,
      status,
      Number(process.hrtime.bigint() - startedAt) / 1e9,
      this.tokens(input),
      this.tokens(output),
    );
  }

  private tokens(value: string) {
    return Math.max(1, Math.ceil(value.length / 4));
  }
}
