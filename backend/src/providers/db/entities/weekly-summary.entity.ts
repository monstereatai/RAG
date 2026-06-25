import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 每周对话总结
 * 通过 LLM 按周聚合用户/租户的对话内容，生成总结报告。
 */
@Entity('weekly_summaries')
@Index(['userId', 'weekStart'])
export class WeeklySummaryEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  /** 关联用户（null 表示系统级汇总） */
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  userId!: string | null;

  /** 周起始日期（周一 00:00:00 UTC） */
  @Column({ type: 'date' })
  weekStart!: string;

  /** LLM 生成的总结内容 */
  @Column({ type: 'text' })
  summary!: string;

  /** 该周对话总数 */
  @Column({ type: 'int', default: 0 })
  conversationCount!: number;

  /** 该周消息总数 */
  @Column({ type: 'int', default: 0 })
  messageCount!: number;

  /** 总结状态：pending / completed / failed */
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: string;

  /** 失败原因（status=failed 时填写） */
  @Column({ type: 'text', nullable: true, default: null })
  errorMessage!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
