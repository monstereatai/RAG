import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { DocumentMetadataExtractor } from './document-metadata.extractor';
import { EmbeddingModule } from '../../providers/embedding/embedding.module';
import { VectorStoreModule } from '../../providers/vector-store/vector-store.module';
import { KarpathyRagModule } from '../../rag/karpathy/karpathy-rag.module';
import { LlmModule } from '../../providers/llm/llm.module';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentMetaEntity]),
    EmbeddingModule,
    VectorStoreModule,
    KarpathyRagModule,
    LlmModule,
  ],
  controllers: [DocumentController],
  providers: [DocumentService, DocumentMetadataExtractor],
  exports: [DocumentService],
})
export class DocumentModule {}
