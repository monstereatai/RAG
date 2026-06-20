import { ConfigService } from '@nestjs/config';
import { KarpathyRagService } from './karpathy-rag.service';
import type { EmbeddingProvider } from '../../providers/embedding/embedding.provider';
import type { VectorStoreProvider } from '../../providers/vector-store/vector-store.provider';
import type { LlmProvider } from '../../providers/llm/llm.provider';
import type { ElasticsearchProvider } from '../../providers/elasticsearch/elasticsearch.provider';

describe('KarpathyRagService exception scenarios', () => {
  function createService(overrides?: {
    embeddingProvider?: Partial<EmbeddingProvider>;
    vectorStoreProvider?: Partial<VectorStoreProvider>;
  }) {
    const embeddingProvider = {
      embedQuery: jest.fn().mockResolvedValue([1, 0, 0]),
      ...overrides?.embeddingProvider,
    } as unknown as EmbeddingProvider;
    const vectorStoreProvider = {
      similaritySearch: jest.fn().mockResolvedValue([]),
      ...overrides?.vectorStoreProvider,
    } as unknown as VectorStoreProvider;
    const llmInvoke = jest.fn().mockResolvedValue('answer');
    const llmProvider = {
      invoke: llmInvoke,
    } as unknown as LlmProvider;
    const configService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const elasticsearchProvider = {
      isEnabled: jest.fn().mockReturnValue(false),
      search: jest.fn(),
    } as unknown as ElasticsearchProvider;

    return {
      service: new KarpathyRagService(
        embeddingProvider,
        vectorStoreProvider,
        llmProvider,
        configService,
        elasticsearchProvider,
      ),
      llmInvoke,
      vectorStoreProvider,
    };
  }

  it('returns a friendly answer when the knowledge base is empty', async () => {
    const { service, llmInvoke } = createService();

    await expect(service.answer('anything')).resolves.toEqual({
      answer: '未找到相关内容，请先上传文档。',
      references: [],
    });
    expect(llmInvoke).not.toHaveBeenCalled();
  });

  it('returns a friendly answer when no related document is found', async () => {
    const { service, llmInvoke } = createService();
    service.indexChunks(
      [
        {
          id: 'chunk-1',
          content: 'Redis stores cache entries in memory',
          docId: 'doc-1',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );

    await expect(
      service.answer('quantum physics', [], 'user-1'),
    ).resolves.toEqual({
      answer: '未找到相关内容，请先上传文档。',
      references: [],
    });
    expect(llmInvoke).not.toHaveBeenCalled();
  });

  it('falls back to BM25 when vector search is unavailable', async () => {
    const { service } = createService({
      embeddingProvider: {
        embedQuery: jest.fn().mockRejectedValue(new Error('embedding down')),
      },
    });
    service.indexChunks(
      [
        {
          id: 'chunk-1',
          content: 'LangChain builds RAG applications',
          docId: 'doc-1',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );

    const results = await service.retrieve('LangChain RAG', {}, 'user-1');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 'chunk-1',
      docId: 'doc-1',
      cosineScore: 0,
    });
    expect(results[0].bm25Score).toBeGreaterThan(0);
  });

  it('filters stale vector hits whose docId is no longer active', async () => {
    const { service } = createService({
      vectorStoreProvider: {
        similaritySearch: jest.fn().mockResolvedValue([
          {
            id: 'stale-chunk',
            content: 'Deleted document content from Milvus',
            docId: 'deleted-doc',
            chunkIndex: 0,
            score: 0.99,
          },
        ]),
      },
    });
    service.indexChunks(
      [
        {
          id: 'active-chunk',
          content: 'Active document content',
          docId: 'active-doc',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );

    const results = await service.retrieve('stale-vector-only', {}, 'user-1');

    expect(results).toHaveLength(0);
  });
});
