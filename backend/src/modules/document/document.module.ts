import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { DocumentMetadataExtractor } from './document-metadata.extractor';
import { DocumentPermissionService } from './document-permission.service';
import { DocumentQueueService } from './document-queue.service';
import { EmbeddingModule } from '../../providers/embedding/embedding.module';
import { VectorStoreModule } from '../../providers/vector-store/vector-store.module';
import { KarpathyRagModule } from '../../rag/karpathy/karpathy-rag.module';
import { LlmModule } from '../../providers/llm/llm.module';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { DocumentChunkEntity } from '../../providers/db/entities/document-chunk.entity';
import { FactConflictEntity } from '../../providers/db/entities/fact-conflict.entity';
import { DocumentTaskEntity } from '../../providers/db/entities/document-task.entity';
import { DocumentResourceEntity } from '../../providers/db/entities/document-resource.entity';
import { DocumentPermissionEntity } from '../../providers/db/entities/document-permission.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DocumentMetaEntity,
      DocumentChunkEntity,
      FactConflictEntity,
      DocumentTaskEntity,
      DocumentResourceEntity,
      DocumentPermissionEntity,
    ]),
    EmbeddingModule,
    VectorStoreModule,
    KarpathyRagModule,
    LlmModule,
  ],
  controllers: [DocumentController],
  providers: [
    DocumentService,
    DocumentMetadataExtractor,
    DocumentPermissionService,
    DocumentQueueService,
  ],
  exports: [DocumentService, DocumentPermissionService, DocumentQueueService],
})
export class DocumentModule {}
