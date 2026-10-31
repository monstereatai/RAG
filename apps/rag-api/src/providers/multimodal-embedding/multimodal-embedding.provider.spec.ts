import {
  MultimodalEmbeddingProvider,
  MULTIMODAL_EMBEDDING_FETCH_TOKEN,
} from './multimodal-embedding.provider';
import type { MultimodalEmbeddingFetch } from './multimodal-embedding-provider.interface';

describe('MultimodalEmbeddingProvider budget integration', () => {
  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        MULTIMODAL_EMBEDDING_API_KEY: 'embedding-test-key',
      };
      return values[key];
    }),
  };
  const llmProvider = {
    runWithExternalModelBudget: jest.fn(
      async (
        _input: unknown,
        _maxOutputTokens: number,
        callback: (signal: AbortSignal) => Promise<unknown>,
      ) => callback(new AbortController().signal),
    ),
  };
  const metricsService = { observeEmbeddingCall: jest.fn() };
  let requestSignal: AbortSignal | null | undefined;
  const fetchImpl: MultimodalEmbeddingFetch = (_url, init) => {
    requestSignal = init?.signal;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          output: {
            embeddings: [
              { embedding: Array.from({ length: 1024 }, () => 0.1) },
            ],
          },
        }),
        { status: 200 },
      ),
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reserves text input and counts no generated output tokens', async () => {
    const provider = new MultimodalEmbeddingProvider(
      config as never,
      llmProvider as never,
      metricsService as never,
      fetchImpl,
    );

    await expect(
      provider.embedText('searchable image description'),
    ).resolves.toHaveLength(1024);

    expect(llmProvider.runWithExternalModelBudget).toHaveBeenCalledWith(
      ['searchable image description'],
      0,
      expect.any(Function),
    );
    expect(requestSignal).toBeInstanceOf(AbortSignal);
    expect(metricsService.observeEmbeddingCall).toHaveBeenCalledWith(
      'dashscope-multimodal',
      'multimodal-embedding-v1',
      'success',
      expect.any(Number),
      1,
    );
    expect(MULTIMODAL_EMBEDDING_FETCH_TOKEN).toBe('MULTIMODAL_EMBEDDING_FETCH');
  });
});
