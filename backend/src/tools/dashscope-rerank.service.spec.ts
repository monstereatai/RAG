import { ConfigService } from '@nestjs/config';
import { DashScopeRerankService } from './dashscope-rerank.service';
import type { RetrievedChunk } from '../rag/karpathy/karpathy-rag.service';

describe('DashScopeRerankService', () => {
  const originalFetch = global.fetch;
  const chunks: RetrievedChunk[] = [
    {
      id: 'a',
      content: 'first',
      docId: 'doc',
      chunkIndex: 0,
      bm25Score: 0.1,
      cosineScore: 0.1,
      totalScore: 0.1,
    },
    {
      id: 'b',
      content: 'second',
      docId: 'doc',
      chunkIndex: 1,
      bm25Score: 0.2,
      cosineScore: 0.2,
      totalScore: 0.2,
    },
  ];

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns original chunks when api key is missing', async () => {
    const service = new DashScopeRerankService({
      get: jest.fn().mockReturnValue(''),
    } as unknown as ConfigService);
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    await expect(service.rerank('query', chunks)).resolves.toBe(chunks);

    expect(service.isEnabled()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps compatible rerank results back to chunks', async () => {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'rerank.apiKey') return 'test-key';
        if (key === 'rerank.model') return 'qwen3-rerank';
        if (key === 'rerank.baseUrl') return 'https://rerank.example';
        return undefined;
      }),
    } as unknown as ConfigService;
    const service = new DashScopeRerankService(config);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            { index: 1, relevance_score: 0.98 },
            { index: 0, relevance_score: 0.42 },
          ],
        }),
    });

    const result = await service.rerank('query', chunks);

    expect(result.map((chunk) => chunk.id)).toEqual(['b', 'a']);
    expect(result.map((chunk) => chunk.totalScore)).toEqual([0.98, 0.42]);
  });

  it('combines caller cancellation with the outbound timeout', async () => {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'rerank.apiKey') return 'test-key';
        if (key === 'rerank.model') return 'qwen3-rerank';
        return undefined;
      }),
    } as unknown as ConfigService;
    const service = new DashScopeRerankService(config);
    const controller = new AbortController();
    controller.abort();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });
    global.fetch = fetchMock;

    await service.rerank('query', chunks, chunks.length, controller.signal);

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toEqual(
      expect.objectContaining({ aborted: true }),
    );
  });
});
