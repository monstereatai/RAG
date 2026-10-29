import { ConfigService } from '@nestjs/config';
import type { EmbeddingProvider } from '../providers/embedding/embedding.provider';
import type { VectorStoreProvider } from '../providers/vector-store/vector-store.provider';
import type { LlmProvider } from '../providers/llm/llm.provider';
import type { ElasticsearchProvider } from '../providers/elasticsearch/elasticsearch.provider';
import type { MetricsService } from '../modules/metrics/metrics.service';
import type { ObsidianKnowledgeService } from '../modules/obsidian/obsidian-knowledge.service';
import type { BadCaseFlywheelService } from './prompts/bad-case-flywheel.service';
import type { DocumentPermissionService } from '../modules/document/document-permission.service';
import type { DocumentRetrievalDescriptionService } from '../modules/document/document-retrieval-description.service';
import type { GraphService } from '../modules/graph/graph.service';
import type { ImageIndexService } from '../modules/image-index/image-index.service';
import type { DingTalkProvider } from '../providers/notify/dingtalk.provider';
import type { DashScopeRerankService } from '../tools/dashscope-rerank.service';
import type { BochaSearchService } from '../tools/bocha-search.service';
import type { ToolExecutionPolicyService } from '../tools/tool-execution-policy.service';
import { RagIndexService } from './indexing/rag-index.service';
import { RagChunkPolicyService } from './retrieval/rag-chunk-policy.service';
import { RagRetrievalService } from './retrieval/rag-retrieval.service';
import { RagEvidenceService } from './evidence/rag-evidence.service';
import { RagObsidianService } from './evidence/rag-obsidian.service';
import { RagAnswerFallbackService } from './answer/rag-answer-fallback.service';
import { RagFastPathService } from './answer/rag-fast-path.service';
import { RagDirectAnswerService } from './answer/rag-direct-answer.service';
import { RagGroundedAnswerService } from './answer/rag-grounded-answer.service';
import { RagAnswerService } from './answer/rag-answer.service';
import { RagService } from './rag.service';

export interface RagRuntimeDependencies {
  configService: ConfigService;
  embeddingProvider: EmbeddingProvider;
  vectorStoreProvider: VectorStoreProvider;
  llmProvider: LlmProvider;
  elasticsearchProvider: ElasticsearchProvider;
  metricsService: MetricsService;
  obsidianKnowledge: ObsidianKnowledgeService;
  badCaseFlywheel: BadCaseFlywheelService;
  bochaSearchService: BochaSearchService;
  toolPolicy: ToolExecutionPolicyService;
  documentPermissionService: DocumentPermissionService;
  rerankService?: DashScopeRerankService;
  graphService?: GraphService;
  imageIndexService?: ImageIndexService;
  dingTalk?: DingTalkProvider;
  retrievalDescriptionService?: DocumentRetrievalDescriptionService;
}

export interface RagRuntimeServices {
  ragService: RagService;
  indexService: RagIndexService;
  chunkPolicy: RagChunkPolicyService;
  retrievalService: RagRetrievalService;
  evidenceService: RagEvidenceService;
  obsidianService: RagObsidianService;
  fallbackService: RagAnswerFallbackService;
  fastPathService: RagFastPathService;
  directAnswerService: RagDirectAnswerService;
  groundedAnswerService: RagGroundedAnswerService;
  answerService: RagAnswerService;
}

/**
 * Constructs the RAG component graph for tests, smoke scripts and non-Nest
 * callers. Nest production wiring lives in RagModule.
 */
export function createRagRuntime(
  deps: RagRuntimeDependencies,
): RagRuntimeServices {
  const indexService = new RagIndexService(deps.configService);
  const chunkPolicy = new RagChunkPolicyService(
    deps.configService,
    indexService,
    deps.rerankService,
  );
  const retrievalService = new RagRetrievalService(
    deps.configService,
    deps.embeddingProvider,
    deps.vectorStoreProvider,
    deps.elasticsearchProvider,
    deps.metricsService,
    deps.documentPermissionService,
    indexService,
    deps.rerankService,
    deps.graphService,
    deps.imageIndexService,
    deps.dingTalk,
    deps.retrievalDescriptionService,
    chunkPolicy,
  );
  const evidenceService = new RagEvidenceService(
    deps.configService,
    deps.llmProvider,
    deps.badCaseFlywheel,
    indexService,
    retrievalService,
  );
  const obsidianService = new RagObsidianService(
    deps.obsidianKnowledge,
    deps.documentPermissionService,
    indexService,
    retrievalService,
  );
  const fallbackService = new RagAnswerFallbackService(
    deps.configService,
    deps.llmProvider,
    deps.bochaSearchService,
    deps.toolPolicy,
    evidenceService.answerGenerationService,
  );
  const fastPathService = new RagFastPathService(
    retrievalService,
    evidenceService,
    deps.obsidianKnowledge,
    obsidianService,
    deps.badCaseFlywheel,
  );
  const directAnswerService = new RagDirectAnswerService(
    deps.configService,
    deps.badCaseFlywheel,
    retrievalService,
    evidenceService,
  );
  const groundedAnswerService = new RagGroundedAnswerService(
    deps.llmProvider,
    evidenceService,
    fallbackService,
    evidenceService.answerGenerationService,
  );
  const answerService = new RagAnswerService(
    deps.configService,
    deps.llmProvider,
    deps.obsidianKnowledge,
    deps.badCaseFlywheel,
    deps.bochaSearchService,
    deps.toolPolicy,
    retrievalService,
    evidenceService,
    obsidianService,
    fallbackService,
    fastPathService,
    directAnswerService,
    groundedAnswerService,
  );
  const ragService = new RagService(
    indexService,
    retrievalService,
    evidenceService,
    obsidianService,
    answerService,
  );

  return {
    ragService,
    indexService,
    chunkPolicy,
    retrievalService,
    evidenceService,
    obsidianService,
    fallbackService,
    fastPathService,
    directAnswerService,
    groundedAnswerService,
    answerService,
  };
}
