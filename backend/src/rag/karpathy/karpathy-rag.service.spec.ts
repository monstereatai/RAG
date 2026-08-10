import { ConfigService } from '@nestjs/config';
import { KarpathyRagService } from './karpathy-rag.service';
import type { EmbeddingProvider } from '../../providers/embedding/embedding.provider';
import type { VectorStoreProvider } from '../../providers/vector-store/vector-store.provider';
import type { LlmProvider } from '../../providers/llm/llm.provider';
import type { ElasticsearchProvider } from '../../providers/elasticsearch/elasticsearch.provider';
import type { MetricsService } from '../../modules/metrics/metrics.service';
import type { ObsidianKnowledgeService } from '../../modules/obsidian/obsidian-knowledge.service';
import type { BadCaseFlywheelService } from '../prompts/bad-case-flywheel.service';

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
      getModel: jest.fn().mockReturnValue({
        stream: async function* (messages: unknown) {
          yield { content: await llmInvoke(messages) };
        },
      }),
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
      observeRetrievalContext: jest.fn(),
    } as unknown as MetricsService;
    const obsidianKnowledge = {
      search: jest.fn().mockResolvedValue([]),
      assessHits: jest.fn().mockReturnValue({
        sufficient: false,
        reason: 'Obsidian 未命中',
      }),
      formatHitsForPrompt: jest.fn().mockReturnValue(''),
    } as unknown as ObsidianKnowledgeService;
    const badCaseFlywheel = {
      retrieveMatches: jest.fn().mockResolvedValue([]),
      formatPrompt: jest.fn().mockReturnValue(''),
    } as unknown as BadCaseFlywheelService;

    const service = new KarpathyRagService(
      embeddingProvider,
      vectorStoreProvider,
      llmProvider,
      configService,
      elasticsearchProvider,
      metricsService,
      obsidianKnowledge,
      badCaseFlywheel,
    );
    (service as unknown as { bm25Store: { save: jest.Mock } }).bm25Store = {
      save: jest.fn(),
    };

    return {
      service,
      llmInvoke,
      vectorStoreProvider,
      metricsService,
      observeRetrievalHits,
    };
  }

  it('returns a friendly answer when the knowledge base is empty', async () => {
    const { service, llmInvoke } = createService();
    llmInvoke.mockResolvedValueOnce('今天是星期三。');

    await expect(service.answer('anything')).resolves.toMatchObject({
      answer: '今天是星期三。',
      references: [],
      retrievalSufficient: false,
      retrievalReason:
        '没有检索到候选片段；Obsidian 未命中；已使用模型兜底回答',
    });
    expect(llmInvoke).toHaveBeenCalledTimes(1);
  });

  it('returns a friendly answer when no related document is found', async () => {
    const { service, llmInvoke } = createService();
    llmInvoke.mockResolvedValueOnce('量子物理研究微观粒子的行为。');
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
    ).resolves.toMatchObject({
      answer: '量子物理研究微观粒子的行为。',
      references: [],
      retrievalSufficient: false,
      retrievalReason:
        '没有检索到候选片段；Obsidian 未命中；已使用模型兜底回答',
    });
    expect(llmInvoke).toHaveBeenCalledTimes(1);
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
    ).resolves.toMatchObject({
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
    expect(result.answer).toContain('应按 2026 版优先生效');
    expect(result.answer).toContain('[片段1]');
  });

  it('uses model fallback for vector-only hits with no query token overlap', async () => {
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
    llmInvoke.mockResolvedValueOnce('量子物理关注微观粒子和能量的行为。');
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
    ).resolves.toMatchObject({
      answer: '量子物理关注微观粒子和能量的行为。',
      references: [],
      retrievalSufficient: false,
      retrievalReason:
        '检索片段与问题关键词重合数 0 低于阈值 1；Obsidian 未命中；已使用模型兜底回答',
    });
    expect(llmInvoke).toHaveBeenCalledTimes(1);
  });

  it('uses model fallback for weak Chinese overlap when only a generic word matches', async () => {
    const { service, llmInvoke } = createService();
    llmInvoke.mockResolvedValueOnce(
      '公司宠物医疗报销额度需要以公司福利制度为准。',
    );
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

    const result = await service.answer(
      '公司宠物医疗报销额度是多少？',
      [],
      'user-1',
    );

    expect(result).toMatchObject({
      answer: '公司宠物医疗报销额度需要以公司福利制度为准。',
      references: [],
      retrievalSufficient: false,
    });
    expect(result.retrievalReason).toContain('已使用模型兜底回答');
    expect(llmInvoke).toHaveBeenCalledTimes(1);
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

  it('uses RRF so chunks found by both keyword and vector rank first', async () => {
    const { service } = createService({
      vectorStoreProvider: {
        similaritySearch: jest.fn().mockResolvedValue([
          {
            id: 'vector-only',
            content: 'Unrelated active chunk',
            docId: 'doc-vector',
            chunkIndex: 0,
            score: 0.99,
          },
          {
            id: 'overlap',
            content: 'Alpha policy keyword',
            docId: 'doc-overlap',
            chunkIndex: 0,
            score: 0.8,
          },
        ]),
      },
    });
    service.indexChunks(
      [
        {
          id: 'overlap',
          content: 'Alpha policy keyword',
          docId: 'doc-overlap',
          chunkIndex: 0,
        },
        {
          id: 'vector-only',
          content: 'Unrelated active chunk',
          docId: 'doc-vector',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );

    const results = await service.retrieve('Alpha policy', {}, 'user-1');

    expect(results[0]).toMatchObject({
      id: 'overlap',
      docId: 'doc-overlap',
    });
    expect(results[0].bm25Score).toBeGreaterThan(0);
    expect(results[0].cosineScore).toBeGreaterThan(0);
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
    expect(result.answer).toContain('应按 2026 版优先生效');
    expect(llmInvoke).not.toHaveBeenCalled();
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
    expect(results).toHaveLength(1);
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

  it('filters by game project and expands neighboring procedure chunks', async () => {
    const { service } = createService();
    service.indexChunks(
      [
        {
          id: 'a-0',
          content: '活动配置准备：创建夏日抽奖活动。',
          docId: 'doc-a',
          chunkIndex: 0,
          sectionId: 'setup',
          projectId: 'game-a',
        },
        {
          id: 'a-1',
          content: '抽奖流程配置：填写奖池并提交审核。',
          docId: 'doc-a',
          chunkIndex: 1,
          sectionId: 'setup',
          projectId: 'game-a',
        },
        {
          id: 'b-0',
          content: '抽奖流程配置：这是另一个游戏项目。',
          docId: 'doc-b',
          chunkIndex: 0,
          projectId: 'game-b',
        },
      ],
      'user-1',
    );

    const result = await service.retrieveDetailed(
      '如何配置抽奖流程？',
      { vectorSearch: false, scope: { projectId: 'game-a' } },
      'user-1',
    );

    expect(result.chunks.every((chunk) => chunk.projectId === 'game-a')).toBe(
      true,
    );
    expect(
      result.chunks.some((chunk) => chunk.contextRole === 'neighbor'),
    ).toBe(true);
    expect(result.diagnostics.intent).toBe('procedure');
    expect(result.diagnostics.expandedChunks).toBeGreaterThan(0);
  });

  it('removes a superseded document from default retrieval', async () => {
    const { service } = createService();
    service.indexChunks(
      [
        {
          id: 'old-0',
          content: '夏日活动奖励规则为旧版金币方案。',
          docId: 'old-doc',
          chunkIndex: 0,
          lifecycleStatus: 'effective',
        },
      ],
      'user-1',
    );
    service.updateDocumentLifecycle('old-doc', 'deprecated', 'user-1');

    await expect(
      service.retrieve('夏日活动奖励规则', { vectorSearch: false }, 'user-1'),
    ).resolves.toHaveLength(0);
    await expect(
      service.retrieve(
        '夏日活动奖励规则',
        { vectorSearch: false, scope: { includeDeprecated: true } },
        'user-1',
      ),
    ).resolves.toHaveLength(1);
  });
});
