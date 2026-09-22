import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RagAdminController } from './rag-admin.controller';
import { RagAdminService } from './rag-admin.service';
import { QueryLogService } from './query-log.service';
import { DocumentModule } from '../document/document.module';
import { GraphModule } from '../graph/graph.module';
import { ChatModule } from '../chat/chat.module';
import { KarpathyRagModule } from '../../rag/karpathy/karpathy-rag.module';
import { VectorStoreModule } from '../../providers/vector-store/vector-store.module';
import { ImageIndexModule } from '../image-index/image-index.module';
import { ObsidianKnowledgeModule } from '../obsidian/obsidian-knowledge.module';
import { DocumentChunkEntity } from '../../providers/db/entities/document-chunk.entity';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { FactConflictEntity } from '../../providers/db/entities/fact-conflict.entity';
import { QueryLogEntity } from '../../providers/db/entities/query-log.entity';
import { DocumentReviewEntity } from '../../providers/db/entities/document-review.entity';
import { DocumentPermissionEntity } from '../../providers/db/entities/document-permission.entity';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { MemoryModule } from '../memory/memory.module';
import { IndexRepairQueueService } from './index-repair-queue.service';
import { IndexReconcilerService } from './index-reconciler.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DocumentChunkEntity,
      DocumentMetaEntity,
      FactConflictEntity,
      QueryLogEntity,
      DocumentReviewEntity,
      DocumentPermissionEntity,
    ]),
    DocumentModule,
    GraphModule,
    ChatModule,
    KarpathyRagModule,
    VectorStoreModule,
    ImageIndexModule,
    ObsidianKnowledgeModule,
    DomainEventsModule,
    MemoryModule,
  ],
  controllers: [RagAdminController],
  providers: [
    RagAdminService,
    QueryLogService,
    IndexRepairQueueService,
    IndexReconcilerService,
  ],
  exports: [QueryLogService],
})
export class RagAdminModule {}
