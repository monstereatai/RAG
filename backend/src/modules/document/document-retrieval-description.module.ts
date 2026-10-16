import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentChunkEntity } from '../../providers/db/entities/document-chunk.entity';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { DocumentRetrievalDescriptionChunkEntity } from '../../providers/db/entities/document-retrieval-description-chunk.entity';
import { DocumentRetrievalDescriptionEntity } from '../../providers/db/entities/document-retrieval-description.entity';
import { EmbeddingModule } from '../../providers/embedding/embedding.module';
import { VectorStoreModule } from '../../providers/vector-store/vector-store.module';
import { DocumentRetrievalDescriptionService } from './document-retrieval-description.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DocumentMetaEntity,
      DocumentChunkEntity,
      DocumentRetrievalDescriptionEntity,
      DocumentRetrievalDescriptionChunkEntity,
    ]),
    EmbeddingModule,
    VectorStoreModule,
  ],
  providers: [DocumentRetrievalDescriptionService],
  exports: [DocumentRetrievalDescriptionService],
})
export class DocumentRetrievalDescriptionModule {}
