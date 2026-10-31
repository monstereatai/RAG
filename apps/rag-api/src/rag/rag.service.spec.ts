import { createService } from './rag.service.test-utils';

describe('RagService answer and evidence scenarios', () => {
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
    const { service, indexService } = createService();
    (
      indexService as unknown as { persistedEntries: unknown[] }
    ).persistedEntries = [
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
        governedDirectAnswer: true,
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
      governedDirectAnswer: true,
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
      undefined,
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
    const { service, obsidianKnowledge, obsidianAssessHitsMock, llmInvoke } =
      createService();
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
    expect(obsidianAssessHitsMock).toHaveBeenCalledWith(expect.any(String), []);
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

    const result = await service.answer(
      '量子计算是什么',
      [],
      undefined,
      [],
      undefined,
      {
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
      },
    );
    expect(result).toMatchObject({
      answer: '2',
      references: [],
      retrievalSufficient: true,
    });
    expect(result.retrievalReason).toContain('已使用模型通用能力回答');
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
        },
      },
    );

    expect(result.answer).toContain('客观事实：1+1等于2');
    expect(result.answer).toContain('历史对话设定：1+1等于5');
    expect(llmInvoke).not.toHaveBeenCalled();
  });

  it('prompts conversation settings to include objective facts and the local setting', async () => {
    const { answerService, llmInvoke } = createService();
    const fallbackService = (
      answerService as unknown as {
        fallbackService: {
          generateConversationStateAnswer: (
            query: string,
            history: Array<{ role: 'human' | 'ai'; content: string }>,
          ) => Promise<string | null>;
        };
      }
    ).fallbackService;
    await fallbackService.generateConversationStateAnswer('React是什么', [
      { role: 'human', content: 'React是一种动物' },
    ]);

    const prompt = llmInvoke.mock.calls[0]?.[0];
    expect(prompt).toEqual(expect.stringContaining('客观事实'));
    expect(prompt).toEqual(expect.stringContaining('当前会话设定'));
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

    const result = await service.answer('活动什么时候开放？');
    expect(result).toMatchObject({
      retrievalSufficient: true,
      references: [
        { docId: 'https://example.com/activity', retrievalSource: 'web' },
      ],
    });
    expect(result.retrievalReason).toContain('Bocha 联网搜索');
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
});
