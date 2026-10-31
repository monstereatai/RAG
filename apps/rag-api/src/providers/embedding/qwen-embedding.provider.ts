import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import { LlmProvider } from '../llm/llm.provider';
import { MetricsService } from '../../modules/metrics/metrics.service';
import { IEmbeddingProvider } from './embedding-provider.interface';

function createEmbeddingAbortError(signal: AbortSignal): Error {
  const message =
    signal.reason instanceof Error
      ? signal.reason.message
      : 'Embedding request aborted';
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

/**
 * 通义千问 Embedding Provider
 * 通过 OpenAI 兼容接口调用 DashScope text-embedding-v3
 */
@Injectable()
export class QwenEmbeddingProvider implements IEmbeddingProvider {
  private readonly logger = new Logger(QwenEmbeddingProvider.name);
  private readonly embeddings: OpenAIEmbeddings;
  private readonly dimension: number;
  private readonly modelName: string;
  private readonly requestSignalStorage = new AsyncLocalStorage<AbortSignal>();

  constructor(
    private readonly config: ConfigService,
    private readonly llmProvider: LlmProvider,
    private readonly metricsService: MetricsService,
  ) {
    const apiKey = this.config.get<string>('embedding.qwen.apiKey');
    const baseUrl = this.config.get<string>('embedding.qwen.baseUrl');
    const modelName = this.config.get<string>('embedding.qwen.model');
    this.modelName = modelName ?? 'unknown';
    const dimension =
      this.config.get<number>('embedding.qwen.dimension') ?? 1024;
    this.dimension = dimension;

    if (!apiKey) {
      throw new Error('QWEN_API_KEY is required for embedding');
    }

    this.embeddings = new OpenAIEmbeddings({
      apiKey,
      model: modelName,
      // DashScope returns float arrays; the OpenAI SDK otherwise defaults to Base64.
      encodingFormat: 'float',
      configuration: {
        baseURL: baseUrl,
        fetch: (input, init) => this.fetchEmbeddingRequest(input, init),
      },
      dimensions: dimension,
    });
    this.propagateRequestSignalThroughEmbeddingQueue();
  }

  // 查询和文档必须使用同一模型与维度，保证向量可以在同一索引空间比较。
  async embedQuery(text: string): Promise<number[]> {
    try {
      return await this.llmProvider.runWithExternalModelBudget(
        text,
        0,
        (signal) => {
          return this.runWithEmbeddingRequestSignal(signal, 3000, 1, () =>
            this.embeddings.embedQuery(text),
          );
        },
      );
    } catch (err) {
      this.logger.warn(
        `[QwenEmbeddingProvider] embedQuery failed: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    // 入库向量按固定批次调用服务，返回顺序与输入 chunk 顺序一一对应。
    const batchSize = 10;
    const vectors: number[][] = [];
    try {
      for (let start = 0; start < texts.length; start += batchSize) {
        const batch = texts.slice(start, start + batchSize);
        const batchVectors = await this.llmProvider.runWithExternalModelBudget(
          batch,
          0,
          (signal) => {
            return this.runWithEmbeddingRequestSignal(
              signal,
              5000,
              batch.length,
              () => this.embeddings.embedDocuments(batch),
            );
          },
        );
        vectors.push(...batchVectors);
      }
      return vectors;
    } catch (err) {
      this.logger.warn(
        `[QwenEmbeddingProvider] embedDocuments failed after ${vectors.length} vectors: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  private runWithEmbeddingRequestSignal<T>(
    requestSignal: AbortSignal,
    timeoutMs: number,
    documentCount: number,
    callback: () => Promise<T>,
  ): Promise<T> {
    const timeoutController = new AbortController();
    const signal = AbortSignal.any([requestSignal, timeoutController.signal]);
    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        const error = new Error('Timeout calling embedding API');
        timeoutController.abort(error);
        reject(error);
      }, timeoutMs);
    });
    let abortListener: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      abortListener = () => {
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new Error('Embedding request aborted'),
        );
      };
      if (signal.aborted) abortListener();
      else signal.addEventListener('abort', abortListener, { once: true });
    });
    const requestPromise = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return this.requestSignalStorage.run(signal, callback);
    });

    return this.measureEmbeddingCall(documentCount, () =>
      Promise.race([requestPromise, timeoutPromise, abortPromise]).finally(
        () => {
          if (timeout) clearTimeout(timeout);
          if (abortListener) signal.removeEventListener('abort', abortListener);
        },
      ),
    );
  }

  private propagateRequestSignalThroughEmbeddingQueue(): void {
    const caller = this.embeddings.caller;
    // Unit tests may replace the LangChain client with a lightweight mock.
    if (!caller?.call) return;
    const originalCall = caller.call.bind(caller) as <
      A extends unknown[],
      T extends (...args: A) => Promise<unknown>,
    >(
      callable: T,
      ...args: Parameters<T>
    ) => Promise<Awaited<ReturnType<T>>>;
    const signalStorage = this.requestSignalStorage;
    caller.call = function <
      A extends unknown[],
      T extends (...args: A) => Promise<unknown>,
    >(callable: T, ...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> {
      const signal = signalStorage.getStore();
      if (!signal) return originalCall(callable, ...args);

      return originalCall(
        (...callArgs: Parameters<T>): ReturnType<T> =>
          signalStorage.run(signal, async () => {
            if (signal.aborted) throw createEmbeddingAbortError(signal);
            try {
              return await callable(...callArgs);
            } catch (error) {
              // LangChain retries generic errors; normalize an abort to stop that retry loop.
              if (signal.aborted) throw createEmbeddingAbortError(signal);
              throw error;
            }
          }) as ReturnType<T>,
        ...args,
      );
    };
  }

  private async fetchEmbeddingRequest(
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> {
    const requestSignal = this.requestSignalStorage.getStore();
    const requestObjectSignal =
      input instanceof Request ? input.signal : undefined;
    const sdkSignal = init?.signal ?? requestObjectSignal;
    const signal =
      requestSignal && sdkSignal
        ? AbortSignal.any([sdkSignal, requestSignal])
        : (requestSignal ?? sdkSignal);
    const response = await fetch(input, signal ? { ...init, signal } : init);
    // OpenAI SDK parses JSON through Response.json(); inspect usage without cloning vectors.
    const parseJson = response.json.bind(response);
    Object.defineProperty(response, 'json', {
      configurable: true,
      value: async () => {
        const payload: unknown = await parseJson();
        this.recordProviderEmbeddingUsage(payload);
        return payload;
      },
    });
    return response;
  }

  private recordProviderEmbeddingUsage(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const usage = (payload as Record<string, unknown>).usage;
    if (!usage || typeof usage !== 'object') return;
    const inputTokens = (usage as Record<string, unknown>).prompt_tokens;
    const totalTokens = (usage as Record<string, unknown>).total_tokens;
    const reportedTokens = inputTokens ?? totalTokens;
    if (typeof reportedTokens !== 'number') return;
    this.metricsService.observeEmbeddingUsage(
      'qwen',
      this.modelName,
      reportedTokens,
    );
  }

  private async measureEmbeddingCall<T>(
    documentCount: number,
    callback: () => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    let status: 'success' | 'error' = 'success';
    try {
      return await callback();
    } catch (error) {
      status = 'error';
      throw error;
    } finally {
      this.metricsService.observeEmbeddingCall(
        'qwen',
        this.modelName,
        status,
        (Date.now() - startedAt) / 1000,
        documentCount,
      );
    }
  }
}
