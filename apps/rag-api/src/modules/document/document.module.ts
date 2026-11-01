import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { DocumentMetadataExtractor } from './document-metadata.extractor';
import { DocumentRetrievalDescriptionModule } from './document-retrieval-description.module';
import { DocumentQueueService } from './document-queue.service';
import { DocumentTaskService } from './document-task.service';
import { DocumentImageIngestionService } from './document-image-ingestion.service';
import { DocumentIndexCoordinator } from './document-index-coordinator.service';
import { ObsidianIngestService } from './obsidian-ingest.service';
import { MineruCloudService } from './mineru-cloud.service';
import { EmbeddingModule } from '../../providers/embedding/embedding.module';
import { VectorStoreModule } from '../../providers/vector-store/vector-store.module';
import { RagModule } from '../../rag/rag.module';
import { LlmModule } from '../../providers/llm/llm.module';
import { ObsidianKnowledgeModule } from '../obsidian/obsidian-knowledge.module';
import { GraphModule } from '../graph/graph.module';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { DocumentChunkEntity } from '../../providers/db/entities/document-chunk.entity';
import { FactConflictEntity } from '../../providers/db/entities/fact-conflict.entity';
import { DocumentTaskEntity } from '../../providers/db/entities/document-task.entity';
import { DocumentResourceEntity } from '../../providers/db/entities/document-resource.entity';
import { DocumentPermissionEntity } from '../../providers/db/entities/document-permission.entity';
import { KnowledgeBaseProfileEntity } from '../../providers/db/entities/knowledge-base-profile.entity';
import { DocumentPermissionModule } from './document-permission.module';
import { ImageIndexModule } from '../image-index/image-index.module';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { SpeechModule } from '../../providers/speech/speech.module';
import { VisionModule } from '../../providers/vision/vision.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DocumentMetaEntity,
      DocumentChunkEntity,
      FactConflictEntity,
      DocumentTaskEntity,
      DocumentResourceEntity,
      DocumentPermissionEntity,
      KnowledgeBaseProfileEntity,
    ]),
    EmbeddingModule,
    VectorStoreModule,
    RagModule,
    LlmModule,
    ObsidianKnowledgeModule,
    GraphModule,
    DocumentPermissionModule,
    ImageIndexModule,
    DomainEventsModule,
    SpeechModule,
    VisionModule,
    DocumentRetrievalDescriptionModule,
  ],
  controllers: [DocumentController],
  providers: [
    DocumentService,
    DocumentMetadataExtractor,
    DocumentQueueService,
    DocumentTaskService,
    DocumentImageIngestionService,
    DocumentIndexCoordinator,
    ObsidianIngestService,
    MineruCloudService,
  ],
  exports: [
    DocumentService,
    DocumentQueueService,
    DocumentTaskService,
    DocumentImageIngestionService,
    ObsidianIngestService,
  ],
})
export class DocumentModule {}
