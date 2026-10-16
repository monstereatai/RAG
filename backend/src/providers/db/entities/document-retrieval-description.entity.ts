import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('document_retrieval_descriptions')
@Index('IDX_document_retrieval_descriptions_doc', [
  'tenantId',
  'docId',
  'indexGeneration',
])
@Index('IDX_document_retrieval_descriptions_content_hash', [
  'tenantId',
  'docId',
  'descriptionType',
  'contentHash',
])
export class DocumentRetrievalDescriptionEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  tenantId!: string;

  @Column({ type: 'varchar', length: 64 })
  docId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  docVersion!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  indexGeneration!: string | null;

  @Column({ type: 'varchar', length: 64 })
  descriptionType!: string;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'varchar', length: 64 })
  contentHash!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
