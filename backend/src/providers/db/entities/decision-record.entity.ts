import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('decision_records')
@Index('IDX_decision_records_thread_created', ['threadId', 'createdAt'])
export class DecisionRecordEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Index('IDX_decision_records_tenant')
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  tenantId!: string | null;
  @Column({ type: 'varchar', length: 64 }) threadId!: string;
  @Column({ type: 'varchar', length: 128, nullable: true, default: null })
  projectId!: string | null;
  @Column({ type: 'varchar', length: 256 }) title!: string;
  @Column({ type: 'varchar', length: 32, default: 'draft' }) status!: string;
  @Column({ type: 'text', default: '[]' }) conflicts!: string;
  @Column({ type: 'text', default: '[]' }) options!: string;
  @Column({ type: 'text', default: '{}' }) decision!: string;
  @Column({ type: 'text', default: '' }) rationale!: string;
  @Column({ type: 'text', default: '[]' }) sourceArtifactIds!: string;
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  createdBy!: string | null;
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  approvedBy!: string | null;
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}
