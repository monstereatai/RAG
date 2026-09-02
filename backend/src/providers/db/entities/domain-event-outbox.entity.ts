import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('domain_event_outbox')
@Index('IDX_domain_event_outbox_dispatch', ['status', 'availableAt'])
@Index('IDX_domain_event_outbox_event_created', ['eventType', 'createdAt'])
export class DomainEventOutboxEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Column({ type: 'varchar', length: 96, unique: true }) idempotencyKey!: string;
  @Column({ type: 'varchar', length: 96 }) eventType!: string;
  @Column({ type: 'varchar', length: 64 }) aggregateType!: string;
  @Column({ type: 'varchar', length: 64 }) aggregateId!: string;
  @Column({ type: 'text', default: '{}' }) payload!: string;
  @Column({ type: 'varchar', length: 16, default: 'pending' }) status!: 'pending' | 'delivered' | 'failed' | 'skipped';
  @Column({ type: 'int', default: 0 }) attempts!: number;
  @Column({ type: 'int', default: 3 }) maxAttempts!: number;
  @Column({ type: 'timestamp', nullable: true, default: null }) availableAt!: Date | null;
  @Column({ type: 'timestamp', nullable: true, default: null }) deliveredAt!: Date | null;
  @Column({ type: 'text', nullable: true, default: null }) lastError!: string | null;
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}
