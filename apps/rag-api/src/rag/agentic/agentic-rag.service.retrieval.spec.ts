import type { AgenticRagStateType } from './agentic-rag.state';
import type { ObsidianSearchHit } from '../../modules/obsidian/obsidian-knowledge.service';
import type { PrefetchedFastPath } from '../contracts/rag-types';
import { retrievalFingerprintsForPlan } from '../evidence/retrieval-fingerprint';
import {
  chunk,
  createService,
  serviceMock,
} from './agentic-rag.service.test-utils';

describe('AgenticRagService budget boundaries', () => {
  it('uses the Hybrid Fast Path as Auto direct-answer evidence instead of a second direct lookup', async () => {
    const { service, ragService } = createService();
    const prefetchedFastPath = {
      retrieval: { chunks: [], diagnostics: {}, profile: {} },
      obsidianHits: [],
    } as never;
    ragService.assessFastPath.mockResolvedValue({
      sufficient: true,
      reason: '结构化状态证据充分',
      chunks: [],
      obsidianHits: [],
      prefetchedFastPath,
    });
    ragService.answer.mockResolvedValue({
      answer: 'ACT100 已上线。',
      references: [],
      retrievalSufficient: true,
      retrievalReason: '结构化状态证据充分',
    });

    await expect(
      service.run('ACT100 的状态是什么？', 'auto'),
    ).resolves.toMatchObject({
      answer: 'ACT100 已上线。',
      route: 'simple',
      retrievalSufficient: true,
    });
    expect(serviceMock(ragService, 'answerDirect')).not.toHaveBeenCalled();
    expect(serviceMock(ragService, 'assessFastPath')).toHaveBeenCalledTimes(1);
    expect(serviceMock(ragService, 'answer')).toHaveBeenCalledWith(
      'ACT100 的状态是什么？',
      [],
      undefined,
      [],
      expect.any(Function),
      expect.objectContaining({ prefetchedFastPath }),
    );
  });

  it('reuses a sufficient Base Case Fast Path result in Auto simple route', async () => {
    const { service, ragService } = createService();
    const reviewedChunk = chunk('reviewed-bad-case:feedback-1', 0.96);
    const prefetchedFastPath = {
      retrieval: {
        chunks: [],
        diagnostics: {},
        profile: {},
      },
      obsidianHits: [],
      badCaseMatches: [
        {
          id: 'feedback-1',
          query: '韦水春是谁',
          text: '正确处理标准：韦水春是临床病理工作人员。',
          score: 0.96,
          mode: 'correction',
        },
      ],
    } as never;
    ragService.assessFastPath.mockResolvedValue({
      sufficient: true,
      reason: 'Base Case 证据充分',
      chunks: [reviewedChunk],
      obsidianHits: [],
      prefetchedFastPath,
    });
    ragService.answer.mockResolvedValue({
      answer: '韦水春是临床病理工作人员。',
      references: [reviewedChunk],
      retrievalSufficient: true,
      retrievalReason: 'Base Case 证据充分',
    });

    await expect(service.run('韦水春是谁', 'auto')).resolves.toMatchObject({
      answer: '韦水春是临床病理工作人员。',
      route: 'simple',
      retrievalSufficient: true,
    });
    expect(ragService.answer.mock.calls[0]).toEqual([
      '韦水春是谁',
      [],
      undefined,
      [],
      expect.any(Function),
      expect.objectContaining({ prefetchedFastPath }),
    ]);
  });

  it('caps retrieval query count and returned chunks', async () => {
    const { service, ragService } = createService();
    ragService.retrieve.mockResolvedValue([chunk('c1', 0.9), chunk('c2', 0.8)]);
    ragService.retrieveBm25Only.mockResolvedValue([
      chunk('c3', 0.7),
      chunk('c4', 0.6),
    ]);

    const state = {
      query: '请分析差旅制度',
      augmentedQueries: ['扩展 A', '扩展 B', '扩展 C'],
    } as AgenticRagStateType;

    const result = await service.retrievalNode(state, {
      configurable: { userId: 'user-1' },
    });

    expect(ragService.retrieve.mock.calls).toHaveLength(1);
    expect(ragService.retrieve.mock.calls[0]?.[1]).toMatchObject({
      skipRerank: true,
    });
    expect(
      ragService.retrieve.mock.calls[0]?.[1]?.executionPlan?.queries?.map(
        (item: { text: string }) => item.text,
      ) ?? [],
    ).toEqual(['请分析差旅制度', '扩展 A']);
    expect(ragService.retrieveBm25Only.mock.calls).toHaveLength(0);
    expect(result.retrievedChunks?.map((item) => item.id)).toEqual([
      'c1',
      'c2',
    ]);
    expect(result.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'evidence_bundle',
          producer: 'retrieval',
        }),
      ]),
    );
  });

  it('merges planned correction and Obsidian evidence into explicit agentic retrieval', async () => {
    const { service, ragService } = createService();
    const reviewed = chunk('reviewed', 0.96);
    const obsidian = chunk('obsidian', 0.82);
    ragService.retrieve.mockResolvedValue([chunk('formal', 0.9)]);
    ragService.toReviewedEvidenceChunks.mockReturnValue([reviewed]);
    ragService.getObsidianContext.mockResolvedValue({
      hits: [
        {
          path: 'notes/rag.md',
          type: 'note',
          title: '人工笔记',
          content: '人工补充内容',
          score: 0.8,
          tags: [],
        },
      ],
      context: 'Obsidian context',
    });
    ragService.toObsidianChunks.mockReturnValue([obsidian]);

    const result = await service.retrievalNode(
      {
        query: '请分析活动方案风险',
        augmentedQueries: [],
        badCaseMatches: [
          {
            id: 'bad-case-1',
            query: '活动方案风险',
            text: '正确处理标准：先核对风险清单。',
            score: 0.96,
            mode: 'correction',
          },
        ],
      } as unknown as AgenticRagStateType,
      { configurable: { userId: 'user-1' } },
    );

    expect(serviceMock(ragService, 'getObsidianContext')).toHaveBeenCalledWith(
      '请分析活动方案风险',
      'user-1',
      undefined,
    );
    expect(serviceMock(ragService, 'toObsidianChunks')).toHaveBeenCalledWith([
      expect.objectContaining({ path: 'notes/rag.md', type: 'note' }),
    ]);
    expect(result.retrievedChunks?.map((item) => item.id)).toEqual(
      expect.arrayContaining(['reviewed', 'formal']),
    );
  });

  it('uses source-note hits to retrieve original chunks without keeping their summaries as evidence', async () => {
    const { service, ragService } = createService();
    const sourceHit: ObsidianSearchHit = {
      path: 'notes/source.md',
      type: 'note',
      isSourceNote: true,
      ragDocId: 'source-doc',
      title: '来源摘要',
      content: '摘要里有结论，但原文才是证据。',
      score: 0.9,
      tags: [],
    };
    const legacySourceHit: ObsidianSearchHit = {
      path: 'notes/legacy-source.md',
      type: 'note',
      isSourceNote: true,
      title: '旧来源摘要',
      content: '旧摘要没有 rag_doc_id，也不能作为证据。',
      score: 0.8,
      tags: [],
    };
    const manualHit: ObsidianSearchHit = {
      path: 'notes/manual.md',
      type: 'note',
      title: '人工补充',
      content: '人工维护的补充内容。',
      score: 0.7,
      tags: [],
    };
    const raw = {
      ...chunk('source-raw', 0.9),
      docId: 'source-doc',
      content: '原文：发布前必须由业务负责人复核。',
    };
    ragService.retrieve.mockResolvedValue([]);
    ragService.retrieveBm25Only.mockResolvedValue([]);
    ragService.getObsidianContext.mockResolvedValue({
      hits: [sourceHit, legacySourceHit, manualHit],
      context: 'source and manual notes',
    });
    ragService.resolveObsidianSourceEvidence.mockResolvedValue({
      chunks: [raw],
      mappedDocIds: new Set(['source-doc']),
      sourceNotePaths: new Set(['notes/source.md', 'notes/legacy-source.md']),
    });
    ragService.toObsidianChunks.mockImplementation((hits) =>
      hits.map((hit) => chunk(`obsidian:${hit.path}`, 0.3)),
    );

    const result = await service.retrievalNode(
      {
        query: '发布前必须由谁复核？',
        augmentedQueries: [],
      } as unknown as AgenticRagStateType,
      { configurable: { userId: 'user-1' } },
    );

    expect(
      serviceMock(ragService, 'resolveObsidianSourceEvidence'),
    ).toHaveBeenCalledWith(
      '发布前必须由谁复核？',
      [sourceHit, legacySourceHit, manualHit],
      'user-1',
      {},
    );
    expect(serviceMock(ragService, 'toObsidianChunks')).toHaveBeenCalledWith([
      manualHit,
    ]);
    expect(result.retrievedChunks).toContainEqual(raw);
    expect(result.retrievedChunks?.map((item) => item.id)).not.toContain(
      'obsidian:notes/source.md',
    );
    expect(result.subQuestions?.[0].evidenceIds).toContain('source-raw');
    const artifacts: unknown = (result as unknown as { artifacts?: unknown })
      .artifacts;
    if (!Array.isArray(artifacts)) {
      throw new Error('Expected retrieval artifacts.');
    }
    const evidenceBundle: unknown = artifacts.find(
      (artifact: unknown) =>
        typeof artifact === 'object' &&
        artifact !== null &&
        'type' in artifact &&
        artifact.type === 'evidence_bundle',
    );
    const payload: unknown =
      typeof evidenceBundle === 'object' &&
      evidenceBundle !== null &&
      'payload' in evidenceBundle
        ? evidenceBundle.payload
        : undefined;
    const chunkIds: unknown =
      typeof payload === 'object' && payload !== null && 'chunkIds' in payload
        ? payload.chunkIds
        : undefined;
    expect(Array.isArray(chunkIds) && chunkIds.includes('source-raw')).toBe(
      true,
    );
  });

  it('reuses fast-path evidence when agentic retrieval starts', async () => {
    const { service, ragService } = createService();
    const retrieve = serviceMock(ragService, 'retrieve');
    const getObsidianContext = serviceMock(ragService, 'getObsidianContext');
    const toReviewedEvidenceChunks = serviceMock(
      ragService,
      'toReviewedEvidenceChunks',
    );
    const toObsidianChunks = serviceMock(ragService, 'toObsidianChunks');
    const retrieveOptions = {
      executionPlan: {
        planVersion: 2 as const,
        sourcePolicy: 'local_only' as const,
        queries: [
          { text: '原始问题', kind: 'original' as const, weight: 1 },
          { text: '扩展问题', kind: 'sub_query' as const, weight: 1 },
        ],
        profile: {
          intent: 'lookup' as const,
          candidateDepth: 8,
          finalTopK: 4,
          neighborWindow: 0,
          sameSectionLimit: 0,
          contextCharacterBudget: 3500,
          maxChunksPerDocument: 2,
        },
        useGraph: false,
        scopeRestricted: false,
        reasonCode: 'internal_evidence_required' as const,
      },
    };
    ragService.retrieve.mockResolvedValue([chunk('c2', 0.8)]);
    const prefetchedFastPath = {
      retrieval: { chunks: [], diagnostics: {}, profile: {} },
      obsidianHits: [
        {
          path: 'notes/fast-path.md',
          type: 'note',
          title: '快速路径补充',
          content: '快速路径中的人工补充。',
          score: 0.8,
          tags: [],
        },
      ],
      badCaseMatches: [
        {
          id: 'feedback-1',
          query: '原始问题',
          text: '正确处理标准：复用已有纠正证据。',
          score: 0.95,
          mode: 'correction',
        },
      ],
      retrievalAttempted: true,
      retrievalFingerprints: retrievalFingerprintsForPlan(
        '原始问题',
        'user-1',
        retrieveOptions,
        retrieveOptions.executionPlan,
      ),
    } as unknown as PrefetchedFastPath;
    ragService.toObsidianChunks.mockReturnValue([
      chunk('obsidian:notes/fast-path.md', 0.8),
    ]);

    const result = await service.retrievalNode(
      {
        query: '原始问题',
        augmentedQueries: ['扩展问题'],
        subQuestions: [
          {
            id: 'subq-1',
            question: '原始问题',
            dependsOn: [],
            status: 'planned',
            evidenceIds: [],
            retrievalAttempts: 0,
            sufficient: false,
            reason: '',
          },
          {
            id: 'subq-2',
            question: '扩展问题',
            dependsOn: ['subq-1'],
            status: 'planned',
            evidenceIds: [],
            retrievalAttempts: 0,
            sufficient: false,
            reason: '',
          },
        ],
      } as unknown as AgenticRagStateType,
      {
        configurable: {
          userId: 'user-1',
          retrieveOptions,
          fastPathChunks: [chunk('c1', 0.9)],
          prefetchedFastPath,
          subQuestionLimit: 2,
        },
      },
    );

    expect(retrieve).not.toHaveBeenCalled();
    expect(getObsidianContext).not.toHaveBeenCalled();
    expect(toReviewedEvidenceChunks).toHaveBeenCalledWith(
      prefetchedFastPath.badCaseMatches,
    );
    expect(toObsidianChunks).toHaveBeenCalledWith(
      prefetchedFastPath.obsidianHits,
    );
    expect(result.retrievedChunks?.map((item) => item.id)).toEqual(['c1']);
  });

  it('retrieves fresh evidence on retry and preserves web search history', async () => {
    const { service, ragService } = createService();
    ragService.retrieve.mockResolvedValue([chunk('fresh', 0.8)]);
    const result = await service.retrievalNode(
      {
        query: '需要补充的事实',
        augmentedQueries: [],
        retryCount: 1,
        webSearchAttempted: true,
        webSearchCount: 2,
        retrievedChunks: [chunk('web:https://example.com', 0.15)],
      } as unknown as AgenticRagStateType,
      { configurable: { fastPathChunks: [chunk('stale', 0.9)] } },
    );

    expect(serviceMock(ragService, 'retrieve')).toHaveBeenCalledTimes(1);
    expect(result.retrievedChunks?.map((item) => item.id)).toEqual([
      'fresh',
      'web:https://example.com',
    ]);
    expect(result).toMatchObject({
      webSearchAttempted: true,
      webSearchCount: 2,
    });
    expect(
      result.artifacts?.find((item) => item.type === 'evidence_bundle')
        ?.payload,
    ).toMatchObject({ webSearchCount: 2 });
  });

  it('routes answer repair to generation and missing evidence to retrieval', () => {
    const { service } = createService({ 'agentic.maxRetries': 3 });
    const state = { passed: false, retryCount: 1 } as AgenticRagStateType;

    expect(
      service.reflectionRouter({ ...state, retryTarget: 'generate' }),
    ).toBe('generate');
    expect(
      service.reflectionRouter({ ...state, retryTarget: 'retrieval' }),
    ).toBe('retrieval');
    expect(
      service.reflectionRouter({
        ...state,
        retryCount: 4,
        retryTarget: 'retrieval',
      }),
    ).toBe('end');
  });

  it('reuses Fast Path Bad Case candidates during query planning', async () => {
    const { service, badCaseFlywheel } = createService();
    const prefetchedFastPath = {
      retrieval: { chunks: [], diagnostics: {}, profile: {} },
      obsidianHits: [],
      badCaseMatches: [
        {
          id: 'feedback-1',
          query: '原始问题',
          text: '正确处理标准：复用已有纠正证据。',
          score: 0.95,
          mode: 'correction',
        },
      ],
    } as unknown as PrefetchedFastPath;

    const result = await service.prepareQueriesNode(
      {
        query: '原始问题',
        augmentedQueries: ['原始问题'],
        subQuestions: [],
      } as unknown as AgenticRagStateType,
      {
        configurable: {
          userId: 'user-1',
          prefetchedFastPath,
          subQuestionLimit: 1,
        },
      },
    );

    expect(badCaseFlywheel.retrieveMatches).not.toHaveBeenCalled();
    expect(
      (result as unknown as { badCaseMatches?: unknown[] }).badCaseMatches,
    ).toBe(prefetchedFastPath.badCaseMatches);
  });

  it('does not reject a sufficient original evidence bundle after planning one subquestion', async () => {
    const { service } = createService();
    const evidence = chunk('c1', 0.9);

    const result = await service.sufficiencyNode(
      {
        query: '资料库当中，帮我总结李逵',
        retrievedChunks: [evidence],
        subQuestions: [
          {
            id: 'subq-1',
            question: '李逵的资料总结',
            dependsOn: [],
            status: 'retrieved',
            evidenceIds: ['c1'],
            retrievalAttempts: 1,
            sufficient: false,
            reason: '',
          },
        ],
      } as unknown as AgenticRagStateType,
      {
        configurable: {
          fastPathBundle: {
            query: '资料库当中，帮我总结李逵',
            chunks: [evidence],
            sourcePolicy: 'local_only',
            assessment: {
              sufficient: true,
              reason: '重排语义相关度通过阈值',
              evaluatedQuery: '资料库当中，帮我总结李逵',
            },
          },
        },
      },
    );

    expect(result).toMatchObject({ retrievalSufficient: true });
  });

  it('blocks reflection when the answer contract is invalid', async () => {
    const { service, getModelMock } = createService();
    const result = await service.reflectionNode({
      query: '原始问题',
      answer: '没有可验证引用的答案',
      retrievedChunks: [chunk('c1', 0.9)],
      retrievalSufficient: true,
      retryCount: 0,
      artifacts: [
        {
          id: 'answer_contract:test',
          type: 'answer_contract',
          version: 1,
          producer: 'generate',
          createdAt: new Date().toISOString(),
          payload: {
            answer: '没有可验证引用的答案',
            citationSupported: false,
            subQuestionCoverage: 0,
            valid: false,
            reason: '答案缺少显式片段引用',
          },
        },
      ],
    } as unknown as AgenticRagStateType);

    expect(result).toMatchObject({
      confidence: 0,
      passed: false,
      retryCount: 1,
    });
    expect(result.reflectionFeedback).toContain('答案契约校验未通过');
    expect(result.retryTarget).toBe('generate');
    expect(getModelMock).not.toHaveBeenCalled();
  });
});

