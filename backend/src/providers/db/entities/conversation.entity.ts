import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * 对话会话表
 * 每次新对话生成一个 thread_id，用于 LangGraph checkpointer 和对话历史关联。
 */
@Entity('conversations')
export class ConversationEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Index('IDX_conversations_tenant')
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  tenantId!: string | null;

  /** 关联用户（可选，单租户时为空） */
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  userId!: string | null;

  /** 会话标题（取自首条用户消息前 50 字） */
  @Column({ type: 'varchar', length: 100, default: '' })
  title!: string;

  /** 使用的 RAG 模式 */
  @Column({ type: 'varchar', length: 16, default: 'auto' })
  mode!: string;

  /** 被压缩的早期会话摘要；Redis 丢失时用于恢复上下文。 */
  @Column({ type: 'text', nullable: true, default: null })
  contextSummary!: string | null;

  /** 摘要结构版本，便于后续安全升级格式。 */
  @Column({ type: 'int', default: 0 })
  contextSummaryVersion!: number;

  /** 最近一次持久化摘要的时间。 */
  @Column({ type: 'timestamp', nullable: true, default: null })
  contextSummaryUpdatedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
