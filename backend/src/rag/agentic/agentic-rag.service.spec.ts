import { ConfigService } from '@nestjs/config';
import { AgenticRagService } from './agentic-rag.service';
import type { LlmProvider } from '../../providers/llm/llm.provider';
import type { KarpathyRagService } from '../karpathy/karpathy-rag.service';
import type { BochaSearchService } from '../../tools/bocha-search.service';
import type { DashScopeRerankService } from '../../tools/dashscope-rerank.service';
import type { SemanticExampleSelector } from '../prompts/semantic-example.selector';
import type { RedisProvider } from '../../providers/redis/redis.provider';
import type { AgenticRagStateType } from './agentic-rag.state';

describe('AgenticRagService budget boundaries', () => {
  function createService(overrides: Record<string, unknown> = {}) {
    const config = {
      get: jest.fn((key: string) => {
        const defaults: Record<string, unknown> = {
          'agentic.confidenceThreshold': 0.7,
          'agentic.maxRetries': 1,
          'agentic.maxAugmentedQueries': 2,
          'agentic.maxRetrievalQueries': 2,
          'agentic.maxSubQuestions': 2,
          'agentic.maxRetrievedChunks': 2,
          'agentic.maxWebSearchResults': 1,
          'agentic.maxRerankTopN': 2,
          'agentic.maxAutoQueryLength': 20,
          'agentic.webSearchFallbackEnabled': true,
          'agentic.rerankEnabled': true,
        };
        return key in overrides ? overrides[key] : defaults[key];
      }),
    } as unknown as ConfigService;

    const getModelMock = jest.fn();
    const llmProvider = {
      getModel: getModelMock,
    } as unknown as LlmProvider;
    const karpathyRagService = {
      answerDirect: jest.fn().mockResolvedValue(null),
      assessFastPath: jest.fn(),
      answer: jest.fn(),
      formatObsidianContext: jest.fn().mockReturnValue(''),
      retrieve: jest.fn(),
      retrieveBm25Only: jest.fn(),
      getObsidianContext: jest
        .fn()
        .mockResolvedValue({ hits: [], context: '' }),
      toReviewedEvidenceChunks: jest.fn().mockReturnValue([]),
      toObsidianChunks: jest.fn().mockReturnValue([]),
      hasIndexedChunks: jest.fn().mockReturnValue(true),
      unsupportedReliableAnswer: jest
        .fn()
        .mockReturnValue('知识库片段不足以支撑可靠回答，暂不生成确定结论。'),
    } as unknown as jest.Mocked<KarpathyRagService>;
    const bochaSearchService = {
      isEnabled: jest.fn().mockReturnValue(false),
    } as unknown as BochaSearchService;
    const dashScopeRerankService = {
      isEnabled: jest.fn().mockReturnValue(false),
    } as unknown as DashScopeRerankService;
    const toolPolicy = { decide: jest.fn().mockReturnValue({ allowed: true }) };
    const semanticExampleSelector = {} as SemanticExampleSelector;
    const badCaseFlywheel = {
      selectPrompt: jest.fn().mockResolvedValue(''),
    };
    const metricsService = {
      observeAgentNode: jest.fn(),
      observeAgentFirstToken: jest.fn(),
      observeAgentToolCall: jest.fn(),
      observeAgentLoopDecision: jest.fn(),
      observeAgentEmptyRetrieval: jest.fn(),
    };
    const tracingService = {
      recordAgentNode: jest.fn().mockReturnValue({}),
    };
    const redisProvider = {} as RedisProvider;

    const service = new AgenticRagService(
      config,
      llmProvider,
      karpathyRagService,
      bochaSearchService,
      dashScopeRerankService,
      toolPolicy,
      semanticExampleSelector,
      badCaseFlywheel as never,
      metricsService as never,
      tracingService as never,
      redisProvider,
    );

    return { service, karpathyRagService, llmProvider, getModelMock };
  }

  it('caps normalized augmented queries', () => {
    const { service } = createService();

    const result = (
      service as unknown as {
        normalizeQueries(original: string, list: unknown): string[];
      }
    ).normalizeQueries('原始问题', ['问题 A', '问题 B', '问题 C']);

    expect(result).toEqual(['原始问题', '原始问题']);
  });

  it('does not force overly long complex auto queries to simple mode', () => {
    const { service } = createService();

    const route = (
      service as unknown as {
        classifyRoute(
          query: string,
          mode: 'simple' | 'agentic' | 'auto',
        ): 'simple' | 'agentic';
      }
    ).classifyRoute('请分析'.repeat(40), 'auto');

    expect(route).toBe('agentic');
  });

  it('upgrades complex auto queries even when the fast path has evidence', () => {
    const { service } = createService({ 'agentic.maxAutoQueryLength': 500 });

    const route = (
      service as unknown as {
        resolveAutoRoute(
          query: string,
          fastPathSufficient: boolean,
        ): 'simple' | 'agentic';
      }
    ).resolveAutoRoute('请对比周年庆活动在不同地区的玩法差异和上线风险', true);

    expect(route).toBe('agentic');
  });

  it('keeps simple auto queries on the fast path when evidence is sufficient', () => {
    const { service } = createService({ 'agentic.maxAutoQueryLength': 500 });

    const route = (
      service as unknown as {
        resolveAutoRoute(
          query: string,
          fastPathSufficient: boolean,
        ): 'simple' | 'agentic';
      }
    ).resolveAutoRoute('ACT100 的状态是什么？', true);

    expect(route).toBe('simple');
  });

  it('keeps an explicitly selected agentic request on the state machine', async () => {
    const { service, karpathyRagService } = createService();
    const invoke = jest.fn().mockResolvedValue({
      answer: '已完成深度处理。',
      retrievedChunks: [],
      retrievalSufficient: true,
      retrievalReason: '状态机已完成',
      confidence: 1,
      retryCount: 0,
      subQuestions: [],
      artifacts: [],
      executionState: { remainingSteps: 1, remainingToolCalls: 1 },
    });
    (
      service as unknown as { app: { invoke: jest.Mock; getState: jest.Mock } }
    ).app = {
      invoke,
      getState: jest.fn().mockResolvedValue({ tasks: [] }),
    };

    await expect(
      service.run(
        'React 是什么？',
        'agentic',
        undefined,
        [],
        'thread-1',
        undefined,
        [],
        false,
        {
          queryIntent: {
            intent: 'objective_fact',
            contextMode: 'none',
            historyPolicy: 'context_only',
            confidence: 1,
            standaloneQuery: 'React 是什么？',
            multiIntent: false,
            subQueries: [],
            action: 'direct_answer',
            sourcePolicy: 'direct_answer',
            needsSynthesis: false,
            requiresGraph: false,
            targetKbs: ['general'],
            queryType: 'public_knowledge',
            entities: [],
            filters: {
              department: null,
              project: null,
              timeRange: null,
              documentType: null,
            },
            rewriteQueries: [],
            reason: '稳定公共事实',
            ambiguity: { detected: false, confidence: 1, senses: [] },
          },
        },
      ),
    ).resolves.toMatchObject({ route: 'agentic' });

    expect(karpathyRagService.assessFastPath).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('keeps entity chapter and nickname lookups as one evidence question', () => {
    const { service } = createService();

    const questions = (
      service as unknown as {
        buildSubQuestions(
          original: string,
          queries: string[],
          limit?: number,
        ): Array<{ question: string }>;
      }
    ).buildSubQuestions(
      '资料库里面的陈达出现在第几章节，他的花名叫什么',
      ['陈达第几回出场', '陈达的花名是什么'],
      2,
    );

    expect(questions).toHaveLength(1);
    expect(questions[0].question).toBe(
      '资料库里面的陈达出现在第几章节，他的花名叫什么',
    );
  });

  it('marks semantic multi-question input as ineligible for a single-question direct answer', () => {
    const { service } = createService();

    expect(
      (
        service as unknown as {
          isMultiIntentQuery(intent: {
            multiIntent: boolean;
            subQueries: string[];
          }): boolean;
        }
      ).isMultiIntentQuery({
        multiIntent: true,
        subQueries: ['React 是什么？', '1+1 等于多少？'],
      }),
    ).toBe(true);
  });

  it('keeps explicit multi-question boundaries as independent retrieval units', () => {
    const { service } = createService();

    expect(
      (
        service as unknown as {
          buildExplicitSubQuestions(
            questions: string[],
          ): Array<{ question: string }>;
        }
      ).buildExplicitSubQuestions(['React 是什么？', '1+1 等于多少？']),
    ).toEqual([
      expect.objectContaining({ question: 'React 是什么？' }),
      expect.objectContaining({ question: '1+1 等于多少？' }),
    ]);
  });

  it('uses the Hybrid Fast Path as Auto direct-answer evidence instead of a second direct lookup', async () => {
    const { service, karpathyRagService } = createService();
    const prefetchedFastPath = {
      retrieval: { chunks: [], diagnostics: {}, profile: {} },
      obsidianHits: [],
    } as never;
    karpathyRagService.assessFastPath.mockResolvedValue({
      sufficient: true,
      reason: '结构化状态证据充分',
      chunks: [],
      obsidianHits: [],
      prefetchedFastPath,
    });
    karpathyRagService.answer.mockResolvedValue({
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
    expect(karpathyRagService.answerDirect).not.toHaveBeenCalled();
    expect(karpathyRagService.assessFastPath).toHaveBeenCalledTimes(1);
    expect(karpathyRagService.answer).toHaveBeenCalledWith(
      'ACT100 的状态是什么？',
      [],
      undefined,
      [],
      expect.any(Function),
      expect.objectContaining({ prefetchedFastPath }),
    );
  });

  it('reuses a sufficient Base Case Fast Path result in Auto simple route', async () => {
    const { service, karpathyRagService } = createService();
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
    karpathyRagService.assessFastPath.mockResolvedValue({
      sufficient: true,
      reason: 'Base Case 证据充分',
      chunks: [reviewedChunk],
      obsidianHits: [],
      prefetchedFastPath,
    });
    karpathyRagService.answer.mockResolvedValue({
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
    expect(karpathyRagService.answer.mock.calls[0]).toEqual([
      '韦水春是谁',
      [],
      undefined,
      [],
      expect.any(Function),
      expect.objectContaining({ prefetchedFastPath }),
    ]);
  });

  it('caps retrieval query count and returned chunks', async () => {
    const { service, karpathyRagService } = createService();
    karpathyRagService.retrieve.mockResolvedValue([
      chunk('c1', 0.9),
      chunk('c2', 0.8),
    ]);
    karpathyRagService.retrieveBm25Only.mockResolvedValue([
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

    expect(karpathyRagService.retrieve.mock.calls).toHaveLength(2);
    expect(karpathyRagService.retrieveBm25Only.mock.calls).toHaveLength(0);
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
    const { service, karpathyRagService } = createService();
    const reviewed = chunk('reviewed', 0.96);
    const obsidian = chunk('obsidian', 0.82);
    karpathyRagService.retrieve.mockResolvedValue([chunk('formal', 0.9)]);
    karpathyRagService.toReviewedEvidenceChunks.mockReturnValue([reviewed]);
    karpathyRagService.getObsidianContext.mockResolvedValue({
      hits: [{ path: 'notes/rag.md' }],
      context: 'Obsidian context',
    });
    karpathyRagService.toObsidianChunks.mockReturnValue([obsidian]);

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

    expect(karpathyRagService.getObsidianContext).toHaveBeenCalledWith(
      '请分析活动方案风险',
      'user-1',
      undefined,
    );
    expect(karpathyRagService.toObsidianChunks).toHaveBeenCalledWith([
      { path: 'notes/rag.md' },
    ]);
    expect(result.retrievedChunks?.map((item) => item.id)).toEqual(
      expect.arrayContaining(['reviewed', 'formal']),
    );
  });

  it('reuses fast-path evidence when agentic retrieval starts', async () => {
    const { service, karpathyRagService } = createService();
    karpathyRagService.retrieve.mockResolvedValue([chunk('c2', 0.8)]);

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
          subQuestionLimit: 2,
        },
      },
    );

    expect(karpathyRagService.retrieve.mock.calls).toHaveLength(1);
    expect(result.retrievedChunks?.map((item) => item.id)).toEqual([
      'c1',
      'c2',
    ]);
  });

  it('does not reject a sufficient original evidence bundle after planning one subquestion', async () => {
    const { service, karpathyRagService } = createService();
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
    } as AgenticRagStateType);

    expect(result).toMatchObject({
      confidence: 0,
      passed: false,
      retryCount: 1,
    });
    expect(getModelMock).not.toHaveBeenCalled();
  });

  function chunk(id: string, totalScore: number) {
    return {
      id,
      docId: `doc-${id}`,
      chunkIndex: 1,
      content: `content ${id}`,
      bm25Score: totalScore,
      cosineScore: 0,
      totalScore,
    };
  }
});
