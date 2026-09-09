import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('agent_runs')
@Index('IDX_agent_runs_thread_created', ['threadId', 'createdAt'])
@Index('IDX_agent_runs_status_created', ['status', 'createdAt'])
export class AgentRunEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Column({ type: 'varchar', length: 64 }) threadId!: string;
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  queryLogId!: string | null;
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  userId!: string | null;
  @Column({ type: 'varchar', length: 32 }) mode!: 'simple' | 'auto' | 'agentic';
  @Column({ type: 'varchar', length: 32, nullable: true, default: null })
  route!: string | null;
  @Column({ type: 'varchar', length: 32, default: 'running' }) status!:
    | 'running'
    | 'waiting_approval'
    | 'completed'
    | 'failed'
    | 'cancelled';
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  currentNode!: string | null;
  @Column({ type: 'int', default: 0 }) actionCount!: number;
  @Column({ type: 'int', default: 0 }) retryCount!: number;
  @Column({ type: 'int', default: 18 }) maxSteps!: number;
  @Column({ type: 'int', default: 24 }) maxToolCalls!: number;
  @Column({ type: 'int', default: 0 }) toolCallCount!: number;
  @Column({ type: 'int', default: 6 }) maxDelegations!: number;
  @Column({ type: 'int', default: 0 }) delegationCount!: number;
  @Column({ type: 'numeric', precision: 12, scale: 6, default: 0 })
  costUsd!: number;
  @Column({ type: 'boolean', default: false }) requiresApproval!: boolean;
  @Column({ type: 'text', nullable: true, default: null }) errorMessage!:
    | string
    | null;
  @Column({ type: 'text', nullable: true, default: null }) resultSummary!:
    | string
    | null;
  @Column({ type: 'timestamp', nullable: true, default: null })
  finishedAt!: Date | null;
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}
