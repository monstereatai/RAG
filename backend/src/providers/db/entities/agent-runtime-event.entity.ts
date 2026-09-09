import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('agent_runtime_events')
@Index('IDX_agent_runtime_events_thread_seq', ['threadId', 'sequence'])
@Index('IDX_agent_runtime_events_run_created', ['runId', 'createdAt'])
export class AgentRuntimeEventEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Column({ type: 'varchar', length: 64 }) threadId!: string;
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  runId!: string | null;
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  taskId!: string | null;
  @Column({ type: 'varchar', length: 64 }) eventType!: string;
  @Column({ type: 'varchar', length: 64 }) actor!: string;
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  target!: string | null;
  @Column({ type: 'int', default: 0 }) sequence!: number;
  @Column({ type: 'text', default: '{}' }) payload!: string;
  @CreateDateColumn() createdAt!: Date;
}
