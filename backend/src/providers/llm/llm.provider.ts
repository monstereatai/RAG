import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ILLMProvider, LlmModelProvider } from './llm-provider.interface';
import { DeepseekLlmProvider } from './deepseek-llm.provider';
import { QwenLlmProvider } from './qwen-llm.provider';
import { ZhipuLlmProvider } from './zhipu-llm.provider';
import {
  LlmGatewayPolicy,
  LlmTask,
  LlmRoutePolicy,
} from './llm-gateway.policy';

/**
 * LLM Provider 工厂
 * 按 config.llm.provider 注入对应实现
 */
@Injectable()
export class LlmProvider implements ILLMProvider, OnModuleInit {
  private provider: ILLMProvider;
  private readonly requestModel = new AsyncLocalStorage<LlmModelProvider>();
  private readonly gatewayPolicy: LlmGatewayPolicy;

  constructor(
    private readonly config: ConfigService,
    private readonly qwenProvider: QwenLlmProvider,
    private readonly deepseekProvider: DeepseekLlmProvider,
    private readonly zhipuProvider: ZhipuLlmProvider,
  ) {
    this.gatewayPolicy = new LlmGatewayPolicy(this.config);
  }

  onModuleInit() {
    const providerName = this.config.get<string>('llm.provider') ?? 'qwen';
    switch (providerName) {
      case 'qwen':
        this.provider = this.qwenProvider;
        break;
      case 'deepseek':
        this.provider = this.deepseekProvider;
        break;
      case 'zhipu':
        this.provider = this.zhipuProvider;
        break;
      default:
        throw new Error(`Unsupported LLM provider: ${providerName}`);
    }
  }

  invoke(
    messages: string | Parameters<ILLMProvider['invoke']>[0],
    model?: LlmModelProvider,
  ): Promise<string> {
    return this.resolveProvider(model).invoke(messages);
  }

  getModel(model?: LlmModelProvider): BaseChatModel {
    return this.resolveProvider(model).getModel();
  }

  getActiveProviderName(): LlmModelProvider {
    return this.requestModel.getStore() ?? this.getDefaultProviderName();
  }

  getRoutePolicy(
    task: LlmTask = 'fast',
    requested?: LlmModelProvider,
  ): LlmRoutePolicy {
    return this.gatewayPolicy.resolve(task, requested);
  }

  runWithModel<T>(
    model: LlmModelProvider | undefined,
    callback: () => Promise<T>,
  ): Promise<T> {
    const selected = model ?? this.getDefaultProviderName();
    return this.requestModel.run(selected, callback);
  }

  private resolveProvider(model?: LlmModelProvider): ILLMProvider {
    const selected = model ?? this.requestModel.getStore();
    switch (selected) {
      case 'qwen':
        return this.qwenProvider;
      case 'deepseek':
        return this.deepseekProvider;
      case 'zhipu':
        return this.zhipuProvider;
      case undefined:
        return this.provider;
      default:
        throw new Error(`Unsupported LLM provider: ${String(selected)}`);
    }
  }

  private getDefaultProviderName(): LlmModelProvider {
    const providerName = this.config.get<string>('llm.provider') ?? 'qwen';
    return providerName === 'deepseek' || providerName === 'zhipu'
      ? providerName
      : 'qwen';
  }
}
