import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('agent_actions')
@Index('IDX_agent_actions_run_created', ['runId', 'createdAt'])
export class AgentActionEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Index('IDX_agent_actions_tenant')
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  tenantId!: string | null;
  @Column({ type: 'varchar', length: 64 }) runId!: string;
  @Column({ type: 'varchar', length: 64 }) name!: string;
  @Column({ type: 'varchar', length: 32 }) actionType!: string;
  @Column({ type: 'varchar', length: 32, default: 'success' }) status!:
    | 'success'
    | 'failed'
    | 'waiting_approval'
    | 'skipped';
  @Column({ type: 'varchar', length: 32, default: 'low' }) riskLevel!:
    | 'low'
    | 'medium'
    | 'high';
  @Column({ type: 'boolean', default: false }) requiresApproval!: boolean;
  @Column({ type: 'int', default: 0 }) durationMs!: number;
  @Column({ type: 'text', nullable: true, default: null }) input!:
    | string
    | null;
  @Column({ type: 'text', nullable: true, default: null }) output!:
    | string
    | null;
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  approvedBy!: string | null;
  @CreateDateColumn() createdAt!: Date;
}
