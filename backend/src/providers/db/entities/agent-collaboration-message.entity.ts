import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('agent_collaboration_messages')
@Index('IDX_agent_messages_thread_created', ['threadId', 'createdAt'])
export class AgentCollaborationMessageEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Column({ type: 'varchar', length: 64 }) threadId!: string;
  @Column({ type: 'varchar', length: 64, nullable: true, default: null }) runId!: string | null;
  @Column({ type: 'varchar', length: 64 }) fromRole!: string;
  @Column({ type: 'varchar', length: 64 }) toRole!: string;
  @Column({ type: 'varchar', length: 64 }) messageType!: string;
  @Column({ type: 'varchar', length: 128 }) subject!: string;
  @Column({ type: 'text', default: '{}' }) payload!: string;
  @Column({ type: 'text', default: '[]' }) artifactIds!: string;
  @Column({ type: 'varchar', length: 32, default: 'published' }) status!: string;
  @CreateDateColumn() createdAt!: Date;
}
