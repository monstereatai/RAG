import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 对话消息表
 * 存储每轮对话的用户问题和 AI 回答，用于多轮上下文注入。
 */
@Entity('messages')
@Index(['conversationId', 'createdAt'])
export class MessageEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;
  @Index('IDX_messages_tenant')
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  tenantId!: string | null;

  @Column({ type: 'varchar', length: 64 })
  conversationId!: string;

  @Column({ type: 'varchar', length: 8 }) // 'human' | 'ai'
  role!: string;

  @Column({ type: 'text' })
  content!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
