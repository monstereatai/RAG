import { createService } from './rag.service.test-utils';
import { retrievalProfileForTaskType } from './retrieval/context-builder';
import type { RetrievalExecutionPlan } from './planning/retrieval-policy.service';

describe('RagService retrieval sources and ranking', () => {
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

    const result = await service.answer('quantum physics', [], 'user-1');
    expect(result).toMatchObject({
      answer:
        '当前没有找到足以支撑确定结论的可靠资料。你可以补充具体版本、项目、时间范围或业务场景，也可以切换到深度检索继续查找。',
      references: [],
      retrievalSufficient: false,
    });
    expect(result.retrievalReason).toContain('没有检索到候选片段');
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
    let searchOptions: { tenantId?: string; topK?: number } | undefined;
    const embedQuery = jest.fn().mockResolvedValue([1, 0, 0]);
    const searchByVector = jest.fn(
      (_vector: number[], options: { tenantId?: string; topK?: number }) => {
        searchOptions = options;
        return Promise.resolve([
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
      },
    );
    const { service } = createService({
      embeddingProvider: { embedQuery },
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

    expect(embedQuery).toHaveBeenCalledTimes(1);
    expect(searchOptions?.tenantId).toBe('tenant-1');
    expect(typeof searchOptions?.topK).toBe('number');
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
    const { service, documentPermissionService, indexService } = createService({
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
    jest.spyOn(indexService, 'searchLocalBm25').mockReturnValue([]);

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

  it('does not treat a strong rerank score as proof of evidence coverage', () => {
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

    expect(result.sufficient).toBe(false);
    expect(result.status).toBe('insufficient');
  });

  it('uses QueryPlan graph retrieval and filters graph facts by ACL, scope, and lifecycle', async () => {
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
    const { service, documentPermissionService } = createService({
      graphService: { isEnabled: jest.fn().mockReturnValue(true), queryGraph },
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
      allowedDocIds: [
        'doc-active',
        'doc-active-shared',
        'doc-other-project',
        'doc-expired',
      ],
    });
    expect(documentPermissionService.getAllowedDocIds).toHaveBeenCalledWith(
      'user-1',
      [],
      [],
      'tenant-1',
      undefined,
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
    const { service, documentPermissionService } = createService({
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
