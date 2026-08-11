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

    const llmProvider = {
      getModel: jest.fn(),
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
      semanticExampleSelector,
      badCaseFlywheel as never,
      metricsService as never,
      tracingService as never,
      redisProvider,
    );

    return { service, karpathyRagService };
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
      } as AgenticRagStateType,
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
