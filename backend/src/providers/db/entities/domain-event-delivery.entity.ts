import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('domain_event_deliveries')
@Index(
  'UQ_domain_event_deliveries_event_subscription',
  ['eventId', 'subscriptionId'],
  {
    unique: true,
  },
)
@Index('IDX_domain_event_deliveries_dispatch', ['status', 'availableAt'])
export class DomainEventDeliveryEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Column({ type: 'varchar', length: 64 }) eventId!: string;
  @Column({ type: 'varchar', length: 64 }) subscriptionId!: string;
  @Column({ type: 'varchar', length: 16, default: 'pending' }) status!:
    | 'pending'
    | 'delivered'
    | 'failed';
  @Column({ type: 'int', default: 0 }) attempts!: number;
  @Column({ type: 'int', default: 3 }) maxAttempts!: number;
  @Column({ type: 'timestamp', nullable: true, default: null })
  availableAt!: Date | null;
  @Column({ type: 'timestamp', nullable: true, default: null })
  deliveredAt!: Date | null;
  @Column({ type: 'text', nullable: true, default: null }) lastError!:
    | string
    | null;
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}
