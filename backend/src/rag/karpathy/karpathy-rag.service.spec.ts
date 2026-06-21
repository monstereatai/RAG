import { ConfigService } from '@nestjs/config';
import { KarpathyRagService } from './karpathy-rag.service';
import type { EmbeddingProvider } from '../../providers/embedding/embedding.provider';
import type { VectorStoreProvider } from '../../providers/vector-store/vector-store.provider';
import type { LlmProvider } from '../../providers/llm/llm.provider';
import type { ElasticsearchProvider } from '../../providers/elasticsearch/elasticsearch.provider';
import type { MetricsService } from '../../modules/metrics/metrics.service';

describe('KarpathyRagService exception scenarios', () => {
  function createService(overrides?: {
    embeddingProvider?: Partial<EmbeddingProvider>;
    vectorStoreProvider?: Partial<VectorStoreProvider>;
    config?: Record<string, unknown>;
  }) {
    const embeddingProvider = {
      embedQuery: jest.fn().mockResolvedValue([1, 0, 0]),
      ...overrides?.embeddingProvider,
    } as unknown as EmbeddingProvider;
    const vectorStoreProvider = {
      similaritySearch: jest.fn().mockResolvedValue([]),
      ...overrides?.vectorStoreProvider,
    } as unknown as VectorStoreProvider;
    const llmInvoke = jest
      .fn<Promise<string>, [unknown]>()
      .mockResolvedValue('answer');
    const llmProvider = {
      invoke: llmInvoke,
    } as unknown as LlmProvider;
    const configService = {
      get: jest
        .fn()
        .mockImplementation((key: string) => overrides?.config?.[key]),
    } as unknown as ConfigService;
    const elasticsearchProvider = {
      isEnabled: jest.fn().mockReturnValue(false),
      search: jest.fn(),
    } as unknown as ElasticsearchProvider;
    const observeRetrievalHits = jest.fn();
    const metricsService = {
      observeRetrievalHits,
    } as unknown as MetricsService;

    return {
      service: new KarpathyRagService(
        embeddingProvider,
        vectorStoreProvider,
        llmProvider,
        configService,
        elasticsearchProvider,
        metricsService,
      ),
      llmInvoke,
      vectorStoreProvider,
      metricsService,
      observeRetrievalHits,
    };
  }

  it('returns a friendly answer when the knowledge base is empty', async () => {
    const { service, llmInvoke } = createService();

    await expect(service.answer('anything')).resolves.toEqual({
      answer: '未找到相关内容，请先上传文档。',
      references: [],
      retrievalSufficient: false,
      retrievalReason: '没有检索到候选片段',
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
      retrievalSufficient: false,
      retrievalReason: '没有检索到候选片段',
    });
    expect(llmInvoke).not.toHaveBeenCalled();
  });

  it('returns an answer only when retrieval and citation support pass', async () => {
    const { service, llmInvoke } = createService();
    llmInvoke.mockResolvedValueOnce('LangChain 用于构建 RAG 应用。[片段1]');
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

    const result = await service.answer('LangChain RAG', [], 'user-1');

    expect(result).toMatchObject({
      answer: 'LangChain 用于构建 RAG 应用。[片段1]',
      retrievalSufficient: true,
      retrievalReason: '检索片段和答案引用通过本地质量闸门',
    });
    expect(result.references).toHaveLength(1);
  });

  it('rejects an LLM answer without citations when no extractive answer can be built', async () => {
    const { service, llmInvoke } = createService();
    llmInvoke.mockResolvedValueOnce('LangChain 用于构建 RAG 应用。');
    service.indexChunks(
      [
        {
          id: 'chunk-1',
          content: 'RAG',
          docId: 'doc-1',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );

    await expect(
      service.answer('LangChain RAG', [], 'user-1'),
    ).resolves.toEqual({
      answer: '知识库片段不足以支撑可靠回答，暂不生成确定结论。',
      references: [],
      retrievalSufficient: false,
      retrievalReason: '答案缺少显式片段引用',
    });
  });

  it('falls back to extractive cited answer when the LLM answer has no citations', async () => {
    const { service, llmInvoke } = createService();
    llmInvoke.mockResolvedValueOnce('引用来源可以降低幻觉风险。');
    service.indexChunks(
      [
        {
          id: 'chunk-1',
          content:
            '检索增强生成需要引用来源，因为用户必须核验答案依据，引用来源可以降低幻觉风险。',
          docId: 'doc-1',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );

    const result = await service.answer(
      '检索增强生成为什么需要引用来源？',
      [],
      'user-1',
    );

    expect(result).toMatchObject({
      retrievalSufficient: true,
      retrievalReason: 'LLM 答案引用不足，已回退为片段抽取式回答',
    });
    expect(result.answer).toContain('引用来源可以降低幻觉风险');
    expect(result.answer).toContain('[片段1]');
  });

  it('falls back to extractive answer when a later claim is not cited', async () => {
    const { service, llmInvoke } = createService();
    llmInvoke.mockResolvedValueOnce(
      'LangChain 用于构建 RAG 应用。[片段1] 它还能自动处理所有权限审批。',
    );
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

    const result = await service.answer('LangChain RAG', [], 'user-1');

    expect(result).toMatchObject({
      retrievalSufficient: true,
      retrievalReason: 'LLM 答案引用不足，已回退为片段抽取式回答',
    });
    expect(result.answer).toContain('LangChain builds RAG applications');
    expect(result.answer).not.toContain('权限审批');
  });

  it('accepts multi-claim answers when every claim has support citations', async () => {
    const { service, llmInvoke } = createService();
    llmInvoke.mockResolvedValueOnce(
      'LangChain builds RAG applications。[片段1] RAG 是检索增强生成。[片段1]',
    );
    service.indexChunks(
      [
        {
          id: 'chunk-1',
          content: 'LangChain builds RAG applications。RAG 是检索增强生成。',
          docId: 'doc-1',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );

    const result = await service.answer('LangChain RAG 检索生成', [], 'user-1');

    expect(result.retrievalSufficient).toBe(true);
    expect(result.references).toHaveLength(1);
  });

  it('adds a cited version conflict notice when retrieved chunks contain multiple versions', async () => {
    const { service, llmInvoke } = createService();
    llmInvoke.mockResolvedValueOnce('2026 住宿报销上限是 650 元。[片段1]');
    service.indexChunks(
      [
        {
          id: 'chunk-1',
          content:
            '2025 版差旅制度规定住宿报销上限为 500 元。2026 版差旅制度规定住宿报销上限为 650 元，并且 2026 版优先生效。',
          docId: 'doc-1',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );

    const result = await service.answer(
      '2026 住宿报销上限是多少？',
      [],
      'user-1',
    );

    expect(result.retrievalSufficient).toBe(true);
    expect(result.answer).toContain('片段中同时提到 2025、2026 版本');
    expect(result.answer).toContain('[片段1]');
  });

  it('rejects vector-only hits with no query token overlap', async () => {
    const { service, llmInvoke } = createService({
      vectorStoreProvider: {
        similaritySearch: jest.fn().mockResolvedValue([
          {
            id: 'chunk-1',
            content: 'Redis stores cache entries in memory',
            docId: 'doc-1',
            chunkIndex: 0,
            score: 0.99,
          },
        ]),
      },
    });
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
      answer: '知识库片段不足以支撑可靠回答，暂不生成确定结论。',
      references: [],
      retrievalSufficient: false,
      retrievalReason: '检索片段与问题关键词重合数 0 低于阈值 1',
    });
    expect(llmInvoke).not.toHaveBeenCalled();
  });

  it('rejects weak Chinese overlap when only a generic word matches', async () => {
    const { service, llmInvoke } = createService();
    service.indexChunks(
      [
        {
          id: 'chunk-1',
          content: '差旅制度规定住宿报销上限为 650 元。',
          docId: 'doc-1',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );

    await expect(
      service.answer('公司宠物医疗报销额度是多少？', [], 'user-1'),
    ).resolves.toMatchObject({
      answer: '知识库片段不足以支撑可靠回答，暂不生成确定结论。',
      references: [],
      retrievalSufficient: false,
    });
    expect(llmInvoke).not.toHaveBeenCalled();
  });

  it('falls back to BM25 when vector search is unavailable', async () => {
    const { service, observeRetrievalHits } = createService({
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
    expect(observeRetrievalHits).toHaveBeenCalledWith('bm25', 'hybrid', 1);
  });

  it('normalizes known Chinese typo terms before retrieval', async () => {
    const { service } = createService({
      embeddingProvider: {
        embedQuery: jest.fn().mockRejectedValue(new Error('embedding down')),
      },
    });
    service.indexChunks(
      [
        {
          id: 'chunk-1',
          content:
            '知识库系统正式名称为 Atlas Knowledge Base，内部别名包括企业知识库和知识中台。',
          docId: 'doc-1',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );

    const results = await service.retrieve('企业知识哭 是什么？', {}, 'user-1');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 'chunk-1',
      docId: 'doc-1',
    });
  });

  it('uses the typo-corrected query when generating an answer', async () => {
    const { service, llmInvoke } = createService();
    llmInvoke.mockResolvedValueOnce(
      '企业知识库是知识库系统的内部别名之一，正式名称为 Atlas Knowledge Base。[片段1]',
    );
    service.indexChunks(
      [
        {
          id: 'chunk-1',
          content:
            '知识库系统正式名称为 Atlas Knowledge Base，内部别名包括企业知识库和知识中台。',
          docId: 'doc-1',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );

    const result = await service.answer('企业知识哭 是什么？', [], 'user-1');

    expect(result.retrievalSufficient).toBe(true);
    const firstPrompt = llmInvoke.mock.calls.at(0)?.at(0);
    expect(JSON.stringify(firstPrompt)).toContain('企业知识库 是什么');
  });

  it('expands versioned reimbursement queries with policy anchors', async () => {
    const { service, llmInvoke } = createService();
    llmInvoke.mockResolvedValueOnce(
      '2026 年一线城市住宿报销上限为 650 元；如果 2025 版写的是 500 元，应以 2026 版优先生效。[片段1]',
    );
    service.indexChunks(
      [
        {
          id: 'chunk-1',
          content:
            '2026 版差旅制度规定：一线城市住宿报销上限为 650 元。若历史制度与 2026 版冲突，以 2026 版优先生效。2025 版差旅制度规定一线城市住宿报销上限为 500 元。',
          docId: 'doc-1',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );

    const result = await service.answer(
      '2026 年一线城市住宿报销上限是多少？如果 2025 版写的是 500 元怎么办？',
      [],
      'user-1',
    );

    expect(result.retrievalSufficient).toBe(true);
    const firstPrompt = llmInvoke.mock.calls.at(0)?.at(0);
    expect(JSON.stringify(firstPrompt)).toContain(
      '差旅制度 住宿标准 优先生效 历史版本',
    );
  });

  it('applies configured source authority weights to retrieval ranking', async () => {
    const { service } = createService({
      config: {
        'ragQuality.sourceAuthorityRules': 'official:1.5,draft:0.5',
      },
    });
    service.indexChunks(
      [
        {
          id: 'draft-chunk',
          content: 'LangChain builds RAG applications',
          docId: 'draft-policy',
          chunkIndex: 0,
        },
        {
          id: 'official-chunk',
          content: 'LangChain builds RAG applications',
          docId: 'official-policy',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );

    const results = await service.retrieve(
      'LangChain RAG applications',
      { vectorSearch: false },
      'user-1',
    );

    expect(results[0]).toMatchObject({
      id: 'official-chunk',
      docId: 'official-policy',
      sourceAuthorityWeight: 1.5,
    });
    expect(results[1]).toMatchObject({
      id: 'draft-chunk',
      docId: 'draft-policy',
      sourceAuthorityWeight: 0.5,
    });
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

  it('keeps structured governance metadata in references', async () => {
    const { service, llmInvoke } = createService();
    llmInvoke.mockResolvedValueOnce('2026 版住宿报销上限为 650 元。[片段1]');
    service.indexChunks(
      [
        {
          id: 'chunk-1',
          content: '2026 版住宿报销上限为 650 元。',
          docId: 'doc-1',
          chunkIndex: 0,
          parentChunkId: 'section-0',
          headingPath: ['员工手册', '差旅制度'],
          sectionId: 'section-0',
          clauseId: '第一条',
          sourceStart: 12,
          sourceEnd: 40,
          docVersion: '2026版',
          effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
          sourceAuthority: 'official',
        },
      ],
      'user-1',
    );

    const result = await service.answer('2026 住宿报销上限', [], 'user-1');

    expect(result.references[0]).toMatchObject({
      parentChunkId: 'section-0',
      headingPath: ['员工手册', '差旅制度'],
      sectionId: 'section-0',
      clauseId: '第一条',
      sourceStart: 12,
      sourceEnd: 40,
      docVersion: '2026版',
      effectiveAt: '2026-01-01T00:00:00.000Z',
      sourceAuthority: 'official',
    });
  });
});
