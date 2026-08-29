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
      retrieve: jest.fn(),
      retrieveBm25Only: jest.fn(),
      hasIndexedChunks: jest.fn().mockReturnValue(true),
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
      toolPolicy as never,
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

    expect(result).toEqual(['问题 A', '问题 B']);
  });

  it('routes overly long auto queries to simple mode', () => {
    const { service } = createService();

    const route = (
      service as unknown as {
        classifyRoute(
          query: string,
          mode: 'simple' | 'agentic' | 'auto',
        ): 'simple' | 'agentic';
      }
    ).classifyRoute('请分析'.repeat(40), 'auto');

    expect(route).toBe('simple');
  });

  it('upgrades complex auto queries even when the fast path has evidence', () => {
    const { service } = createService({ 'agentic.maxAutoQueryLength': 500 });

    const route = (
      service as unknown as {
        resolveAutoRoute(query: string, fastPathSufficient: boolean): 'simple' | 'agentic';
      }
    ).resolveAutoRoute('请对比周年庆活动在不同地区的玩法差异和上线风险', true);

    expect(route).toBe('agentic');
  });

  it('keeps simple auto queries on the fast path when evidence is sufficient', () => {
    const { service } = createService({ 'agentic.maxAutoQueryLength': 500 });

    const route = (
      service as unknown as {
        resolveAutoRoute(query: string, fastPathSufficient: boolean): 'simple' | 'agentic';
      }
    ).resolveAutoRoute('ACT100 的状态是什么？', true);

    expect(route).toBe('simple');
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
