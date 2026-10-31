import type { AgenticRagStateType } from './agentic-rag.state';
import type { ObsidianSearchHit } from '../../modules/obsidian/obsidian-knowledge.service';
import type { PrefetchedFastPath } from '../contracts/rag-types';
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
    expect(
      ragService.retrieve.mock.calls[0]?.[1]?.executionPlan?.queries?.map(
        (item: { text: string }) => item.text,
      ) ?? [],
    ).toEqual(['请分析差旅制度']);
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
    expect(getModelMock).not.toHaveBeenCalled();
  });
});
