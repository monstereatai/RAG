import { AsyncLocalStorage } from 'node:async_hooks';
import {
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
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

class LlmInputBudgetExceededError extends Error {
  constructor(estimatedTokens: number, maxInputTokens: number) {
    super(
      `LLM input exceeds the shared context budget (${estimatedTokens}/${maxInputTokens} estimated tokens); reduce optional context before retrying.`,
    );
    this.name = 'LlmInputBudgetExceededError';
  }
}

type LlmRequestBudget = {
  calls: number;
  estimatedInputTokens: number;
  reservedTokens: number;
  maxCalls: number;
  maxInputTokens: number;
  maxTotalTokens: number;
};

export class LlmRequestBudgetExceededError extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

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
  private readonly requestBudget = new AsyncLocalStorage<LlmRequestBudget>();
  private readonly logger = new Logger(LlmProvider.name);
  private readonly modelWrappers = new WeakMap<object, object>();
  private readonly runnableMaxCalls = new WeakMap<object, number>();
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
    const selected =
      model ?? this.requestModel.getStore() ?? this.getDefaultProviderName();
    return this.wrapModel(this.resolveProvider(selected).getModel(), selected);
  }

  getAgenticModel(model?: LlmModelProvider): BaseChatModel {
    const selected =
      model ?? this.requestModel.getStore() ?? this.getDefaultProviderName();
    const provider = this.resolveProvider(selected);
    return this.wrapModel(
      provider.getAgenticModel?.() ?? provider.getModel(),
      selected,
    );
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

  /** 同一个 HTTP 请求或后台任务里的所有模型调用共用一个预算。 */
  runWithRequestBudget<T>(callback: () => T): T {
    if (this.requestBudget.getStore()) return callback();
    return this.requestBudget.run(
      {
        calls: 0,
        estimatedInputTokens: 0,
        reservedTokens: 0,
        maxCalls: this.positiveBudgetConfig('llm.requestBudget.maxCalls', 64),
        maxInputTokens: this.positiveBudgetConfig(
          'llm.requestBudget.maxInputTokens',
          200_000,
        ),
        maxTotalTokens: this.positiveBudgetConfig(
          'llm.requestBudget.maxTotalTokens',
          350_000,
        ),
      },
      callback,
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
  private wrapModel<T extends object>(
    model: T,
    providerName: LlmModelProvider,
  ): T {
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
              providerName,
              String(property),
            );
        }

        if (property === 'withStructuredOutput') {
          return (...args: unknown[]) => {
            const primaryRunnable = Reflect.apply(
              value,
              receiver,
              args,
            ) as {
              withFallbacks?: (fields: { fallbacks: object[] }) => object;
            };
            const fallbackProvider = this.gatewayPolicy.resolve(
              'structured',
              providerName,
            ).fallback;
            if (!fallbackProvider || fallbackProvider === providerName) {
              return this.wrapModel(primaryRunnable as object, providerName);
            }

            const fallbackModel =
              this.resolveProvider(fallbackProvider).getModel();
            const fallbackMethod = Reflect.get(
              fallbackModel,
              'withStructuredOutput',
            );
            if (typeof fallbackMethod !== 'function') {
              return this.wrapModel(primaryRunnable as object, providerName);
            }
            const fallbackRunnable = Reflect.apply(
              fallbackMethod,
              fallbackModel,
              args,
            ) as object;
            const runnable = primaryRunnable.withFallbacks
              ? Reflect.apply(primaryRunnable.withFallbacks, primaryRunnable, [
                  { fallbacks: [fallbackRunnable] },
                ])
              : primaryRunnable;
            this.runnableMaxCalls.set(
              runnable as object,
              primaryRunnable.withFallbacks ? 2 : 1,
            );
            return this.wrapModel(runnable as object, providerName);
          };
        }

        if (
          property === 'withConfig' ||
          property === 'pipe' ||
          property === 'bind' ||
          property === 'withRetry' ||
          property === 'withFallbacks'
        ) {
          return (...args: unknown[]) => {
            const derived = Reflect.apply(value, receiver, args) as object;
            const inheritedCalls = this.runnableMaxCalls.get(target) ?? 1;
            const addedFallbacks =
              property === 'withFallbacks' &&
              args[0] &&
              typeof args[0] === 'object' &&
              Array.isArray(
                (args[0] as { fallbacks?: unknown }).fallbacks,
              )
                ? (args[0] as { fallbacks: unknown[] }).fallbacks.length
                : 0;
            this.runnableMaxCalls.set(
              derived,
              inheritedCalls + addedFallbacks,
            );
            return this.wrapModel(derived, providerName);
          };
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
    providerName: LlmModelProvider,
    methodName: string,
  ): unknown {
    if (!this.isStreamingInput(args[0])) {
      this.assertInputWithinBudget(args[0], providerName);
    }
    const batchCalls =
      methodName === 'batch' && Array.isArray(args[0])
        ? Math.max(1, args[0].length)
        : 1;
    const maxCalls = this.runnableMaxCalls.get(target) ?? 1;
    this.reserveRequestBudget(
      args[0],
      providerName,
      batchCalls * maxCalls,
      maxCalls,
    );
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

  /**
   * Last-resort input guard for LangChain calls that bypass `LlmProvider.invoke()`.
   * Call sites can still trim optional context themselves; this guard prevents
   * unbounded prompts from reaching a provider when one of those paths is missed.
   */
  private assertInputWithinBudget(
    input: unknown,
    providerName: LlmModelProvider,
  ): void {
    const prompt = this.serializePromptInput(input);
    const imageCount = (prompt.match(/__LLM_IMAGE_PAYLOAD__/g) ?? []).length;
    const estimatedTokens =
      this.estimatePromptTokens(prompt.replaceAll('__LLM_IMAGE_PAYLOAD__', '')) +
      imageCount * 2_048;
    const maxInputTokens = this.getMaxInputTokens(providerName);
    if (estimatedTokens <= maxInputTokens) return;

    throw new LlmInputBudgetExceededError(estimatedTokens, maxInputTokens);
  }

  private reserveRequestBudget(
    input: unknown,
    providerName: LlmModelProvider,
    calls: number,
    inputCallMultiplier = 1,
  ): void {
    const budget = this.requestBudget.getStore();
    if (!budget) return;

    const prompt = this.serializePromptInput(input);
    const imageCount = (prompt.match(/__LLM_IMAGE_PAYLOAD__/g) ?? []).length;
    const estimatedInputTokens =
      this.estimatePromptTokens(prompt.replaceAll('__LLM_IMAGE_PAYLOAD__', '')) +
      imageCount * 2_048;
    const totalEstimatedInputTokens = estimatedInputTokens * inputCallMultiplier;
    const reservedTokens =
      totalEstimatedInputTokens + calls * this.getMaxOutputTokens(providerName);
    if (budget.calls + calls > budget.maxCalls) {
      throw new LlmRequestBudgetExceededError(
        `本次任务的模型调用次数达到上限 ${budget.maxCalls}，已停止继续调用。`,
      );
    }
    if (
      budget.estimatedInputTokens + totalEstimatedInputTokens >
      budget.maxInputTokens
    ) {
      throw new LlmRequestBudgetExceededError(
        `本次任务的模型输入预算将超过 ${budget.maxInputTokens} tokens，已停止继续调用。`,
      );
    }
    if (budget.reservedTokens + reservedTokens > budget.maxTotalTokens) {
      throw new LlmRequestBudgetExceededError(
        `本次任务的模型总预算将超过 ${budget.maxTotalTokens} tokens，已停止继续调用。`,
      );
    }

    budget.calls += calls;
    budget.estimatedInputTokens += totalEstimatedInputTokens;
    // 结果用模型配置的最大输出 token 预留，避免模型未返回 usage 时漏算成本。
    budget.reservedTokens += reservedTokens;
  }

  private getMaxOutputTokens(providerName: LlmModelProvider): number {
    const fallback = this.gatewayPolicy.resolve('structured', providerName)
      .fallback;
    return [providerName, fallback]
      .filter((provider): provider is LlmModelProvider => Boolean(provider))
      .reduce((maximum, provider) => {
        const configured = Number(
          this.config.get<number>(`llm.${provider}.maxTokens`),
        );
        const output =
          Number.isFinite(configured) && configured > 0 ? configured : 4_096;
        return Math.max(maximum, output);
      }, 0);
  }

  private positiveBudgetConfig(key: string, fallback: number): number {
    const configured = Number(this.config.get<number>(key));
    return Number.isFinite(configured) && configured > 0
      ? Math.floor(configured)
      : fallback;
  }

  private getMaxInputTokens(providerName: LlmModelProvider): number {
    const configuredWindow = Number(
      this.config.get<number>('llm.contextWindowTokens'),
    );
    const contextWindow =
      Number.isFinite(configuredWindow) && configuredWindow > 0
        ? configuredWindow
        : 32_768;
    const route = this.gatewayPolicy.resolve('structured', providerName);
    const providers = [providerName, route.fallback].filter(
      (provider): provider is LlmModelProvider => Boolean(provider),
    );
    const outputBudget = Math.max(
      ...providers.map((provider) => {
        const configuredOutput = Number(
          this.config.get<number>(`llm.${provider}.maxTokens`),
        );
        return Number.isFinite(configuredOutput) && configuredOutput > 0
          ? configuredOutput
          : 4_096;
      }),
    );
    const safetyMargin = Math.max(256, Math.ceil(contextWindow * 0.1));
    return Math.max(0, contextWindow - outputBudget - safetyMargin);
  }

  private serializePromptInput(input: unknown): string {
    try {
      let serializableInput = input;
      if (input && typeof input === 'object') {
        const promptValue = input as {
          toChatMessages?: () => unknown;
          toString?: () => string;
        };
        if (typeof promptValue.toChatMessages === 'function') {
          serializableInput = promptValue.toChatMessages();
        } else if (
          typeof promptValue.toString === 'function' &&
          promptValue.toString !== Object.prototype.toString
        ) {
          serializableInput = promptValue.toString();
        }
      }
      return JSON.stringify(serializableInput, (key, value: unknown) => {
        if (
          key === 'signal' ||
          key === 'callbacks'
        ) {
          return undefined;
        }
        if (
          typeof value === 'string' &&
          /^data:image\/[^;]+;base64,/i.test(value)
        ) {
          return '__LLM_IMAGE_PAYLOAD__';
        }
        if (
          key === 'image_url' &&
          value &&
          typeof value === 'object'
        ) {
          return '__LLM_IMAGE_PAYLOAD__';
        }
        return value;
      }) ?? String(serializableInput ?? '');
    } catch {
      return String(input ?? '');
    }
  }

  private estimatePromptTokens(text: string): number {
    const cjk = (
      text.match(
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu,
      ) ?? []
    ).length;
    return Math.ceil(cjk + Math.max(text.length - cjk, 0) / 4);
  }

  private isStreamingInput(input: unknown): boolean {
    return Boolean(
      input &&
        typeof input === 'object' &&
        Symbol.asyncIterator in input,
    );
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
        if (error instanceof LlmInputBudgetExceededError) {
          if (providerName === candidates[candidates.length - 1]) throw error;
          if (primaryError === undefined) primaryError = error;
          continue;
        }
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
    this.assertInputWithinBudget(messages, providerName);
    this.reserveRequestBudget(messages, providerName, 1);
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
