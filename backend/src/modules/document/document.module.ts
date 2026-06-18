import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { EmbeddingModule } from '../../providers/embedding/embedding.module';
import { VectorStoreModule } from '../../providers/vector-store/vector-store.module';
import { KarpathyRagModule } from '../../rag/karpathy/karpathy-rag.module';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentMetaEntity]),
    EmbeddingModule,
    VectorStoreModule,
    KarpathyRagModule,
  ],
  controllers: [DocumentController],
  providers: [DocumentService],
  exports: [DocumentService],
})
export class DocumentModule {}
