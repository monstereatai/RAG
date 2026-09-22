import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ILLMProvider, LlmModelProvider } from './llm-provider.interface';
import { DeepseekLlmProvider } from './deepseek-llm.provider';
import { QwenLlmProvider } from './qwen-llm.provider';
import { ZhipuLlmProvider } from './zhipu-llm.provider';
import type { LlmInvokeOptions } from './llm-provider.interface';
import { runWithLlmUsageObserver } from './llm-usage-context';
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
  private readonly requestSignal = new AsyncLocalStorage<AbortSignal>();
  private readonly requestUsage = new AsyncLocalStorage<
    NonNullable<LlmInvokeOptions['onUsage']>
  >();
  private readonly modelWrappers = new WeakMap<object, object>();
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
    modelOrOptions?: LlmModelProvider | LlmInvokeOptions,
    options?: LlmInvokeOptions,
  ): Promise<string> {
    const model =
      typeof modelOrOptions === 'string' ? modelOrOptions : undefined;
    const invokeOptions =
      typeof modelOrOptions === 'string' ? options : modelOrOptions;
    const signal = invokeOptions?.signal ?? this.requestSignal.getStore();
    const onUsage = invokeOptions?.onUsage ?? this.requestUsage.getStore();
    const providerOptions = {
      ...(signal ? { signal } : {}),
      ...(onUsage ? { onUsage } : {}),
    };
    return Object.keys(providerOptions).length > 0
      ? this.resolveProvider(model).invoke(messages, providerOptions)
      : this.resolveProvider(model).invoke(messages);
  }

  getModel(model?: LlmModelProvider): BaseChatModel {
    return this.wrapModel(this.resolveProvider(model).getModel());
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

  runWithSignal<T>(
    signal: AbortSignal | undefined,
    callback: () => Promise<T>,
  ): Promise<T> {
    if (!signal) return callback();
    return this.requestSignal.run(signal, callback);
  }

  runWithUsage<T>(
    onUsage: NonNullable<LlmInvokeOptions['onUsage']>,
    callback: () => Promise<T>,
  ): Promise<T> {
    return this.requestUsage.run(onUsage, () =>
      runWithLlmUsageObserver(onUsage, callback),
    );
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

  /**
   * 底层 ChatModel 不经过 `LlmProvider.invoke()`，因此需要在 Runnable 边界补上传播中的
   * AbortSignal。结构化输出返回的 Runnable 也继续包装，避免只取消了外层链而没有取消模型。
   */
  private wrapModel<T extends object>(model: T): T {
    const cached = this.modelWrappers.get(model);
    if (cached) return cached as T;

    const wrapped = new Proxy(model, {
      get: (target, property, receiver) => {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') return value;

        if (
          property === 'invoke' ||
          property === 'stream' ||
          property === 'transform' ||
          property === 'batch'
        ) {
          return (...args: unknown[]) =>
            this.invokeRunnableMethod(
              target,
              value as (...args: unknown[]) => unknown,
              args,
            );
        }

        if (
          property === 'withStructuredOutput' ||
          property === 'withConfig' ||
          property === 'pipe' ||
          property === 'bind' ||
          property === 'withRetry' ||
          property === 'withFallbacks'
        ) {
          return (...args: unknown[]) =>
            this.wrapModel(Reflect.apply(value, receiver, args));
        }

        return value.bind(receiver);
      },
    });
    this.modelWrappers.set(model, wrapped);
    return wrapped as T;
  }

  private invokeRunnableMethod(
    target: object,
    method: (...args: unknown[]) => unknown,
    args: unknown[],
  ): unknown {
    const signal = this.requestSignal.getStore();
    if (!signal) return Reflect.apply(method, target, args);

    const options = args[1];
    const nextOptions = Array.isArray(options)
      ? options.map((item) =>
          item && typeof item === 'object'
            ? { ...(item as Record<string, unknown>), signal }
            : { signal },
        )
      : options && typeof options === 'object'
        ? { ...(options as Record<string, unknown>), signal }
        : { signal };
    return Reflect.apply(method, target, [
      args[0],
      nextOptions,
      ...args.slice(2),
    ]);
  }

  private getDefaultProviderName(): LlmModelProvider {
    const providerName = this.config.get<string>('llm.provider') ?? 'qwen';
    return providerName === 'deepseek' || providerName === 'zhipu'
      ? providerName
      : 'qwen';
  }
}
