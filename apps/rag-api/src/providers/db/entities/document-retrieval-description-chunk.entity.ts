import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('document_retrieval_description_chunks')
@Index('IDX_document_retrieval_description_chunks_source', ['sourceChunkId'])
export class DocumentRetrievalDescriptionChunkEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  descriptionId!: string;

  @PrimaryColumn({ type: 'varchar', length: 64 })
  sourceChunkId!: string;
}
