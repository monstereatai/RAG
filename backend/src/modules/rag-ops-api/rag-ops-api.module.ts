import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RagOpsApiController } from './rag-ops-api.controller';
import { RagOpsApiService } from './rag-ops-api.service';
import { QueryLogService } from './query-log.service';
import { DocumentModule } from '../document/document.module';
import { GraphModule } from '../graph/graph.module';
import { ChatModule } from '../chat/chat.module';
import { KarpathyRagModule } from '../../rag/karpathy/karpathy-rag.module';
import { DocumentChunkEntity } from '../../providers/db/entities/document-chunk.entity';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { FactConflictEntity } from '../../providers/db/entities/fact-conflict.entity';
import { QueryLogEntity } from '../../providers/db/entities/query-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DocumentChunkEntity,
      DocumentMetaEntity,
      FactConflictEntity,
      QueryLogEntity,
    ]),
    DocumentModule,
    GraphModule,
    ChatModule,
    KarpathyRagModule,
  ],
  controllers: [RagOpsApiController],
  providers: [RagOpsApiService, QueryLogService],
  exports: [QueryLogService],
})
export class RagOpsApiModule {}
