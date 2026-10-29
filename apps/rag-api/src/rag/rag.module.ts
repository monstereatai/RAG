import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RagService } from './rag.service';
import { RagIndexService } from './indexing/rag-index.service';
import { RagRetrievalService } from './retrieval/rag-retrieval.service';
import { RagChunkPolicyService } from './retrieval/rag-chunk-policy.service';
import { RagEvidenceService } from './evidence/rag-evidence.service';
import { RagObsidianService } from './evidence/rag-obsidian.service';
import { RagAnswerService } from './answer/rag-answer.service';
import { RagAnswerFallbackService } from './answer/rag-answer-fallback.service';
import { RagFastPathService } from './answer/rag-fast-path.service';
import { RagDirectAnswerService } from './answer/rag-direct-answer.service';
import { RagGroundedAnswerService } from './answer/rag-grounded-answer.service';
import { LlmModule } from '../providers/llm/llm.module';
import { EmbeddingModule } from '../providers/embedding/embedding.module';
import { VectorStoreModule } from '../providers/vector-store/vector-store.module';
import { MetricsModule } from '../modules/metrics/metrics.module';
import { ObsidianKnowledgeModule } from '../modules/obsidian/obsidian-knowledge.module';
import { PromptModule } from './prompts/prompt.module';
import { ToolsModule } from '../tools/tools.module';
import { DocumentPermissionModule } from '../modules/document/document-permission.module';
import { ImageIndexModule } from '../modules/image-index/image-index.module';
import { DocumentRetrievalDescriptionModule } from '../modules/document/document-retrieval-description.module';
import { EvidenceModule } from './evidence/evidence.module';
import { GenerationModule } from './generation/generation.module';
import {
  AGENTIC_FAST_PATH_CAPABILITY,
  AGENTIC_RETRIEVAL_CAPABILITY,
  AGENTIC_SIMPLE_ANSWER_CAPABILITY,
  AGENTIC_SUPPORTING_EVIDENCE_CAPABILITY,
} from './contracts/agentic-rag-capabilities';
import {
  RAG_ADMIN_CAPABILITY,
  RAG_INDEX_CAPABILITY,
  RAG_QUERY_CAPABILITY,
  RAG_RETRIEVAL_CAPABILITY,
} from './contracts/rag-capabilities';

@Module({
  imports: [
    ConfigModule,
    LlmModule,
    EmbeddingModule,
    VectorStoreModule,
    MetricsModule,
    ObsidianKnowledgeModule,
    PromptModule,
    ToolsModule,
    DocumentPermissionModule,
    ImageIndexModule,
    DocumentRetrievalDescriptionModule,
    EvidenceModule,
    GenerationModule,
  ],
  providers: [
    RagService,
    RagIndexService,
    RagRetrievalService,
    RagChunkPolicyService,
    RagEvidenceService,
    RagObsidianService,
    RagAnswerService,
    RagAnswerFallbackService,
    RagFastPathService,
    RagDirectAnswerService,
    RagGroundedAnswerService,
    { provide: AGENTIC_RETRIEVAL_CAPABILITY, useExisting: RagService },
    { provide: AGENTIC_FAST_PATH_CAPABILITY, useExisting: RagFastPathService },
    {
      provide: AGENTIC_SIMPLE_ANSWER_CAPABILITY,
      useExisting: RagAnswerService,
    },
    {
      provide: AGENTIC_SUPPORTING_EVIDENCE_CAPABILITY,
      useExisting: RagService,
    },
    { provide: RAG_QUERY_CAPABILITY, useExisting: RagAnswerService },
    { provide: RAG_RETRIEVAL_CAPABILITY, useExisting: RagService },
    { provide: RAG_INDEX_CAPABILITY, useExisting: RagIndexService },
    { provide: RAG_ADMIN_CAPABILITY, useExisting: RagService },
  ],
  exports: [
    AGENTIC_RETRIEVAL_CAPABILITY,
    AGENTIC_FAST_PATH_CAPABILITY,
    AGENTIC_SIMPLE_ANSWER_CAPABILITY,
    AGENTIC_SUPPORTING_EVIDENCE_CAPABILITY,
    RAG_QUERY_CAPABILITY,
    RAG_RETRIEVAL_CAPABILITY,
    RAG_INDEX_CAPABILITY,
    RAG_ADMIN_CAPABILITY,
  ],
})
export class RagModule {}
