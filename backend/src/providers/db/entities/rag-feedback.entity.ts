import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('rag_feedback')
@Index('IDX_rag_feedback_user_status', ['userId', 'status'])
@Index('IDX_rag_feedback_query_log', ['queryLogId'])
@Index('IDX_rag_feedback_created', ['createdAt'])
export class RagFeedbackEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  queryLogId!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  threadId!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  userId!: string | null;

  @Column({ type: 'varchar', length: 16 })
  feedback!: 'positive' | 'negative';

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  errorType!: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  comment!: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  correctedAnswer!: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  retrievalSnapshot!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status!: 'pending' | 'reviewed' | 'resolved' | 'ignored';

  @Column({ type: 'boolean', default: false })
  includeInRegression!: boolean;

  /** correction：独立纠正层；formal：已晋升为正式版本知识；inactive：不参与检索。 */
  @Column({ type: 'varchar', length: 16, default: 'correction' })
  knowledgeLayer!: 'correction' | 'formal' | 'inactive';

  @Column({ type: 'varchar', length: 24, default: 'not_requested' })
  promotionStatus!: 'not_requested' | 'pending' | 'promoted' | 'rejected';

  @Column({ type: 'text', nullable: true, default: null })
  promotionSource!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  promotedDocId!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  promotedBy!: string | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  promotedAt!: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  reviewedBy!: string | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  reviewedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
