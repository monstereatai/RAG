import { QwenEmbeddingProvider } from './qwen-embedding.provider';

describe('QwenEmbeddingProvider OpenAI SDK integration', () => {
  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, string | number> = {
        'embedding.qwen.apiKey': 'test-key',
        'embedding.qwen.baseUrl': 'https://embedding.test/v1',
        'embedding.qwen.model': 'text-embedding-v3',
        'embedding.qwen.dimension': 2,
      };
      return values[key];
    }),
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createProvider(signal: AbortSignal) {
    const metricsService = {
      observeEmbeddingCall: jest.fn(),
      observeEmbeddingUsage: jest.fn(),
    };
    const llmProvider = {
      runWithExternalModelBudget: jest.fn(
        async (
          _input: unknown,
          _maxOutputTokens: number,
          callback: (signal: AbortSignal) => Promise<unknown>,
        ) => callback(signal),
      ),
    };
    const provider = new QwenEmbeddingProvider(
      config as never,
      llmProvider as never,
      metricsService as never,
    );
    return { provider, metricsService, llmProvider };
  }

  it('uses the installed LangChain/OpenAI SDK fetch and records returned usage', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          object: 'list',
          model: 'text-embedding-v3',
          data: [{ object: 'embedding', index: 0, embedding: [1, 2] }],
          usage: { total_tokens: 23 },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    );
    const requestSignal = new AbortController().signal;
    const { provider, metricsService, llmProvider } =
      createProvider(requestSignal);

    await expect(provider.embedQuery('hello world')).resolves.toEqual([1, 2]);

    expect(llmProvider.runWithExternalModelBudget).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(
      fetchSpy.mock.calls[0]?.[1]?.body as string,
    ) as Record<string, unknown>;
    expect(requestBody.encoding_format).toBe('float');
    expect(metricsService.observeEmbeddingUsage).toHaveBeenCalledWith(
      'qwen',
      'text-embedding-v3',
      23,
    );
    expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('aborts the actual SDK fetch when the request budget signal is canceled', async () => {
    const budgetController = new AbortController();
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
    const { provider } = createProvider(budgetController.signal);

    const pending = provider.embedQuery('cancel through the SDK');
    const rejection = expect(pending).rejects.toBeDefined();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sdkSignal = fetchSpy.mock.calls[0]?.[1]?.signal;
    expect(sdkSignal).toBeInstanceOf(AbortSignal);
    budgetController.abort(new Error('request cancelled'));

    await rejection;
    expect(sdkSignal?.aborted).toBe(true);
  });
});
