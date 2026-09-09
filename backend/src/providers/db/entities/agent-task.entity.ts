import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('agent_tasks')
@Index('IDX_agent_tasks_thread_status', ['threadId', 'status'])
@Index('IDX_agent_tasks_parent', ['parentTaskId'])
export class AgentTaskEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Column({ type: 'varchar', length: 64 }) threadId!: string;
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  runId!: string | null;
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  parentTaskId!: string | null;
  @Column({ type: 'varchar', length: 64 }) role!: string;
  @Column({ type: 'varchar', length: 128 }) title!: string;
  @Column({ type: 'text', default: '' }) description!: string;
  @Column({ type: 'varchar', length: 32, default: 'sequential' })
  processType!: string;
  @Column({ type: 'varchar', length: 32, default: 'pending' }) status!: string;
  @Column({ type: 'text', default: '[]' }) dependsOnTaskIds!: string;
  @Column({ type: 'text', default: '[]' }) inputArtifactIds!: string;
  @Column({ type: 'varchar', length: 128, nullable: true, default: null })
  outputArtifactId!: string | null;
  @Column({ type: 'boolean', default: false }) approvalRequired!: boolean;
  @Column({ type: 'int', default: 0 }) retryCount!: number;
  @Column({ type: 'text', nullable: true, default: null }) resultSummary!:
    | string
    | null;
  @Column({ type: 'text', nullable: true, default: null }) errorMessage!:
    | string
    | null;
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}
