import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('agent_runtime_event_sequences')
@Index('UQ_agent_runtime_event_sequences_thread', ['tenantId', 'threadId'], {
  unique: true,
})
export class AgentRuntimeEventSequenceEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Column({ type: 'varchar', length: 64 }) tenantId!: string;
  @Column({ type: 'varchar', length: 64 }) threadId!: string;
  @Column({ type: 'int', default: 0 }) nextSequence!: number;
  @UpdateDateColumn() updatedAt!: Date;
}
