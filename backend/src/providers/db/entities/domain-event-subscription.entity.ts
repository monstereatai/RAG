import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('domain_event_subscriptions')
@Index('IDX_domain_event_subscriptions_enabled', ['enabled', 'channel'])
export class DomainEventSubscriptionEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Column({ type: 'varchar', length: 120 }) name!: string;
  @Column({ type: 'text' }) eventTypes!: string;
  @Column({ type: 'varchar', length: 32 }) channel!: 'enterprise_wechat' | 'webhook';
  /** 仅保存配置键，例如 EVENT_WEBHOOK_ENTERPRISE_WECHAT_URL，不保存 URL／密钥。 */
  @Column({ type: 'varchar', length: 128 }) endpointKey!: string;
  @Column({ type: 'boolean', default: true }) enabled!: boolean;
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}
