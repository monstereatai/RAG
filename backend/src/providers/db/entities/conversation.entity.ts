import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * 对话会话表
 * 每次新对话生成一个 thread_id，用于 LangGraph checkpointer 和对话历史关联。
 */
@Entity('conversations')
export class ConversationEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  /** 关联用户（可选，单租户时为空） */
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  userId!: string | null;

  /** 会话标题（取自首条用户消息前 50 字） */
  @Column({ type: 'varchar', length: 100, default: '' })
  title!: string;

  /** 使用的 RAG 模式 */
  @Column({ type: 'varchar', length: 16, default: 'auto' })
  mode!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
