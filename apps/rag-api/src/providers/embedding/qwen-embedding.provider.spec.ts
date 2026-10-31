import { OpenAIEmbeddings } from '@langchain/openai';
import { QwenEmbeddingProvider } from './qwen-embedding.provider';

jest.mock('@langchain/openai', () => ({
  OpenAIEmbeddings: jest.fn().mockImplementation(() => ({
    embedQuery: jest.fn().mockResolvedValue([1, 2]),
    embedDocuments: jest
      .fn()
      .mockImplementation((texts: string[]) =>
        Promise.resolve(texts.map(() => [1, 2])),
      ),
  })),
}));

describe('QwenEmbeddingProvider request budget', () => {
  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, string | number> = {
        'embedding.qwen.apiKey': 'test-key',
        'embedding.qwen.baseUrl': 'https://example.test/v1',
        'embedding.qwen.model': 'text-embedding-v3',
        'embedding.qwen.dimension': 2,
      };
      return values[key];
    }),
  };
  const runWithExternalModelBudget = jest.fn(
    async (
      _input: unknown,
      _maxOutputTokens: number,
      callback: (signal: AbortSignal) => Promise<unknown>,
    ) => callback(new AbortController().signal),
  );
  const metricsService = {
    observeEmbeddingCall: jest.fn(),
    observeEmbeddingUsage: jest.fn(),
  };

  const getLatestEmbeddingMock = () => {
    const mockedProvider = (
      OpenAIEmbeddings as unknown as {
        mock: {
          calls: Array<[{ configuration: { fetch: typeof fetch } }]>;
          results: Array<{ value: { embedQuery: jest.Mock } }>;
        };
      }
    ).mock;
    const options = mockedProvider.calls.at(-1)?.[0];
    const embeddings = mockedProvider.results.at(-1)?.value;
    if (!options || !embeddings) {
      throw new Error('OpenAIEmbeddings mock was not constructed');
    }
    return { options, embeddings };
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('reserves one request and no generated tokens for a query embedding', async () => {
    const provider = new QwenEmbeddingProvider(
      config as never,
      { runWithExternalModelBudget } as never,
      metricsService as never,
    );

    await expect(provider.embedQuery('find relevant chunks')).resolves.toEqual([
      1, 2,
    ]);

    expect(runWithExternalModelBudget).toHaveBeenCalledWith(
      'find relevant chunks',
      0,
      expect.any(Function),
    );
    expect(OpenAIEmbeddings).toHaveBeenCalledTimes(1);
    expect(metricsService.observeEmbeddingCall).toHaveBeenCalledWith(
      'qwen',
      'text-embedding-v3',
      'success',
      expect.any(Number),
      1,
    );
  });

  it('reserves each document batch separately and preserves vector order', async () => {
    const provider = new QwenEmbeddingProvider(
      config as never,
      { runWithExternalModelBudget } as never,
      metricsService as never,
    );
    const texts = Array.from({ length: 11 }, (_, index) => `chunk-${index}`);

    await expect(provider.embedDocuments(texts)).resolves.toEqual(
      texts.map(() => [1, 2]),
    );

    expect(runWithExternalModelBudget).toHaveBeenCalledTimes(2);
    expect(runWithExternalModelBudget).toHaveBeenNthCalledWith(
      1,
      texts.slice(0, 10),
      0,
      expect.any(Function),
    );
    expect(runWithExternalModelBudget).toHaveBeenNthCalledWith(
      2,
      texts.slice(10),
      0,
      expect.any(Function),
    );
    expect(metricsService.observeEmbeddingCall).toHaveBeenNthCalledWith(
      1,
      'qwen',
      'text-embedding-v3',
      'success',
      expect.any(Number),
      10,
    );
    expect(metricsService.observeEmbeddingCall).toHaveBeenNthCalledWith(
      2,
      'qwen',
      'text-embedding-v3',
      'success',
      expect.any(Number),
      1,
    );
  });

  it('passes request cancellation through the SDK fetch without losing its own signal', async () => {
    const provider = new QwenEmbeddingProvider(
      config as never,
      { runWithExternalModelBudget } as never,
      metricsService as never,
    );
    const budgetController = new AbortController();
    const sdkController = new AbortController();
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(
              signal.reason instanceof Error
                ? signal.reason
                : new Error('fetch aborted'),
            );
            return;
          }
          signal?.addEventListener(
            'abort',
            () =>
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error('fetch aborted'),
              ),
            { once: true },
          );
        }),
    );
    runWithExternalModelBudget.mockImplementationOnce(
      async (_input, _maxOutputTokens, callback) =>
        callback(budgetController.signal),
    );

    const { embeddings, options } = getLatestEmbeddingMock();
    embeddings.embedQuery.mockImplementationOnce(async () => {
      await options.configuration.fetch(
        'https://embedding.test/v1/embeddings',
        {
          method: 'POST',
          signal: sdkController.signal,
        },
      );
      return [1, 2];
    });

    const pending = provider.embedQuery('cancel this embedding');
    await Promise.resolve();

    const effectiveSignal = fetchSpy.mock.calls[0]?.[1]?.signal;
    expect(effectiveSignal).toBeInstanceOf(AbortSignal);
    expect(effectiveSignal).not.toBe(sdkController.signal);
    budgetController.abort(new Error('request cancelled'));

    await expect(pending).rejects.toThrow('request cancelled');
    expect(effectiveSignal?.aborted).toBe(true);
  });

  it('aborts the SDK fetch when the provider embedding timeout expires', async () => {
    const provider = new QwenEmbeddingProvider(
      config as never,
      { runWithExternalModelBudget } as never,
      metricsService as never,
    );
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener(
            'abort',
            () =>
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error('fetch aborted'),
              ),
            { once: true },
          );
        }),
    );
    const { embeddings, options } = getLatestEmbeddingMock();
    embeddings.embedQuery.mockImplementationOnce(async () => {
      await options.configuration.fetch(
        'https://embedding.test/v1/embeddings',
        {
          method: 'POST',
          signal: new AbortController().signal,
        },
      );
      return [1, 2];
    });

    const pending = provider.embedQuery('slow embedding');
    await Promise.resolve();
    const effectiveSignal = fetchSpy.mock.calls[0]?.[1]?.signal;
    expect(effectiveSignal).toBeDefined();

    const timeoutAssertion = expect(pending).rejects.toThrow(
      'Timeout calling embedding API',
    );
    await jest.advanceTimersByTimeAsync(3000);

    await timeoutAssertion;
    expect(effectiveSignal?.aborted).toBe(true);
  });

  it('records provider-reported embedding token usage when the response includes it', async () => {
    const provider = new QwenEmbeddingProvider(
      config as never,
      { runWithExternalModelBudget } as never,
      metricsService as never,
    );
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [],
          usage: { total_tokens: 23 },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    );
    const { options } = getLatestEmbeddingMock();

    expect(provider).toBeInstanceOf(QwenEmbeddingProvider);
    const response = await options.configuration.fetch(
      'https://embedding.test/v1/embeddings',
    );
    await expect(response.json()).resolves.toMatchObject({
      usage: { total_tokens: 23 },
    });

    expect(metricsService.observeEmbeddingUsage).toHaveBeenCalledWith(
      'qwen',
      'text-embedding-v3',
      23,
    );
  });
});
