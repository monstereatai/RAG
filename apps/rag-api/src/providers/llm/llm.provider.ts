import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ILLMProvider, LlmModelProvider } from './llm-provider.interface';
import { DeepseekLlmProvider } from './deepseek-llm.provider';
import { QwenLlmProvider } from './qwen-llm.provider';
import { ZhipuLlmProvider } from './zhipu-llm.provider';
import type { LlmInvokeOptions } from './llm-provider.interface';
import { runWithLlmUsageObserver } from './llm-usage-context';
import { LlmInvocationError } from './llm-invocation.error';
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
  private readonly logger = new Logger(LlmProvider.name);
  private readonly modelWrappers = new WeakMap<object, object>();
  private readonly gatewayPolicy: LlmGatewayPolicy;
  private readonly requestTimeoutMs: number;
  private readonly circuitFailureThreshold: number;
  private readonly circuitOpenMs: number;
  private readonly circuitStates = new Map<
    LlmModelProvider,
    { failures: number; openUntil: number; probeInFlight: boolean }
  >();

  constructor(
    private readonly config: ConfigService,
    private readonly qwenProvider: QwenLlmProvider,
    private readonly deepseekProvider: DeepseekLlmProvider,
    private readonly zhipuProvider: ZhipuLlmProvider,
  ) {
    this.gatewayPolicy = new LlmGatewayPolicy(this.config);
    this.requestTimeoutMs =
      this.config.get<number>('llm.requestTimeoutMs') ?? 90_000;
    this.circuitFailureThreshold = Math.max(
      1,
      this.config.get<number>('llm.circuitBreaker.failureThreshold') ?? 2,
    );
    this.circuitOpenMs = Math.max(
      1_000,
      this.config.get<number>('llm.circuitBreaker.openMs') ?? 30_000,
    );
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
    const requested =
      model ?? this.requestModel.getStore() ?? this.getDefaultProviderName();
    const policy = this.gatewayPolicy.resolve('fast', requested);
    const candidates: LlmModelProvider[] = [requested];
    if (policy.fallback && policy.fallback !== requested) {
      candidates.push(policy.fallback);
    }
    return this.invokeWithFallback(messages, candidates, providerOptions);
  }

  getModel(model?: LlmModelProvider): BaseChatModel {
    return this.wrapModel(this.resolveProvider(model).getModel());
  }

  getAgenticModel(model?: LlmModelProvider): BaseChatModel {
    const provider = this.resolveProvider(model);
    return this.wrapModel(provider.getAgenticModel?.() ?? provider.getModel());
  }

  getActiveProviderName(): LlmModelProvider {
    return this.requestModel.getStore() ?? this.getDefaultProviderName();
  }

  getFallbackProviderName(): LlmModelProvider | null {
    return this.gatewayPolicy.resolve(
      'fast',
      this.getActiveProviderName(),
    ).fallback;
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
    const upstreamSignal = this.requestSignal.getStore();
    const timeoutSignal = AbortSignal.timeout(this.requestTimeoutMs);
    const signal = upstreamSignal
      ? AbortSignal.any([upstreamSignal, timeoutSignal])
      : timeoutSignal;

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

  private async invokeWithFallback(
    messages: string | Parameters<ILLMProvider['invoke']>[0],
    candidates: LlmModelProvider[],
    options: LlmInvokeOptions,
  ): Promise<string> {
    let primaryError: unknown;
    for (const providerName of candidates) {
      if (this.canAttemptProvider(providerName) === false) {
        this.logger.warn(
          `LLM circuit open for provider=${providerName}; trying next route`,
        );
        continue;
      }
      try {
        const answer = await this.invokeResolvedProvider(
          providerName,
          messages,
          options,
        );
        this.recordProviderSuccess(providerName);
        return answer;
      } catch (error) {
        this.recordProviderFailure(providerName);
        if (options.signal?.aborted === true) throw error;
        if (primaryError === undefined) primaryError = error;
        this.logger.warn(
          `LLM provider=${providerName} failed; fallback will be attempted when configured`,
        );
      }
    }
    if (primaryError !== undefined) throw primaryError;
    throw new LlmInvocationError(
      candidates[0] ?? this.getDefaultProviderName(),
      new Error('all LLM providers unavailable'),
    );
  }

  private invokeResolvedProvider(
    providerName: LlmModelProvider,
    messages: string | Parameters<ILLMProvider['invoke']>[0],
    options: LlmInvokeOptions,
  ): Promise<string> {
    const provider = this.resolveProvider(providerName);
    return this.requestModel.run(providerName, () =>
      Object.keys(options).length > 0
        ? provider.invoke(messages, options)
        : provider.invoke(messages),
    );
  }

  isProviderCircuitOpen(provider: LlmModelProvider): boolean {
    const state = this.circuitStates.get(provider);
    return state !== undefined && state.openUntil > Date.now();
  }

  private canAttemptProvider(provider: LlmModelProvider): boolean {
    const state = this.circuitStates.get(provider);
    if (state === undefined || state.openUntil === 0) return true;
    const now = Date.now();
    if (now < state.openUntil) return false;
    if (state.probeInFlight) return false;
    state.probeInFlight = true;
    state.openUntil = 0;
    return true;
  }

  recordProviderFailure(provider: LlmModelProvider): void {
    const state = this.circuitStates.get(provider) ?? {
      failures: 0,
      openUntil: 0,
      probeInFlight: false,
    };
    state.failures += 1;
    state.probeInFlight = false;
    if (state.failures >= this.circuitFailureThreshold) {
      state.openUntil = Date.now() + this.circuitOpenMs;
    }
    this.circuitStates.set(provider, state);
  }

  recordProviderSuccess(provider: LlmModelProvider): void {
    this.circuitStates.set(provider, {
      failures: 0,
      openUntil: 0,
      probeInFlight: false,
    });
  }

  private getDefaultProviderName(): LlmModelProvider {
    const providerName = this.config.get<string>('llm.provider') ?? 'qwen';
    return providerName === 'deepseek' || providerName === 'zhipu'
      ? providerName
      : 'qwen';
  }
}
