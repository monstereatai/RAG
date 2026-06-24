import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 定时任务表
 * 持久化定时任务 (cron / every / at)
 */
@Entity('scheduled_jobs')
export class ScheduledJobEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 16 }) // 'cron' | 'every' | 'at'
  type!: string;

  @Column({ type: 'text' })
  instruction!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'boolean', default: false })
  running!: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true })
  cron!: string | null;

  @Column({ type: 'integer', nullable: true })
  everyMs!: number | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  at!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  lastRun!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  userId!: string | null;

  /** 上次执行结果摘要 */
  @Column({ type: 'text', nullable: true, default: null })
  lastResult!: string | null;

  /** 上次执行错误信息 */
  @Column({ type: 'text', nullable: true, default: null })
  lastError!: string | null;

  /** 上次执行耗时（毫秒） */
  @Column({ type: 'integer', nullable: true, default: null })
  lastDurationMs!: number | null;

  /** 下次计划执行时间 */
  @Column({ type: 'timestamp', nullable: true, default: null })
  nextRunAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
