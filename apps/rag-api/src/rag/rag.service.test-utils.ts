import { ConfigService } from '@nestjs/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRagRuntime } from './rag-runtime.factory';
import type { EmbeddingProvider } from '../providers/embedding/embedding.provider';
import type { VectorStoreProvider } from '../providers/vector-store/vector-store.provider';
import type { LlmProvider } from '../providers/llm/llm.provider';
import type { ElasticsearchProvider } from '../providers/elasticsearch/elasticsearch.provider';
import type { MetricsService } from '../modules/metrics/metrics.service';
import type { ObsidianKnowledgeService } from '../modules/obsidian/obsidian-knowledge.service';
import type { BadCaseFlywheelService } from './prompts/bad-case-flywheel.service';
import type { DocumentPermissionService } from '../modules/document/document-permission.service';

const temporaryWorkspaces = new Set<string>();

afterEach(() => {
  for (const workspace of temporaryWorkspaces) {
    rmSync(workspace, { recursive: true, force: true });
  }
  temporaryWorkspaces.clear();
});

export function createService(overrides?: {
  embeddingProvider?: Partial<EmbeddingProvider>;
  vectorStoreProvider?: Partial<VectorStoreProvider>;
  graphService?: Partial<import('../modules/graph/graph.service').GraphService>;
  imageIndexService?: Partial<
    import('../modules/image-index/image-index.service').ImageIndexService
  >;
  retrievalDescriptionService?: {
    searchByVector: jest.Mock;
  };
  config?: Record<string, unknown>;
}) {
  const embeddingProvider = {
    embedQuery: jest.fn().mockResolvedValue([1, 0, 0]),
    ...overrides?.embeddingProvider,
  } as unknown as EmbeddingProvider;
  const vectorStoreSearchMock = jest.fn(
    (...args: Parameters<VectorStoreProvider['similaritySearch']>) => {
      const overrideSearch = overrides?.vectorStoreProvider?.similaritySearch;
      return overrideSearch ? overrideSearch(...args) : Promise.resolve([]);
    },
  );
  const vectorStoreProvider = {
    ...overrides?.vectorStoreProvider,
    similaritySearch: vectorStoreSearchMock,
  } as unknown as VectorStoreProvider;
  const llmInvoke = jest
    .fn<Promise<string>, [unknown]>()
    .mockResolvedValue('answer');
  const llmProvider = {
    invoke: llmInvoke,
    getActiveProviderName: jest.fn().mockReturnValue('qwen'),
    getFallbackProviderName: jest.fn().mockReturnValue(null),
    getRoutePolicy: jest.fn((task: string) => ({
      task,
      primary: 'qwen',
      fallback: null,
      timeoutMs: 60_000,
      maxTokens: 4_096,
      maxCostUsd: 0.05,
    })),
    getModel: jest.fn().mockReturnValue({
      stream: async function* (messages: unknown) {
        yield { content: await llmInvoke(messages) };
      },
    }),
  } as unknown as LlmProvider;
  const workspace = mkdtempSync(join(tmpdir(), 'rag-service-test-'));
  temporaryWorkspaces.add(workspace);
  const configService = {
    get: jest
      .fn()
      .mockImplementation((key: string) =>
        key === 'workspace.uploadDir'
          ? (overrides?.config?.[key] ?? join(workspace, 'uploads'))
          : overrides?.config?.[key],
      ),
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
  const obsidianAssessHitsMock = jest.fn().mockReturnValue({
    sufficient: false,
    reason: 'Obsidian 未命中',
  });
  const obsidianKnowledge = {
    search: jest.fn().mockResolvedValue([]),
    assessHits: obsidianAssessHitsMock,
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
    rerank: jest.fn((_query: string, chunks: unknown[]) =>
      Promise.resolve(chunks),
    ),
  };
  const retrievalDescriptionService =
    overrides?.retrievalDescriptionService ?? {
      searchByVector: jest.fn().mockResolvedValue([]),
    };

  const runtime = createRagRuntime({
    configService,
    embeddingProvider,
    vectorStoreProvider,
    llmProvider,
    elasticsearchProvider,
    metricsService,
    obsidianKnowledge,
    badCaseFlywheel,
    bochaSearchService:
      bochaSearchService as unknown as import('../tools/bocha-search.service').BochaSearchService,
    toolPolicy: toolPolicy,
    documentPermissionService:
      documentPermissionService as unknown as DocumentPermissionService,
    rerankService:
      dashscopeRerankService as unknown as import('../tools/dashscope-rerank.service').DashScopeRerankService,
    graphService: overrides?.graphService as
      | import('../modules/graph/graph.service').GraphService
      | undefined,
    imageIndexService: overrides?.imageIndexService as
      | import('../modules/image-index/image-index.service').ImageIndexService
      | undefined,
    retrievalDescriptionService:
      retrievalDescriptionService as unknown as import('../modules/document/document-retrieval-description.service').DocumentRetrievalDescriptionService,
  });
  const {
    ragService: service,
    indexService,
    answerService,
    retrievalService,
  } = runtime;
  indexService.onModuleInit();
  return {
    service,
    indexService,
    answerService,
    retrievalService,
    embeddingProvider,
    llmInvoke,
    vectorStoreProvider,
    vectorStoreSearchMock,
    metricsService,
    observeRetrievalHits,
    obsidianKnowledge,
    obsidianAssessHitsMock,
    documentPermissionService,
    retrieveBadCaseMatches,
    retrieveExactBadCaseMatches,
    bochaSearchService,
    dashscopeRerankService,
    retrievalDescriptionService,
  };
}
