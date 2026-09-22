import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 定时任务表
 * 持久化定时任务 (cron / every / at)
 */
@Entity('scheduled_jobs')
export class ScheduledJobEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;
  @Index('IDX_scheduled_jobs_tenant')
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  tenantId!: string | null;

  @Column({ type: 'varchar', length: 16 }) // 'cron' | 'every' | 'at'
  type!: string;

  @Column({ type: 'text' })
  instruction!: string;

  /** 后台展示名称；历史任务为空时回退到 instruction 摘要。 */
  @Column({ type: 'varchar', length: 128, nullable: true, default: null })
  name!: string | null;

  /** agent：历史 Supervisor 任务；analysis：运营分析定时任务。 */
  @Column({ type: 'varchar', length: 24, default: 'agent' })
  taskKind!: 'agent' | 'analysis';

  /** natural_language 或 markdown。 */
  @Column({ type: 'varchar', length: 24, default: 'natural_language' })
  sourceType!: 'natural_language' | 'markdown';

  /** 解析后且经管理员确认的数据范围、统计窗口、岗位和部门配置。 */
  @Column({ type: 'text', default: '{}' })
  analysisConfig!: string;

  /** 同一任务的版本组；旧数据为空时按任务自身 ID 兼容。 */
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  versionGroupId!: string | null;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ type: 'boolean', default: true })
  isCurrent!: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  copiedFromId!: string | null;

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
