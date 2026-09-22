import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('document_tasks')
@Index('IDX_document_tasks_user_status', ['userId', 'status'])
@Index('IDX_document_tasks_doc', ['docId'])
export class DocumentTaskEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Index('IDX_document_tasks_tenant')
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  tenantId!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  docId!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  userId!: string | null;

  @Column({ type: 'varchar', length: 512 })
  filename!: string;

  @Column({ type: 'varchar', length: 32, default: 'queued' })
  status!: 'queued' | 'processing' | 'completed' | 'failed';

  @Column({ type: 'varchar', length: 64, default: 'queued' })
  stage!: string;

  @Column({ type: 'int', default: 0 })
  progress!: number;

  @Column({ type: 'text', nullable: true, default: null })
  errorMessage!: string | null;

  @Column({ type: 'int', nullable: true, default: null })
  chunkCount!: number | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  startedAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  finishedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
