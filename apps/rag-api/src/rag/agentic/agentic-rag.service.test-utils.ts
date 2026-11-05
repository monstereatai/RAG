import { ConfigService } from '@nestjs/config';
import { AgenticRagService } from './agentic-rag.service';
import type { LlmProvider } from '../../providers/llm/llm.provider';
import type { RagService } from '../rag.service';
import type { BochaSearchService } from '../../tools/bocha-search.service';
import type { DashScopeRerankService } from '../../tools/dashscope-rerank.service';
import type { RedisProvider } from '../../providers/redis/redis.provider';
import type { RetrievedChunk } from '../evidence/retrieval.types';
import type { EvidencePolicyService } from '../evidence/evidence-policy.service';
import type { QueryTaskType } from '../planning/query-plan';

export interface AgenticRagServiceInternals {
  rankEvidenceChunks(chunks: RetrievedChunk[]): RetrievedChunk[];
  assessRetrievedChunks(
    query: string,
    chunks: RetrievedChunk[],
    taskType?: QueryTaskType,
  ): { sufficient: boolean; reason: string };
  buildEvidenceFirstAnswer(
    query: string,
    chunks: RetrievedChunk[],
  ): string | null;
  answerGenerationService: {
    synthesizeEvidenceAnswer(
      query: string,
      chunks: RetrievedChunk[],
      signal?: AbortSignal,
    ): Promise<string | null>;
  };
}

export function createService(overrides: Record<string, unknown> = {}) {
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
  const ragService = {
    answerDirect: jest.fn().mockResolvedValue(null),
    assessFastPath: jest.fn(),
    answer: jest.fn(),
    formatObsidianContext: jest.fn().mockReturnValue(''),
    retrieve: jest.fn(),
    retrieveBm25Only: jest.fn(),
    getObsidianContext: jest.fn().mockResolvedValue({ hits: [], context: '' }),
    resolveObsidianSourceEvidence: jest.fn().mockResolvedValue({
      chunks: [],
      mappedDocIds: new Set<string>(),
      sourceNotePaths: new Set<string>(),
    }),
    toReviewedEvidenceChunks: jest.fn().mockReturnValue([]),
    toObsidianChunks: jest.fn().mockReturnValue([]),
    hasIndexedChunks: jest.fn().mockReturnValue(true),
    unsupportedReliableAnswer: jest
      .fn()
      .mockReturnValue('知识库片段不足以支撑可靠回答，暂不生成确定结论。'),
  } as unknown as jest.Mocked<RagService>;
  const bochaSearchService = {
    isEnabled: jest.fn().mockReturnValue(false),
    search: jest.fn().mockResolvedValue([]),
  } as unknown as BochaSearchService;
  const dashScopeRerankService = {
    isEnabled: jest.fn().mockReturnValue(false),
  } as unknown as DashScopeRerankService;
  const toolPolicy = { decide: jest.fn().mockReturnValue({ allowed: true }) };
  const badCaseFlywheel = {
    selectPrompt: jest.fn().mockResolvedValue(''),
    retrieveMatches: jest.fn().mockResolvedValue([]),
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
  const agentLoop = { run: jest.fn() };
  const evidencePolicy = {
    rankEvidenceChunks: jest.fn((chunks: RetrievedChunk[]) =>
      [...chunks].sort((left, right) => {
        const leftHasRerank = left.rerankScore !== undefined;
        const rightHasRerank = right.rerankScore !== undefined;
        if (leftHasRerank !== rightHasRerank) {
          return leftHasRerank ? -1 : 1;
        }
        const leftScore = left.rerankScore ?? left.totalScore;
        const rightScore = right.rerankScore ?? right.totalScore;
        return (
          rightScore - leftScore ||
          right.totalScore - left.totalScore ||
          left.id.localeCompare(right.id)
        );
      }),
    ),
    assessRetrievedChunks: jest.fn(
      (_query: string, chunks: RetrievedChunk[]) => ({
        sufficient: chunks.length > 0,
        reason: chunks.length > 0 ? '存在检索片段' : '没有检索片段',
      }),
    ),
    buildEvidenceFirstAnswer: jest.fn().mockReturnValue(null),
    selectCitedChunks: jest.fn(
      (_answer: string, chunks: RetrievedChunk[]) => chunks,
    ),
  } as unknown as EvidencePolicyService;

  const service = new AgenticRagService(
    config,
    llmProvider,
    ragService,
    ragService,
    ragService,
    ragService,
    bochaSearchService,
    dashScopeRerankService,
    toolPolicy,
    badCaseFlywheel as never,
    metricsService as never,
    tracingService as never,
    redisProvider,
    agentLoop as never,
    evidencePolicy,
  );

  return {
    service,
    ragService,
    llmProvider,
    getModelMock,
    badCaseFlywheel,
    evidencePolicy,
    bochaSearchService,
    toolPolicy,
    agentLoop,
  };
}

export function chunk(id: string, totalScore: number) {
  return {
    id,
    docId: `doc-${id}`,
    chunkIndex: 1,
    content: `content ${id}`,
    bm25Score: totalScore,
    cosineScore: 0,
    totalScore,
    score: totalScore,
  };
}

export function serviceMock<K extends keyof RagService>(
  service: jest.Mocked<RagService>,
  method: K,
): jest.Mock {
  return service[method] as unknown as jest.Mock;
}
