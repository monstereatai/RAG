import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KarpathyRagService } from './karpathy-rag.service';
import { LlmModule } from '../../providers/llm/llm.module';
import { EmbeddingModule } from '../../providers/embedding/embedding.module';
import { VectorStoreModule } from '../../providers/vector-store/vector-store.module';
import { MetricsModule } from '../../modules/metrics/metrics.module';
import { ObsidianKnowledgeModule } from '../../modules/obsidian/obsidian-knowledge.module';
import { PromptModule } from '../prompts/prompt.module';
import { ToolsModule } from '../../tools/tools.module';
import { DocumentPermissionModule } from '../../modules/document/document-permission.module';
import { ImageIndexModule } from '../../modules/image-index/image-index.module';
import { DocumentRetrievalDescriptionModule } from '../../modules/document/document-retrieval-description.module';

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
  ],
  providers: [KarpathyRagService],
  exports: [KarpathyRagService],
})
export class KarpathyRagModule {}
