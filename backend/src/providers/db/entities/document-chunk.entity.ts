import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('document_chunks')
@Index('IDX_document_chunks_doc_user', ['docId', 'userId'])
@Index('IDX_document_chunks_parent', ['parentChunkId'])
@Index('IDX_document_chunks_effective', ['effectiveAt', 'expiredAt'])
export class DocumentChunkEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  docId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  userId!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true, default: null })
  parentChunkId!: string | null;

  @Column({ type: 'int' })
  chunkIndex!: number;

  @Column({ type: 'varchar', length: 32, default: 'leaf' })
  chunkType!: 'parent' | 'leaf';

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'varchar', length: 512, nullable: true, default: null })
  headingPath!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true, default: null })
  sectionId!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true, default: null })
  clauseId!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true, default: null })
  tableRef!: string | null;

  @Column({ type: 'int', nullable: true, default: null })
  sourceStart!: number | null;

  @Column({ type: 'int', nullable: true, default: null })
  sourceEnd!: number | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  docVersion!: string | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  effectiveAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  expiredAt!: Date | null;

  @Column({ type: 'varchar', length: 32, default: 'normal' })
  sourceAuthority!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
