import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseMessageLike } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../../modules/metrics/metrics.service';
import { ILLMProvider } from './llm-provider.interface';

/** 智谱 GLM Provider：复用官方 OpenAI 兼容接口，不依赖专有 SDK。 */
@Injectable()
export class ZhipuLlmProvider implements ILLMProvider {
  private readonly logger = new Logger(ZhipuLlmProvider.name);
  private readonly model: ChatOpenAI;

  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {
    const apiKey = this.config.get<string>('llm.zhipu.apiKey');
    const baseUrl = this.config.get<string>('llm.zhipu.baseUrl');
    const model = this.config.get<string>('llm.zhipu.model');
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
    });
  }

  async invoke(messages: string | BaseMessageLike[]): Promise<string> {
    const startedAt = process.hrtime.bigint();
    const input =
      typeof messages === 'string' ? messages : JSON.stringify(messages);
    try {
      const response = await this.model.invoke(messages, {
        signal: AbortSignal.timeout(
          this.config.get<number>('llm.zhipu.timeoutMs') ?? 60_000,
        ),
      });
      const answer =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);
      this.observe(startedAt, 'success', input, answer);
      return answer;
    } catch (error) {
      this.logger.warn(
        `[ZhipuLlmProvider] invoke failed: ${(error as Error).message}`,
      );
      this.observe(startedAt, 'error', input, '');
      throw error;
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
