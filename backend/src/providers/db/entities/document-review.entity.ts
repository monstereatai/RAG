import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/** 文档审核审计：与知识生命周期、版本关系解耦。 */
@Entity('document_reviews')
@Index('IDX_document_reviews_doc_created', ['docId', 'createdAt'])
export class DocumentReviewEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;
  @Index('IDX_document_reviews_tenant')
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  tenantId!: string | null;

  @Column({ type: 'varchar', length: 64 })
  docId!: string;

  @Column({ type: 'varchar', length: 24 })
  action!: 'submitted' | 'approved' | 'rejected';

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  operatorId!: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  comment!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
