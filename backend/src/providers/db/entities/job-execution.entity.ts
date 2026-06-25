import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 定时任务执行历史
 * 每次任务执行记录一条，用于后台追踪和回放。
 */
@Entity('job_executions')
@Index(['jobId', 'startedAt'])
export class JobExecutionEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  jobId!: string;

  /** 'completed' | 'failed' | 'running' */
  @Column({ type: 'varchar', length: 16, default: 'running' })
  status!: string;

  /** 执行结果摘要 */
  @Column({ type: 'text', nullable: true, default: null })
  result!: string | null;

  /** 失败时的错误信息 */
  @Column({ type: 'text', nullable: true, default: null })
  errorMessage!: string | null;

  /** 执行耗时（毫秒） */
  @Column({ type: 'integer', nullable: true, default: null })
  durationMs!: number | null;

  @Column({ type: 'timestamp' })
  startedAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
