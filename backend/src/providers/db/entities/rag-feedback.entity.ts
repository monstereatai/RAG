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

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  reviewedBy!: string | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  reviewedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
