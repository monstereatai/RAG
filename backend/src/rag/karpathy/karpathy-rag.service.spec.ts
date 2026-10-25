import { ConfigService } from '@nestjs/config';
import { KarpathyRagService } from './karpathy-rag.service';
import type { EmbeddingProvider } from '../../providers/embedding/embedding.provider';
import type { VectorStoreProvider } from '../../providers/vector-store/vector-store.provider';
import type { LlmProvider } from '../../providers/llm/llm.provider';
import type { ElasticsearchProvider } from '../../providers/elasticsearch/elasticsearch.provider';
import type { MetricsService } from '../../modules/metrics/metrics.service';
import type { ObsidianKnowledgeService } from '../../modules/obsidian/obsidian-knowledge.service';
import type { BadCaseFlywheelService } from '../prompts/bad-case-flywheel.service';
import type { DocumentPermissionService } from '../../modules/document/document-permission.service';
import { retrievalProfileForTaskType } from './context-builder';
import type { RetrievalExecutionPlan } from '../planning/retrieval-policy.service';

describe('KarpathyRagService exception scenarios', () => {
  function createService(overrides?: {
    embeddingProvider?: Partial<EmbeddingProvider>;
    vectorStoreProvider?: Partial<VectorStoreProvider>;
    retrievalDescriptionService?: {
      searchByVector: jest.Mock;
    };
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
      observeRetrievalStage: jest.fn(),
      observeRetrievalRecalled: jest.fn(),
    } as unknown as MetricsService;
    const obsidianKnowledge = {
      search: jest.fn().mockResolvedValue([]),
      assessHits: jest.fn().mockReturnValue({
        sufficient: false,
        reason: 'Obsidian 未命中',
      }),
      formatHitsForPrompt: jest.fn().mockReturnValue(''),
    } as unknown as ObsidianKnowledgeService;
    const retrieveBadCaseMatches = jest.fn().mockResolvedValue([]);
    const retrieveExactBadCaseMatches = jest.fn().mockResolvedValue([]);
    const badCaseFlywheel = {
      retrieveMatches: retrieveBadCaseMatches,
      retrieveExactMatches: retrieveExactBadCaseMatches,
      formatPrompt: jest.fn().mockReturnValue(''),
    } as unknown as BadCaseFlywheelService;
    const bochaSearchService = {
      isEnabled: jest.fn().mockReturnValue(false),
      search: jest.fn().mockResolvedValue([]),
    };
    const toolPolicy = {
      decide: jest.fn().mockReturnValue({ allowed: true }),
    };
    const documentPermissionService = {
      // null 表示权限服务未启用；空 Set 在真实运行中代表“没有任何授权文档”。
      getAllowedDocIds: jest.fn().mockResolvedValue(null),
    };
    const dashscopeRerankService = {
      isEnabled: jest.fn().mockReturnValue(false),
      rerank: jest.fn(async (_query: string, chunks: unknown[]) => chunks),
    };
    const retrievalDescriptionService =
      overrides?.retrievalDescriptionService ?? {
        searchByVector: jest.fn().mockResolvedValue([]),
      };

    const service = new KarpathyRagService(
      embeddingProvider,
      vectorStoreProvider,
      llmProvider,
      configService,
      elasticsearchProvider,
      metricsService,
      obsidianKnowledge,
      badCaseFlywheel,
      bochaSearchService as unknown as import('../../tools/bocha-search.service').BochaSearchService,
      toolPolicy,
      documentPermissionService as unknown as DocumentPermissionService,
      dashscopeRerankService as unknown as import('../../tools/dashscope-rerank.service').DashScopeRerankService,
      undefined,
      undefined,
      undefined,
      retrievalDescriptionService as unknown as import('../../modules/document/document-retrieval-description.service').DocumentRetrievalDescriptionService,
    );
    (service as unknown as { bm25Store: { save: jest.Mock } }).bm25Store = {
      save: jest.fn(),
    };

    return {
      service,
      embeddingProvider,
      llmInvoke,
      vectorStoreProvider,
      metricsService,
      observeRetrievalHits,
      obsidianKnowledge,
      documentPermissionService,
      retrieveBadCaseMatches,
      retrieveExactBadCaseMatches,
      bochaSearchService,
      dashscopeRerankService,
      retrievalDescriptionService,
    };
  }

  it('puts reranked evidence before RRF fallback evidence', () => {
    const { service } = createService();
    const chunks = [
      {
        id: 'rrf-high',
        content: 'RRF candidate',
        docId: 'doc-1',
        chunkIndex: 0,
        bm25Score: 1,
        cosineScore: 1,
        totalScore: 0.9,
      },
      {
        id: 'rerank-lower-rrf',
        content: 'Rerank candidate',
        docId: 'doc-2',
        chunkIndex: 0,
        bm25Score: 0.1,
        cosineScore: 0.1,
        totalScore: 0.1,
        rerankScore: 0.8,
      },
    ];

    expect(service.rankEvidenceChunks(chunks).map((chunk) => chunk.id)).toEqual(
      ['rerank-lower-rrf', 'rrf-high'],
    );
  });

  it('does not cite persisted BM25 content that is absent from this response evidence', () => {
    const { service } = createService();
    (service as unknown as { persistedEntries: unknown[] }).persistedEntries = [
      {
        id: 'persisted-procurement',
        userId: 'user-1',
        docId: 'procurement',
        chunkIndex: 1136,
        content:
          'PO 金额超过 100000 元时，付款前必须完成预算审批、法务合同归档和供应商准入检查，并取得增值税专用发票。',
      },
    ];
    const visibleEvidence = [
      {
        id: 'visible-unrelated',
        docId: 'other',
        chunkIndex: 0,
        content: '这是与采购付款无关的可见证据。',
        bm25Score: 0.8,
        cosineScore: 0.8,
        totalScore: 0.8,
      },
    ];

    expect(
      service.buildEvidenceFirstAnswer(
        'PO 超过 10 万付款前必须完成哪些动作？',
        visibleEvidence,
      ),
    ).toBeNull();
  });

  it('merges reviewed Base Case evidence into the Simple answer gate', async () => {
    const { service, llmInvoke, retrieveBadCaseMatches } = createService();
    llmInvoke.mockResolvedValue(
      '你可能想问的是韦水春。韦水春是临床病理工作人员。',
    );
    retrieveBadCaseMatches.mockResolvedValue([
      {
        id: 'feedback-1',
        query: '韦水春是谁',
        text: '正确处理标准：韦水春是临床病理工作人员。',
        score: 0.96,
        mode: 'correction',
      },
    ]);

    const result = await service.answer('韦水春是谁');

    expect(result).toMatchObject({
      retrievalSufficient: true,
      references: [
        expect.objectContaining({
          id: 'reviewed-bad-case:feedback-1',
          sourceAuthority: 'reviewed_bad_case',
        }),
      ],
    });
    expect(result.answer).toContain('韦水春');
    expect(result.retrievalReason).toContain('Base Case 纠正证据');
  });

  it('includes Base Case in the Auto Fast Path gate and reusable snapshot', async () => {
    const { service, retrieveBadCaseMatches } = createService();
    retrieveBadCaseMatches.mockResolvedValue([
      {
        id: 'feedback-1',
        query: '韦水春是谁',
        text: '正确处理标准：韦水春是临床病理工作人员。',
        score: 0.96,
        mode: 'correction',
      },
    ]);

    const result = await service.assessFastPath('韦水春是谁');

    expect(result.sufficient).toBe(true);
    expect(result.chunks[0]).toMatchObject({
      id: 'reviewed-bad-case:feedback-1',
      sourceAuthority: 'reviewed_bad_case',
    });
    expect(result.prefetchedFastPath.badCaseMatches).toHaveLength(1);
    expect(result.prefetchedFastPath.evidenceBundle).toMatchObject({
      query: '韦水春是谁',
      sourcePolicy: 'web_allowed',
      assessment: { sufficient: true, evaluatedQuery: '韦水春是谁' },
    });
    expect(result.reason).toContain('Base Case:');
  });

  it('skips exact Bad Case direct answers for explicitly scoped Simple requests', async () => {
    const {
      service,
      retrieveExactBadCaseMatches,
      retrieveBadCaseMatches,
      obsidianKnowledge,
    } = createService();
    const obsidianSearch = jest.spyOn(obsidianKnowledge, 'search');
    retrieveExactBadCaseMatches.mockResolvedValue([
      {
        id: 'feedback-1',
        query: '项目 A 的发布规则是什么？',
        text: '正确处理标准：项目 A 的私有发布规则。',
        score: 1,
        mode: 'exact',
      },
    ]);

    await service.answer(
      '项目 A 的发布规则是什么？',
      [],
      'user-1',
      [],
      undefined,
      {
        karpathyDirectAnswer: true,
        scope: { projectId: 'project-a' },
      },
    );

    expect(retrieveExactBadCaseMatches).not.toHaveBeenCalled();
    expect(retrieveBadCaseMatches).not.toHaveBeenCalled();
    expect(obsidianSearch).not.toHaveBeenCalled();
  });

  it('uses tenant-scoped exact Base Case and skips Obsidian when tenant filtering is explicit', async () => {
    const {
      service,
      retrieveExactBadCaseMatches,
      retrieveBadCaseMatches,
      obsidianKnowledge,
    } = createService();
    const obsidianSearch = jest.spyOn(obsidianKnowledge, 'search');
    retrieveExactBadCaseMatches.mockResolvedValue([
      {
        id: 'feedback-1',
        query: '项目规则是什么？',
        text: '正确处理标准：其他租户的规则。',
        score: 1,
        mode: 'exact',
      },
    ]);

    await service.answer('项目规则是什么？', [], 'user-1', [], undefined, {
      karpathyDirectAnswer: true,
      tenantId: 'tenant-a',
    });

    expect(retrieveExactBadCaseMatches).toHaveBeenCalledWith(
      '项目规则是什么?',
      1,
      'user-1',
      'tenant-a',
    );
    expect(retrieveBadCaseMatches).not.toHaveBeenCalled();
    expect(obsidianSearch).not.toHaveBeenCalled();
  });

  it('resolves source-note hits to permitted, active, in-scope original chunks', async () => {
    const { service, documentPermissionService } = createService();
    documentPermissionService.getAllowedDocIds.mockResolvedValue(
      new Set(['source-doc']),
    );
    service.indexChunks(
      [
        {
          id: 'raw-allowed',
          content: '发布审批需要业务负责人复核。',
          docId: 'source-doc',
          chunkIndex: 0,
          projectId: 'game-a',
          lifecycleStatus: 'effective',
          effectiveAt: new Date('2020-01-01T00:00:00.000Z'),
          expiredAt: new Date('2099-01-01T00:00:00.000Z'),
        },
        {
          id: 'raw-wrong-scope',
          content: '发布审批需要业务负责人复核。',
          docId: 'source-doc',
          chunkIndex: 1,
          projectId: 'game-b',
        },
        {
          id: 'raw-expired',
          content: '发布审批需要业务负责人复核。',
          docId: 'source-doc',
          chunkIndex: 2,
          projectId: 'game-a',
          expiredAt: new Date('2020-01-01T00:00:00.000Z'),
        },
        {
          id: 'raw-draft',
          content: '发布审批需要业务负责人复核。',
          docId: 'source-doc',
          chunkIndex: 3,
          projectId: 'game-a',
          lifecycleStatus: 'draft',
        },
        {
          id: 'raw-blocked-doc',
          content: '发布审批需要业务负责人复核。',
          docId: 'blocked-doc',
          chunkIndex: 0,
          projectId: 'game-a',
        },
      ],
      'user-1',
    );

    const result = await service.resolveObsidianSourceEvidence(
      '发布审批需要谁复核？',
      [
        {
          path: 'notes/source.md',
          type: 'note',
          title: '来源摘要',
          content: '摘要中的结论不作为回答证据。',
          score: 3,
          ragDocId: 'source-doc',
          tags: [],
        },
        {
          path: 'notes/blocked.md',
          type: 'note',
          title: '受限来源',
          content: '另一份摘要。',
          score: 2,
          ragDocId: 'blocked-doc',
          tags: [],
        },
      ],
      'user-1',
      { tenantId: 'tenant-1', scope: { projectId: 'game-a' } },
    );

    expect(documentPermissionService.getAllowedDocIds).toHaveBeenCalledWith(
      'user-1',
      [],
      [],
      'tenant-1',
    );
    expect(result.mappedDocIds).toEqual(new Set(['source-doc', 'blocked-doc']));
    expect(result.sourceNotePaths).toEqual(
      new Set(['notes/source.md', 'notes/blocked.md']),
    );
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toMatchObject({
      id: 'raw-allowed',
      docId: 'source-doc',
      content: '发布审批需要业务负责人复核。',
      projectId: 'game-a',
      lifecycleStatus: 'effective',
    });
    expect(result.chunks[0].content).not.toContain('摘要');
  });

  it('uses permission-service grants for shared documents regardless of owner', async () => {
    const { service, documentPermissionService } = createService();
    documentPermissionService.getAllowedDocIds.mockResolvedValue(
      new Set(['shared-doc']),
    );
    service.indexChunks(
      [
        {
          id: 'shared-raw',
          content: '共享文档原文包含发布审批要求。',
          docId: 'shared-doc',
          chunkIndex: 0,
        },
      ],
      'document-owner',
    );

    const result = await service.resolveObsidianSourceEvidence(
      '发布审批要求是什么？',
      [
        {
          path: 'notes/shared-source.md',
          type: 'note',
          title: '共享文档摘要',
          content: '摘要仅用于定位原文。',
          score: 3,
          ragDocId: 'shared-doc',
          tags: [],
        },
      ],
      'viewer-user',
    );

    expect(result.chunks.map((chunk) => chunk.id)).toContain('shared-raw');
  });

  it('excludes source notes without a ragDocId instead of treating their summary as evidence', async () => {
    const { service } = createService();
    const result = await service.resolveObsidianSourceEvidence(
      '发布审批要求是什么？',
      [
        {
          path: 'notes/legacy-source.md',
          type: 'note',
          isSourceNote: true,
          title: '旧来源摘要',
          content: '摘要不能当作原文证据。',
          score: 3,
          tags: [],
        },
      ],
      'user-1',
    );

    expect(result.chunks).toEqual([]);
    expect(result.mappedDocIds).toEqual(new Set());
    expect(result.sourceNotePaths).toEqual(new Set(['notes/legacy-source.md']));
  });

  it('puts resolved original chunks into the Auto Fast Path and removes their note hits', async () => {
    const { service, obsidianKnowledge } = createService();
    const raw = {
      id: 'raw-source',
      content: '发布审批需要业务负责人复核。',
      docId: 'source-doc',
      chunkIndex: 0,
    };
    service.indexChunks([raw], 'user-1');
    (obsidianKnowledge.search as jest.Mock).mockResolvedValue([
      {
        path: 'notes/source.md',
        type: 'note',
        title: '来源摘要',
        content: '摘要写着发布由负责人复核。',
        score: 3,
        ragDocId: 'source-doc',
        tags: [],
      },
    ]);
    jest.spyOn(service, 'retrieveDetailed').mockResolvedValue({
      chunks: [],
      diagnostics: {} as never,
      profile: {} as never,
    });
    jest
      .spyOn(
        service as unknown as {
          assessRetrievalQuality: (...args: unknown[]) => unknown;
        },
        'assessRetrievalQuality',
      )
      .mockReturnValue({ sufficient: true, reason: 'test' });

    const result = await service.assessFastPath(
      '发布审批需要谁复核？',
      'user-1',
    );

    expect(result.chunks).toContainEqual(
      expect.objectContaining({
        id: 'raw-source',
        content: '发布审批需要业务负责人复核。',
      }),
    );
    expect(result.obsidianHits).toEqual([]);
    expect(result.prefetchedFastPath.retrieval.chunks).toContainEqual(
      expect.objectContaining({ id: 'raw-source' }),
    );
  });

  it('refuses when the knowledge base and web search have no evidence', async () => {
    const { service, llmInvoke } = createService();
    llmInvoke.mockResolvedValueOnce('今天是星期三。');

    await expect(service.answer('anything')).resolves.toMatchObject({
      answer:
        '当前没有找到足以支撑确定结论的可靠资料。你可以补充具体版本、项目、时间范围或业务场景，也可以切换到深度检索继续查找。',
      references: [],
      retrievalSufficient: false,
      retrievalReason:
        '没有检索到候选片段；Obsidian 未命中；联网搜索和模型回答均不可用，已进入安全降级',
    });
    expect(llmInvoke).not.toHaveBeenCalled();
  });

  it('does not use a source-note summary when its raw document has no accessible chunks', async () => {
    const { service, obsidianKnowledge, llmInvoke } = createService();
    (obsidianKnowledge.search as jest.Mock).mockResolvedValue([
      {
        path: 'notes/restricted-source.md',
        type: 'note',
        title: '来源摘要',
        content: '摘要内容：发布前必须经过业务负责人审批。',
        score: 3,
        ragDocId: 'restricted-doc',
        tags: [],
      },
      {
        path: 'notes/legacy-source.md',
        type: 'note',
        isSourceNote: true,
        title: '旧来源摘要',
        content: '摘要内容：发布前必须由负责人审批。',
        score: 2,
        tags: [],
      },
    ]);

    const result = await service.answer(
      '发布前需要谁审批？',
      [],
      'user-1',
      [],
      undefined,
      { vectorSearch: false, knowledgeOnly: true },
    );

    expect(result.retrievalSufficient).toBe(false);
    expect(result.references).toEqual([]);
    expect(result.obsidianHits).toEqual([]);
    expect(obsidianKnowledge.assessHits).toHaveBeenCalledWith(
      expect.any(String),
      [],
    );
    expect(llmInvoke).not.toHaveBeenCalled();
  });

  it('answers from the resolved raw chunk and cites its original chunk ID', async () => {
    const { service, obsidianKnowledge, llmInvoke } = createService();
    const rawContent = '发布前必须由业务负责人复核。';
    service.indexChunks(
      [
        {
          id: 'raw-source-chunk',
          content: rawContent,
          docId: 'source-doc',
          chunkIndex: 7,
          headingPath: ['发布规范', '审批'],
          sourceStart: 120,
          sourceEnd: 145,
        },
      ],
      'user-1',
    );
    (obsidianKnowledge.search as jest.Mock).mockResolvedValue([
      {
        path: 'notes/source.md',
        type: 'note',
        title: '发布规范摘要',
        content: '摘要内容：负责人审核即可。',
        score: 3,
        ragDocId: 'source-doc',
        tags: [],
      },
    ]);
    jest.spyOn(service, 'retrieveDetailed').mockResolvedValue({
      chunks: [],
      diagnostics: {
        intent: 'lookup',
        candidateDepth: 8,
        expandedChunks: 0,
        duplicateChunksRemoved: 0,
        documentLimitRemoved: 0,
        budgetRemoved: 0,
        contextCharacters: 0,
      },
      profile: {
        intent: 'lookup',
        candidateDepth: 8,
        finalTopK: 4,
        neighborWindow: 0,
        sameSectionLimit: 0,
        contextCharacterBudget: 3500,
        maxChunksPerDocument: 2,
      },
    });
    jest
      .spyOn(
        service as unknown as {
          assessRetrievalQuality: (...args: unknown[]) => unknown;
        },
        'assessRetrievalQuality',
      )
      .mockReturnValue({ sufficient: true, reason: 'test' });
    jest
      .spyOn(
        service as unknown as {
          assessCitationSupport: (...args: unknown[]) => unknown;
        },
        'assessCitationSupport',
      )
      .mockReturnValue({ sufficient: true, reason: 'test' });
    llmInvoke.mockResolvedValueOnce(`${rawContent}[片段1]`);

    const result = await service.answer(
      '发布前必须由谁复核？',
      [],
      'user-1',
      [],
      undefined,
      { vectorSearch: false, knowledgeOnly: true },
    );

    const prompt = JSON.stringify(llmInvoke.mock.calls[0]?.[0]);
    expect(prompt).toContain(rawContent);
    expect(prompt).not.toContain('负责人审核即可');
    expect(result.references).toContainEqual(
      expect.objectContaining({
        id: 'raw-source-chunk',
        docId: 'source-doc',
        chunkIndex: 7,
        headingPath: ['发布规范', '审批'],
        sourceStart: 120,
        sourceEnd: 145,
      }),
    );
    expect(result.obsidianHits).toEqual([]);
  });

  it('uses the general model for objective questions when routing has no usable intent', async () => {
    const { service, llmInvoke } = createService();
    llmInvoke.mockResolvedValueOnce('2');

    await expect(
      service.answer('量子计算是什么', [], undefined, [], undefined, {
        queryPlan: {
          action: 'direct',
          domain: 'public',
          contextMode: 'independent',
          standaloneQuery: '量子计算是什么',
          subQueries: [],
          taskType: 'lookup',
          needsGraph: false,
          entities: [],
          filters: {},
        },
      }),
    ).resolves.toMatchObject({
      answer: '2',
      references: [],
      retrievalSufficient: true,
      retrievalReason: expect.stringContaining('已使用模型通用能力回答'),
    });
    expect(llmInvoke).toHaveBeenCalled();
  });

  it('answers arithmetic deterministically before mixed-history fallback', async () => {
    const { service, llmInvoke } = createService();
    const result = await service.answer(
      '1+1等于多少',
      [{ role: 'human', content: '1+1等于5' }],
      undefined,
      [],
      undefined,
      {
        knowledgeOnly: true,
        queryIntent: {
          contextMode: 'mixed',
        } as never,
      },
    );

    expect(result.answer).toContain('客观事实：1+1等于2');
    expect(result.answer).toContain('历史对话设定：1+1等于5');
    expect(llmInvoke).not.toHaveBeenCalled();
  });

  it('prompts conversation settings to include objective facts and the local setting', async () => {
    const { service, llmInvoke } = createService();
    await (
      service as unknown as {
        generateConversationStateAnswer: Function;
      }
    ).generateConversationStateAnswer('React是什么', [
      { role: 'human', content: 'React是一种动物' },
    ]);

    expect(llmInvoke).toHaveBeenCalledWith(expect.stringContaining('客观事实'));
    expect(llmInvoke).toHaveBeenCalledWith(
      expect.stringContaining('当前会话设定'),
    );
  });

  it('uses Bocha web search when local evidence is insufficient', async () => {
    const { service, bochaSearchService } = createService();
    bochaSearchService.isEnabled.mockReturnValue(true);
    bochaSearchService.search.mockResolvedValue([
      {
        title: '官方活动说明',
        url: 'https://example.com/activity',
        snippet: '活动开放时间为周末。',
        summary: '官方活动摘要',
      },
    ]);

    await expect(service.answer('活动什么时候开放？')).resolves.toMatchObject({
      retrievalSufficient: true,
      references: [
        { docId: 'https://example.com/activity', retrievalSource: 'web' },
      ],
      retrievalReason: expect.stringContaining('Bocha 联网搜索'),
    });
    expect(bochaSearchService.search).toHaveBeenCalledWith(
      '活动什么时候开放？',
      5,
    );
  });

  it('refuses when no related document or web evidence is found', async () => {
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
      answer:
        '当前没有找到足以支撑确定结论的可靠资料。你可以补充具体版本、项目、时间范围或业务场景，也可以切换到深度检索继续查找。',
      references: [],
      retrievalSufficient: false,
      retrievalReason:
        '没有检索到候选片段；Obsidian 未命中；联网搜索和模型回答均不可用，已进入安全降级',
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

  it('Simple 直答未命中后对精确查询也执行统一混合检索', async () => {
    const { service, llmInvoke, vectorStoreProvider } = createService();
    llmInvoke.mockResolvedValueOnce('活动 ID ACT100 的状态是已上线。[片段1]');
    service.indexChunks(
      [
        {
          id: 'chunk-act100',
          content: '活动 ID ACT100 的状态是已上线。',
          docId: 'activity-doc',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );

    const result = await service.answer(
      '活动 ID ACT100 的状态是什么？',
      [],
      'user-1',
      [],
      undefined,
      { adaptiveVectorSearch: true },
    );

    expect(result.retrievalSufficient).toBe(true);
    expect(vectorStoreProvider.similaritySearch).toHaveBeenCalled();
  });

  it('Simple 自适应检索对流程类问题直接使用混合检索', async () => {
    const { service, llmInvoke, vectorStoreProvider } = createService();
    llmInvoke.mockResolvedValueOnce('先创建活动，再配置奖池。[片段1]');
    service.indexChunks(
      [
        {
          id: 'chunk-process',
          content: '配置抽奖活动时，先创建活动，再配置奖池。',
          docId: 'activity-process-doc',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );

    await service.answer(
      '如何配置抽奖活动流程？',
      [],
      'user-1',
      [],
      undefined,
      { adaptiveVectorSearch: true },
    );

    expect(vectorStoreProvider.similaritySearch).toHaveBeenCalledTimes(1);
  });

  it('Simple 关键词证据不足时补查向量库', async () => {
    const { service, llmInvoke, vectorStoreProvider } = createService({
      vectorStoreProvider: {
        similaritySearch: jest.fn().mockResolvedValue([
          {
            id: 'chunk-semantic',
            content: '活动 ID ACT100 的状态是已上线。',
            docId: 'activity-semantic-doc',
            chunkIndex: 0,
            score: 0.98,
          },
        ]),
      },
    });
    llmInvoke.mockResolvedValueOnce('活动 ID ACT100 的状态是已上线。[片段1]');
    service.indexChunks(
      [
        {
          id: 'chunk-semantic',
          content: '活动 ID ACT100 的状态是已上线。',
          docId: 'activity-semantic-doc',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );
    jest
      .spyOn(
        service as unknown as { searchLocalBm25: jest.Mock },
        'searchLocalBm25',
      )
      .mockReturnValue([]);

    const result = await service.answer(
      '活动 ID ACT100 的状态是什么？',
      [],
      'user-1',
      [],
      undefined,
      { adaptiveVectorSearch: true },
    );

    expect(vectorStoreProvider.similaritySearch).toHaveBeenCalledTimes(1);
    expect(result.retrievalSufficient).toBe(true);
  });

  it('非结构化片段命中不绕过完整生成链路', async () => {
    const { service, llmInvoke, vectorStoreProvider } = createService();
    llmInvoke.mockResolvedValue('活动 ID ACT100 的状态是已上线。[片段1]');
    service.indexChunks(
      [
        {
          id: 'chunk-governed-direct',
          content: '活动 ID ACT100 的状态是已上线。',
          docId: 'governed-activity-doc',
          chunkIndex: 0,
          lifecycleStatus: 'effective',
          docVersion: '2026.01',
          effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
          sourceAuthority: 'official',
        },
      ],
      'user-1',
    );

    const result = await service.answer(
      '活动 ID ACT100 的状态是什么？',
      [],
      'user-1',
      [],
      undefined,
      { karpathyDirectAnswer: true },
    );

    expect(result.answer).toContain('活动 ID ACT100 的状态是已上线');
    expect(result.retrievalReason).toContain('检索片段和答案引用通过');
    expect(vectorStoreProvider.similaritySearch).toHaveBeenCalledTimes(1);
    expect(llmInvoke).toHaveBeenCalled();
  });

  it('缺少版本元数据的 Karpathy 知识不能绕过检索与生成门禁', async () => {
    const { service, vectorStoreProvider } = createService();
    service.indexChunks(
      [
        {
          id: 'chunk-missing-version',
          content: '活动 ID ACT101 的状态是已上线。',
          docId: 'missing-version-doc',
          chunkIndex: 0,
          lifecycleStatus: 'effective',
          effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
          sourceAuthority: 'official',
        },
      ],
      'user-1',
    );

    const result = await service.answer(
      '活动 ID ACT101 的状态是什么？',
      [],
      'user-1',
      [],
      undefined,
      { karpathyDirectAnswer: true },
    );

    expect(result.retrievalReason).not.toContain('受治理 Karpathy 编译知识');
    expect(vectorStoreProvider.similaritySearch).toHaveBeenCalledTimes(1);
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
      answer:
        '已检索到相关资料，但回答生成服务未返回符合引用约束的完整答案。为避免把原始片段误当作结论展示，请稍后重试。',
      references: [],
      retrievalSufficient: false,
      retrievalReason: expect.stringContaining('已禁止输出原始片段'),
    });
  });

  it('uses only current evidence for a cited extractive fallback', async () => {
    const { service } = createService();
    const visibleEvidence = [
      {
        id: 'procurement-1',
        content:
          '采购订单 PO 金额超过 100000 元时，必须完成预算审批、法务合同归档和供应商准入检查后才能付款。',
        docId: 'procurement-doc',
        chunkIndex: 0,
        bm25Score: 0.8,
        cosineScore: 0.8,
        totalScore: 0.9,
      },
      {
        id: 'procurement-2',
        content: '付款前必须取得增值税专用发票或财务确认的等效票据。',
        docId: 'procurement-doc',
        chunkIndex: 1,
        bm25Score: 0.7,
        cosineScore: 0.7,
        totalScore: 0.8,
      },
    ];
    const answer = (
      service as unknown as {
        buildCitationSafeExtractiveAnswer: (
          query: string,
          chunks: typeof visibleEvidence,
        ) => string | null;
      }
    ).buildCitationSafeExtractiveAnswer(
      'PO 超过 10 万付款前必须完成哪些动作？',
      visibleEvidence,
    );

    expect(answer).not.toBeNull();
    expect(answer).toContain('预算审批');
    expect(answer).toContain('[片段1]');
    expect(
      (
        service as unknown as {
          assessCitationSupport: (
            value: string,
            chunks: typeof visibleEvidence,
          ) => { sufficient: boolean; reason: string };
        }
      ).assessCitationSupport(answer!, visibleEvidence),
    ).toMatchObject({ sufficient: true });
    expect(
      service
        .selectCitedChunks(answer!, visibleEvidence)
        .map((chunk) => chunk.id),
    ).toContain('procurement-1');
  });

  it('keeps deterministic facts when Agentic requests synthesis', async () => {
    const { service, llmInvoke } = createService();
    const result = await service.generateGroundedAnswer(
      '客户行为日志和财务审计凭证分别保留多久？',
      [
        {
          id: 'retention-1',
          content:
            '章节路径：数据保留与删除制度 > 保留期限\n客户行为日志默认保留 180 天，用于问题排查。财务审计凭证保留 10 年，包含发票和付款审批。',
          docId: 'retention-doc',
          chunkIndex: 0,
          bm25Score: 1,
          cosineScore: 1,
          totalScore: 1,
        },
      ],
      [],
      [],
      undefined,
      { needsSynthesis: true },
    );

    expect(result.answer).toContain('180 天');
    expect(result.answer).toContain('10 年');
    expect(result.retrievalSufficient).toBe(true);
    expect(llmInvoke).not.toHaveBeenCalled();
  });

  it('passes planned answer requirements into the grounded answer prompt', async () => {
    const { service, llmInvoke } = createService();
    llmInvoke.mockResolvedValueOnce('负责人林晓，预算728万元。[片段1]');

    await service.generateGroundedAnswer(
      '请列出项目负责人、预算、交付日期和风险等级。',
      [
        {
          id: 'project-1',
          content:
            '项目负责人：林晓。核准预算：728 万元。正式交付日期：2027 年 3 月 18 日。风险等级：中等。',
          docId: 'project-doc',
          chunkIndex: 0,
          bm25Score: 1,
          cosineScore: 1,
          totalScore: 1,
        },
      ],
      [],
      [],
      undefined,
      {
        answerRequirements: ['负责人和预算', '交付日期和风险等级'],
      },
    );

    const prompt = JSON.stringify(llmInvoke.mock.calls[0]?.[0]);
    expect(prompt).toContain('1. 负责人和预算');
    expect(prompt).toContain('2. 交付日期和风险等级');
  });

  it('extracts the salary date from current evidence instead of a fixed demo value', () => {
    const { service } = createService();
    const answer = service.buildEvidenceFirstAnswer('薪资什么时候发放？', [
      {
        id: 'payroll-current',
        content: '基本工资按月发放，每月 15 日发放。',
        docId: 'payroll-policy',
        chunkIndex: 0,
        bm25Score: 1,
        cosineScore: 1,
        totalScore: 1,
      },
    ]);

    expect(answer).toContain('每月 15 日发放');
    expect(answer).toContain('[片段1]');
    expect(answer).not.toContain('10 日');
  });

  it('does not turn an unrelated payroll schedule into a tax answer', () => {
    const { service } = createService();
    const answer = service.buildEvidenceFirstAnswer('工资需要缴纳哪些税？', [
      {
        id: 'payroll-schedule-only',
        content: '基本工资按月发放，每月 15 日发放。',
        docId: 'payroll-policy',
        chunkIndex: 0,
        bm25Score: 1,
        cosineScore: 1,
        totalScore: 1,
      },
    ]);

    expect(answer).toBeNull();
  });

  it('does not mark a multi-question answer sufficient when one sub-question is missing', () => {
    const { service } = createService();
    const answer = service.buildEvidenceFirstAnswer(
      '工资什么时候发放？工资需要缴纳哪些税？',
      [
        {
          id: 'payroll-schedule-only',
          content: '基本工资按月发放，每月 15 日发放。',
          docId: 'payroll-policy',
          chunkIndex: 0,
          bm25Score: 1,
          cosineScore: 1,
          totalScore: 1,
        },
      ],
    );

    expect(answer).toBeNull();
  });

  it('does not turn a positive schedule sentence into a conditional answer', () => {
    const { service } = createService();
    const answer = service.buildEvidenceFirstAnswer(
      '工资不发放的条件是什么？',
      [
        {
          id: 'payroll-schedule-only',
          content: '基本工资按月发放，每月 15 日发放。',
          docId: 'payroll-policy',
          chunkIndex: 0,
          bm25Score: 1,
          cosineScore: 1,
          totalScore: 1,
        },
      ],
    );

    expect(answer).toBeNull();
  });

  it('repairs a missing citation when the generated claim is supported', async () => {
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
      answer: '引用来源可以降低幻觉风险。[片段1]',
      retrievalSufficient: true,
      retrievalReason: '检索片段和答案引用通过本地质量闸门',
    });
    expect(result.references).toHaveLength(1);
  });

  it('does not expose raw evidence when a later claim is not cited', async () => {
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
      retrievalSufficient: false,
      retrievalReason: expect.stringContaining('已禁止输出原始片段'),
    });
    expect(result.answer).toContain('回答生成服务未返回');
    expect(result.answer).not.toContain('LangChain builds RAG applications');
  });

  it('never exposes a literary chunk as a Karpathy direct answer', async () => {
    const { service } = createService();
    const internal = service as unknown as {
      retrieveBm25Only: jest.Mock;
      tryKarpathyDirectAnswer: (
        query: string,
        userId?: string,
        scope?: unknown,
        entities?: string[],
      ) => Promise<unknown>;
    };
    jest.spyOn(internal, 'retrieveBm25Only').mockResolvedValue([
      {
        id: 'water-margin-1',
        docId: 'water-margin',
        chunkIndex: 1,
        content:
          '行不得一日，正走之间，官道旁边只见走过一条大汉，李逵见那人看他。',
        lifecycleStatus: 'effective',
        sourceAuthority: 'uploaded_document',
        docVersion: 'v1',
      },
    ]);

    const direct = await internal.tryKarpathyDirectAnswer(
      '李逵是谁',
      'user-1',
      undefined,
      ['李逵'],
    );

    expect(direct).toBeNull();
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

  it('accepts an uncited structural lead-in before cited conclusions', () => {
    const { service } = createService();
    const gate = service.validateAnswerCitationSupport(
      '根据检索证据，可归纳为：\n模块 A 负责处理请求。[片段1]',
      [
        {
          id: 'chunk-1',
          docId: 'doc-1',
          chunkIndex: 0,
          content: '模块 A 负责处理请求。',
          bm25Score: 0,
          cosineScore: 0,
          totalScore: 0,
        },
      ],
    );

    expect(gate).toEqual(expect.objectContaining({ sufficient: true }));
  });

  it('accepts a cited markdown table when every data row is supported', () => {
    const { service } = createService();
    const gate = service.validateAnswerCitationSupport(
      [
        '| 项目属性 | 资料内容',
        '|--------------|------------|',
        '| 项目负责人 | 林晓 [片段1] |',
        '| 核准预算 | 728 万元 [片段1] |',
        '| 正式交付日期 | 2027 年 3 月 18 日 [片段1] |',
        '| 风险等级 | 中等 [片段1] |',
      ].join('\n'),
      [
        {
          id: 'chunk-1',
          docId: 'doc-1',
          chunkIndex: 0,
          content:
            '项目负责人：林晓。核准预算：728 万元。正式交付日期：2027 年 3 月 18 日。风险等级：中等。',
          bm25Score: 0,
          cosineScore: 0,
          totalScore: 0,
        },
      ],
    );

    expect(gate).toEqual(expect.objectContaining({ sufficient: true }));
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
    expect(result.answer).toContain('2026 版优先生效');
    expect(result.answer).toContain('[片段1]');
  });

  it('refuses for vector-only hits with no query token overlap', async () => {
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
      answer:
        '当前没有找到足以支撑确定结论的可靠资料。你可以补充具体版本、项目、时间范围或业务场景，也可以切换到深度检索继续查找。',
      references: [],
      retrievalSufficient: false,
      retrievalReason:
        '检索片段与问题关键词重合数 0 低于阈值 1；Obsidian 未命中；联网搜索不可用，已进入安全降级',
    });
    expect(llmInvoke).not.toHaveBeenCalled();
  });

  it('refuses for weak Chinese overlap when only a generic word matches', async () => {
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
      answer:
        '当前没有找到足以支撑确定结论的可靠资料。你可以补充具体版本、项目、时间范围或业务场景，也可以切换到深度检索继续查找。',
      references: [],
      retrievalSufficient: false,
    });
    expect(result.retrievalReason).toContain('已进入安全降级');
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

  it('normalizes Unicode spacing before retrieval', async () => {
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

    const results = await service.retrieve(
      '企业知识库　是什么？',
      {},
      'user-1',
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 'chunk-1',
      docId: 'doc-1',
    });
  });

  it("keeps the user's query wording in the generated answer prompt", async () => {
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

    const result = await service.answer('企业知识库 是什么？', [], 'user-1');

    expect(result.retrievalSufficient).toBe(true);
    const firstPrompt = llmInvoke.mock.calls.at(0)?.at(0);
    expect(JSON.stringify(firstPrompt)).toContain('企业知识库 是什么');
  });

  it("retrieves versioned policy using the user's complete question", async () => {
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
    expect(result.answer).toContain('2026 版优先生效');
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
      {
        vectorSearch: false,
        scope: { projectId: 'game-a' },
        profile: retrievalProfileForTaskType('procedure'),
      },
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

  it('uses a description hit to return its original chunk without embedding the query twice', async () => {
    const searchByVector = jest.fn().mockResolvedValue([
      {
        id: 'description-1',
        tenantId: 'tenant-1',
        docId: 'doc-1',
        userId: 'user-1',
        descriptionType: 'document_summary',
        indexGeneration: 'generation-1',
        docVersion: 'v1',
        content: '描述里的内容不应进入最终回答。',
        sourceChunkIds: ['source-1'],
        score: 0.91,
      },
    ]);
    const { service, embeddingProvider } = createService({
      retrievalDescriptionService: { searchByVector },
    });
    service.indexChunks(
      [
        {
          id: 'source-1',
          content: '原文写明，员工需要在出差前提交审批。',
          docId: 'doc-1',
          chunkIndex: 0,
          docVersion: 'v1',
          indexGeneration: 'generation-1',
          lifecycleStatus: 'effective',
        },
      ],
      'user-1',
    );

    const result = await service.retrieveDetailed(
      '出差前需要做什么',
      { tenantId: 'tenant-1' },
      'user-1',
    );

    expect(embeddingProvider.embedQuery).toHaveBeenCalledTimes(1);
    expect(searchByVector).toHaveBeenCalledWith([1, 0, 0], {
      tenantId: 'tenant-1',
      topK: expect.any(Number),
    });
    expect(result.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'source-1',
          content: '原文写明，员工需要在出差前提交审批。',
        }),
      ]),
    );
    expect(
      result.chunks.some((chunk) => chunk.content.includes('描述里的内容')),
    ).toBe(false);
    expect(result.diagnostics.stages).toEqual(
      expect.objectContaining({
        descriptionCandidates: 1,
        descriptionSourceChunks: 1,
      }),
    );
  });

  it('drops description hits with stale versions, expired sources, or denied document ACLs', async () => {
    const searchByVector = jest.fn().mockResolvedValue([
      {
        id: 'description-stale',
        tenantId: 'tenant-1',
        docId: 'stale-doc',
        userId: 'user-1',
        descriptionType: 'document_summary',
        indexGeneration: 'old-generation',
        docVersion: 'v1',
        content: '舊版本摘要',
        sourceChunkIds: ['stale-source'],
        score: 0.99,
      },
      {
        id: 'description-expired',
        tenantId: 'tenant-1',
        docId: 'expired-doc',
        userId: 'user-1',
        descriptionType: 'document_summary',
        indexGeneration: 'generation-1',
        docVersion: 'v1',
        content: '已过期摘要',
        sourceChunkIds: ['expired-source'],
        score: 0.98,
      },
      {
        id: 'description-private',
        tenantId: 'tenant-1',
        docId: 'private-doc',
        userId: 'user-2',
        descriptionType: 'document_summary',
        indexGeneration: 'generation-1',
        docVersion: 'v1',
        content: '无权摘要',
        sourceChunkIds: ['private-source'],
        score: 0.97,
      },
    ]);
    const { service, documentPermissionService } = createService({
      retrievalDescriptionService: { searchByVector },
    });
    documentPermissionService.getAllowedDocIds.mockResolvedValue(
      new Set(['stale-doc', 'expired-doc']),
    );
    service.indexChunks(
      [
        {
          id: 'stale-source',
          content: '这是当前版本原文。',
          docId: 'stale-doc',
          chunkIndex: 0,
          docVersion: 'v2',
          indexGeneration: 'generation-2',
          lifecycleStatus: 'effective',
        },
        {
          id: 'expired-source',
          content: '这是已经过期的原文。',
          docId: 'expired-doc',
          chunkIndex: 0,
          docVersion: 'v1',
          indexGeneration: 'generation-1',
          lifecycleStatus: 'effective',
          expiredAt: new Date(Date.now() - 60_000),
        },
        {
          id: 'private-source',
          content: '这是没有权限的原文。',
          docId: 'private-doc',
          chunkIndex: 0,
          docVersion: 'v1',
          indexGeneration: 'generation-1',
          lifecycleStatus: 'effective',
        },
      ],
      'user-1',
    );
    jest
      .spyOn(
        service as unknown as { searchLocalBm25: jest.Mock },
        'searchLocalBm25',
      )
      .mockReturnValue([]);

    const result = await service.retrieveDetailed(
      '查找相关原文',
      { tenantId: 'tenant-1' },
      'user-1',
    );

    expect(result.chunks).toHaveLength(0);
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

  it('accepts strongly reranked evidence when instruction wording is absent from the source', () => {
    const { service } = createService();

    const result = service.assessRetrievedChunks(
      '请基于资料库概括这个人物的经历',
      [
        {
          id: 'evidence-1',
          docId: 'doc-1',
          chunkIndex: 0,
          content: '李逵在江州因抢鱼与渔人冲突，后加入梁山。',
          bm25Score: 0,
          cosineScore: 0,
          totalScore: 0.55,
          rerankScore: 0.78,
        },
      ],
    );

    expect(result).toEqual(
      expect.objectContaining({
        sufficient: true,
        reason: expect.stringContaining('重排语义相关度'),
      }),
    );
  });

  it('uses QueryPlan graph retrieval and filters graph facts by ACL, scope, and lifecycle', async () => {
    const { service, documentPermissionService } = createService();
    const graphFacts = [
      {
        source: 'A',
        sourceLabel: 'A',
        relationship: 'USES',
        target: 'B',
        targetLabel: 'B',
        confidence: 0.9,
        sourceId: 'doc-active',
        sourceIds: [
          'doc-active',
          'doc-active-shared',
          'doc-other-project',
          'doc-expired',
          'doc-forbidden',
        ],
      },
      {
        source: 'C',
        sourceLabel: 'C',
        relationship: 'USES',
        target: 'D',
        targetLabel: 'D',
        confidence: 0.9,
        sourceId: 'doc-other-project',
      },
      {
        source: 'E',
        sourceLabel: 'E',
        relationship: 'USES',
        target: 'F',
        targetLabel: 'F',
        confidence: 0.9,
        sourceId: 'doc-expired',
      },
      {
        source: 'G',
        sourceLabel: 'G',
        relationship: 'USES',
        target: 'H',
        targetLabel: 'H',
        confidence: 0.9,
        sourceId: 'doc-forbidden',
      },
    ];
    const queryGraph = jest.fn().mockResolvedValue({ facts: graphFacts });
    Object.assign(service, {
      graphService: {
        isEnabled: jest.fn().mockReturnValue(true),
        queryGraph,
      },
    });
    const allowedDocIds = new Set([
      'doc-active',
      'doc-active-shared',
      'doc-other-project',
      'doc-expired',
    ]);
    jest
      .spyOn(documentPermissionService, 'getAllowedDocIds')
      .mockResolvedValue(allowedDocIds);
    service.indexChunks(
      [
        {
          id: 'active-0',
          content: '有效文档内容',
          docId: 'doc-active',
          chunkIndex: 0,
          projectId: 'game-a',
          lifecycleStatus: 'effective',
        },
        {
          id: 'other-project-0',
          content: '其他项目文档内容',
          docId: 'doc-other-project',
          chunkIndex: 0,
          projectId: 'game-b',
          lifecycleStatus: 'effective',
        },
        {
          id: 'active-shared-0',
          content: '共享关系的第二个有效来源。',
          docId: 'doc-active-shared',
          chunkIndex: 0,
          projectId: 'game-a',
          lifecycleStatus: 'effective',
        },
        {
          id: 'expired-0',
          content: '过期文档内容',
          docId: 'doc-expired',
          chunkIndex: 0,
          projectId: 'game-a',
          lifecycleStatus: 'effective',
          expiredAt: new Date(Date.now() - 60_000),
        },
        {
          id: 'forbidden-0',
          content: '无权文档内容',
          docId: 'doc-forbidden',
          chunkIndex: 0,
          projectId: 'game-a',
          lifecycleStatus: 'effective',
        },
      ],
      'user-1',
    );
    const executionPlan: RetrievalExecutionPlan = {
      planVersion: 2,
      sourcePolicy: 'local_only',
      queries: [{ text: '部署方案', kind: 'original', weight: 1 }],
      profile: retrievalProfileForTaskType('lookup'),
      useGraph: true,
      scope: { projectId: 'game-a' },
      scopeRestricted: true,
      reasonCode: 'internal_evidence_required',
    };

    const result = await service.retrieveDetailed(
      '部署方案',
      {
        executionPlan,
        scope: { projectId: 'game-a' },
        tenantId: 'tenant-1',
        vectorSearch: false,
      },
      'user-1',
    );

    expect(queryGraph).toHaveBeenCalledWith('部署方案', 'user-1', {
      generateAnswer: false,
    });
    expect(documentPermissionService.getAllowedDocIds).toHaveBeenCalledWith(
      'user-1',
      [],
      [],
      'tenant-1',
    );
    expect(result.chunks.map((chunk) => chunk.docId)).toContain('doc-active');
    expect(result.chunks.map((chunk) => chunk.docId)).toContain(
      'doc-active-shared',
    );
    expect(result.chunks.map((chunk) => chunk.docId)).not.toContain(
      'doc-other-project',
    );
    expect(result.chunks.map((chunk) => chunk.docId)).not.toContain(
      'doc-expired',
    );
    expect(result.chunks.map((chunk) => chunk.docId)).not.toContain(
      'doc-forbidden',
    );
    expect(result.diagnostics.graphProbe?.factCount).toBe(2);
  });

  it('searches image candidates without keyword gating and filters ACL, scope, and lifecycle', async () => {
    const { service, documentPermissionService } = createService();
    const searchText = jest.fn().mockResolvedValue([
      {
        docId: 'doc-active',
        url: 'https://example.test/active.png',
        score: 0.9,
      },
      {
        docId: 'doc-other-project',
        url: 'https://example.test/other.png',
        score: 0.95,
      },
      {
        docId: 'doc-expired',
        url: 'https://example.test/expired.png',
        score: 0.99,
      },
      {
        docId: 'doc-forbidden',
        url: 'https://example.test/forbidden.png',
        score: 1,
      },
    ]);
    Object.assign(service, {
      imageIndexService: {
        isEnabled: jest.fn().mockReturnValue(true),
        searchText,
      },
    });
    const allowedDocIds = new Set([
      'doc-active',
      'doc-other-project',
      'doc-expired',
    ]);
    jest
      .spyOn(documentPermissionService, 'getAllowedDocIds')
      .mockResolvedValue(allowedDocIds);
    service.indexChunks(
      [
        {
          id: 'active-0',
          content: '有效文档内容',
          docId: 'doc-active',
          chunkIndex: 0,
          projectId: 'game-a',
          lifecycleStatus: 'effective',
        },
        {
          id: 'other-project-0',
          content: '其他项目文档内容',
          docId: 'doc-other-project',
          chunkIndex: 0,
          projectId: 'game-b',
          lifecycleStatus: 'effective',
        },
        {
          id: 'expired-0',
          content: '过期文档内容',
          docId: 'doc-expired',
          chunkIndex: 0,
          projectId: 'game-a',
          lifecycleStatus: 'effective',
          expiredAt: new Date(Date.now() - 60_000),
        },
        {
          id: 'forbidden-0',
          content: '无权文档内容',
          docId: 'doc-forbidden',
          chunkIndex: 0,
          projectId: 'game-a',
          lifecycleStatus: 'effective',
        },
      ],
      'user-1',
    );

    const result = await service.retrieveDetailed(
      '如何查看发布状态？',
      {
        scope: { projectId: 'game-a' },
        tenantId: 'tenant-1',
        vectorSearch: false,
      },
      'user-1',
    );

    expect(searchText).toHaveBeenCalledWith('如何查看发布状态?', {
      topK: 6,
      userId: 'user-1',
      allowedDocIds,
    });
    expect(result.chunks.map((chunk) => chunk.docId)).toContain('doc-active');
    expect(result.chunks.map((chunk) => chunk.docId)).not.toContain(
      'doc-other-project',
    );
    expect(result.chunks.map((chunk) => chunk.docId)).not.toContain(
      'doc-expired',
    );
    expect(result.chunks.map((chunk) => chunk.docId)).not.toContain(
      'doc-forbidden',
    );
    expect(result.diagnostics.imageProbe?.hitCount).toBe(1);
  });
});