describe('Agentic retrieval fingerprint and source policy', () => {
  it('keeps evidence partial after a citation-valid answer', async () => {
    const { service, agentLoop } = createService();
    agentLoop.run.mockResolvedValue({
      status: 'completed',
      output: {
        answer: '9 月资料有依据 [片段1]；10 月资料不足。',
        citationGate: { sufficient: true, reason: '引用有效' },
      },
    });
    const state = {
      query: '比较 9 月和 10 月活动规则',
      retrievedChunks: [chunk('september', 0.8)],
      retrievalSufficient: false,
      retrievalReason: '缺少 10 月活动规则',
      subQuestions: [
        {
          id: 'september',
          question: '9 月活动规则',
          sufficient: true,
          evidenceIds: ['september'],
        },
        {
          id: 'october',
          question: '10 月活动规则',
          sufficient: false,
          evidenceIds: [],
        },
      ],
      badCaseMatches: [],
      artifacts: [],
    } as AgenticRagStateType;

    const result = await service.generateNode(state, {
      configurable: {
        retrieveOptions: {
          queryPlan: { subQueries: ['9 月活动规则', '10 月活动规则'] },
        },
      },
    });

    expect(result).toMatchObject({
      retrievalSufficient: false,
      retrievalReason: '缺少 10 月活动规则',
    });
  });

  it('does not cite unrelated candidates when no sub-question is covered', async () => {
    const { service, agentLoop } = createService();
    const state = {
      query: '比较 9 月和 10 月活动规则',
      retrievedChunks: [chunk('unrelated', 0.9)],
      retrievalSufficient: false,
      retrievalReason: '两个月份都缺少规则证据',
      subQuestions: [
        {
          id: 'september',
          question: '9 月活动规则',
          sufficient: false,
          evidenceIds: [],
        },
        {
          id: 'october',
          question: '10 月活动规则',
          sufficient: false,
          evidenceIds: [],
        },
      ],
      badCaseMatches: [],
      artifacts: [],
    } as AgenticRagStateType;

    const result = await service.generateNode(state, {
      configurable: {
        retrieveOptions: {
          queryPlan: { subQueries: ['9 月活动规则', '10 月活动规则'] },
        },
      },
    });

    expect(agentLoop.run).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      retrievedChunks: [],
      retrievalSufficient: false,
    });
  });

  const singleQueryPlan = {
    planVersion: 2 as const,
    sourcePolicy: 'local_only' as const,
    queries: [{ text: '同一问题', kind: 'original' as const, weight: 1 }],
    profile: {
      intent: 'lookup' as const,
      candidateDepth: 8,
      finalTopK: 4,
      neighborWindow: 0,
      sameSectionLimit: 0,
      contextCharacterBudget: 3500,
      maxChunksPerDocument: 2,
    },
    useGraph: false,
    scopeRestricted: false,
    reasonCode: 'internal_evidence_required' as const,
  };

  it('does not repeat an empty retrieval on retry without a new query or strategy', async () => {
    const { service, ragService } = createService();
    const retrieve = serviceMock(ragService, 'retrieve');
    retrieve.mockResolvedValue([]);
    const state = {
      query: '同一问题',
      augmentedQueries: [],
      subQuestions: [
        {
          id: 'subq-1',
          question: '同一问题',
          dependsOn: [],
          status: 'planned',
          evidenceIds: [],
          retrievalAttempts: 0,
          sufficient: false,
          reason: '',
        },
      ],
      retrievedChunks: [],
      retrievalFingerprints: [],
      retrievalStatus: 'not_executed',
      retryCount: 0,
      webSearchAttempted: false,
      webSearchCount: 0,
      artifacts: [],
    } as unknown as AgenticRagStateType;
    const retrieveOptions = { executionPlan: singleQueryPlan };
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const config = {
      configurable: {
        userId: 'user-1',
        retrieveOptions,
        onEvent: (event: { type: string; data: Record<string, unknown> }) =>
          events.push(event),
      },
    };

    const first = await service.retrievalNode(state, config);
    const second = await service.retrievalNode(
      { ...state, ...first, retryCount: 1 },
      config,
    );
    const third = await service.retrievalNode(
      { ...state, ...first, ...second, retryCount: 2 },
      config,
    );

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(second.retrievalReasonCode).toBe('duplicate_retrieval_skipped');
    expect(third.retrievalReasonCode).toBe('duplicate_retrieval_skipped');
    expect(events.at(-2)).toMatchObject({
      type: 'retrieval',
      data: {
        duplicateRetrievalSkipped: true,
        stoppedReason: 'same_retrieval_fingerprint_without_new_evidence',
      },
    });
  });

  it('runs a new targeted query and keeps prefetched evidence', async () => {
    const { service, ragService } = createService();
    const retrieve = serviceMock(ragService, 'retrieve');
    const previous = chunk('prefetched', 0.8);
    const added = chunk('targeted-october', 0.9);
    retrieve.mockResolvedValue([added]);
    const retrieveOptions = { executionPlan: singleQueryPlan };
    const prefetchedFastPath = {
      retrieval: { chunks: [previous], diagnostics: {}, profile: {} },
      obsidianHits: [],
      retrievalAttempted: true,
      retrievalFingerprints: retrievalFingerprintsForPlan(
        '同一问题',
        'user-1',
        retrieveOptions,
        singleQueryPlan,
      ),
    } as unknown as PrefetchedFastPath;
    const state = {
      query: '同一问题',
      augmentedQueries: [],
      subQuestions: [
        {
          id: 'subq-1',
          question: '同一问题',
          dependsOn: [],
          status: 'needs_more',
          evidenceIds: ['prefetched'],
          retrievalAttempts: 1,
          sufficient: false,
          reason: '缺少某一维度',
        },
        {
          id: 'subq-2',
          question: '10 月规则',
          dependsOn: ['subq-1'],
          status: 'needs_more',
          evidenceIds: [],
          retrievalAttempts: 0,
          sufficient: false,
          reason: '',
        },
      ],
      retrievedChunks: [previous],
      retrievalFingerprints: prefetchedFastPath.retrievalFingerprints,
      retrievalStatus: 'hit',
      retryCount: 1,
      webSearchAttempted: false,
      webSearchCount: 0,
      artifacts: [],
    } as unknown as AgenticRagStateType;

    const result = await service.retrievalNode(state, {
      configurable: {
        userId: 'user-1',
        retrieveOptions,
        prefetchedFastPath,
        fastPathChunks: [previous],
      },
    });

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledWith(
      '同一问题',
      expect.objectContaining({
        executionPlan: {
          ...singleQueryPlan,
          queries: [{ text: '10 月规则', kind: 'sub_query', weight: 1 }],
        },
        rankingQuery: '同一问题',
        skipRerank: true,
      }),
      'user-1',
    );
    expect(result.retrievedChunks?.map((item) => item.id)).toEqual(
      expect.arrayContaining(['prefetched', 'targeted-october']),
    );
  });

  it('does not reuse prefetched chunks across a user identity change', async () => {
    const { service, ragService } = createService();
    const retrieve = serviceMock(ragService, 'retrieve');
    const fresh = chunk('current-user-evidence', 0.9);
    const stale = chunk('other-user-evidence', 0.95);
    retrieve.mockResolvedValue([fresh]);
    const retrieveOptions = { executionPlan: singleQueryPlan };
    const prefetchedFastPath = {
      retrieval: { chunks: [stale], diagnostics: {}, profile: {} },
      obsidianHits: [],
      badCaseMatches: [],
      retrievalAttempted: true,
      retrievalFingerprints: retrievalFingerprintsForPlan(
        '同一问题',
        'user-a',
        retrieveOptions,
        singleQueryPlan,
      ),
    } as unknown as PrefetchedFastPath;
    const state = {
      query: '同一问题',
      augmentedQueries: [],
      subQuestions: [],
      retrievedChunks: [],
      retryCount: 0,
      webSearchAttempted: false,
      webSearchCount: 0,
      artifacts: [],
    } as AgenticRagStateType;

    const result = await service.retrievalNode(state, {
      configurable: {
        userId: 'user-b',
        retrieveOptions,
        prefetchedFastPath,
        fastPathChunks: [stale],
      },
    });

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(result.retrievedChunks?.map((item) => item.id)).toContain(
      'current-user-evidence',
    );
    expect(result.retrievedChunks?.map((item) => item.id)).not.toContain(
      'other-user-evidence',
    );
  });

  it('reports retrieval source failures separately from an empty result', async () => {
    const { service, ragService } = createService();
    serviceMock(ragService, 'retrieve').mockRejectedValue(
      new Error('backend internal detail'),
    );
    const state = {
      query: '本地资料查询',
      augmentedQueries: [],
      subQuestions: [],
      retrievedChunks: [],
      retryCount: 0,
      webSearchAttempted: false,
      webSearchCount: 0,
      artifacts: [],
    } as unknown as AgenticRagStateType;
    const retrieveOptions = { executionPlan: singleQueryPlan };
    const result = await service.retrievalNode(state, {
      configurable: { userId: 'user-1', retrieveOptions },
    });
    const sufficiency = await service.sufficiencyNode(
      { ...state, ...result },
      { configurable: { userId: 'user-1', retrieveOptions } },
    );

    expect(result).toMatchObject({
      retrievalStatus: 'source_error',
      retrievalReasonCode: 'source_failure',
    });
    expect(sufficiency.retrievalReason).toContain('证据源调用失败');
    expect(sufficiency.retrievalReason).not.toContain(
      'backend internal detail',
    );
  });

  it('blocks web fallback for local-only and scope-restricted requests', async () => {
    const { service, bochaSearchService } = createService();
    Reflect.set(
      bochaSearchService,
      'isEnabled',
      jest.fn().mockReturnValue(true),
    );
    const searchMock = Reflect.get(bochaSearchService, 'search') as jest.Mock;

    await service.webSearchFallbackNode(
      {
        query: '内部资料问题',
        retrievalSufficient: false,
        webSearchAttempted: false,
      } as AgenticRagStateType,
      {
        configurable: {
          retrieveOptions: {
            sourcePolicy: 'local_only',
            executionPlan: { scopeRestricted: false },
          },
        },
      },
    );
    await service.webSearchFallbackNode(
      {
        query: '受限项目规则',
        retrievalSufficient: false,
        webSearchAttempted: false,
      } as AgenticRagStateType,
      {
        configurable: {
          retrieveOptions: {
            sourcePolicy: 'web_allowed',
            executionPlan: { scopeRestricted: true },
          },
        },
      },
    );

    expect(searchMock.mock.calls).toHaveLength(0);
  });

  it('allows one bounded web search when web use is explicitly authorized', async () => {
    const { service, bochaSearchService, toolPolicy } = createService();
    Reflect.set(
      bochaSearchService,
      'isEnabled',
      jest.fn().mockReturnValue(true),
    );
    Reflect.set(
      toolPolicy,
      'decide',
      jest.fn().mockReturnValue({
        allowed: true,
        entry: { timeoutMs: 1_000 },
      }),
    );
    const searchMock = Reflect.get(bochaSearchService, 'search') as jest.Mock;
    const result = await service.webSearchFallbackNode(
      {
        query: '公开发布说明',
        augmentedQueries: [],
        retrievalSufficient: false,
        webSearchAttempted: false,
        webSearchCount: 0,
      } as AgenticRagStateType,
      {
        configurable: {
          retrieveOptions: {
            sourcePolicy: 'web_allowed',
            executionPlan: {
              sourcePolicy: 'web_allowed',
              scopeRestricted: false,
            },
          },
        },
      },
    );

    expect(searchMock.mock.calls).toHaveLength(1);
    expect(result.webSearchAttempted).toBe(true);
  });
});
