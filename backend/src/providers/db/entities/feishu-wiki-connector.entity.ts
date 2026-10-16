import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('feishu_wiki_connectors')
@Index('UQ_feishu_wiki_connectors_tenant_space', ['tenantId', 'spaceId'], {
  unique: true,
})
export class FeishuWikiConnectorEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  tenantId!: string;

  @Column({ type: 'varchar', length: 64 })
  ownerUserId!: string;

  @Column({ type: 'varchar', length: 128 })
  spaceId!: string;

  @Column({ type: 'varchar', length: 16, default: 'idle' })
  status!: 'idle' | 'syncing' | 'failed';

  @Column({ type: 'boolean', default: false })
  shareWithinTenant!: boolean;

  @Column({ type: 'timestamp', nullable: true, default: null })
  lastSyncAt!: Date | null;

  @Column({ type: 'text', nullable: true, default: null })
  lastError!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('feishu_wiki_items')
@Index('UQ_feishu_wiki_items_connector_node', ['connectorId', 'nodeToken'], {
  unique: true,
})
@Index('IDX_feishu_wiki_items_tenant_active', ['tenantId', 'active'])
export class FeishuWikiItemEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  connectorId!: string;

  @Column({ type: 'varchar', length: 64 })
  tenantId!: string;

  @Column({ type: 'varchar', length: 128 })
  nodeToken!: string;

  @Column({ type: 'varchar', length: 128, nullable: true, default: null })
  objectToken!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true, default: null })
  objectType!: string | null;

  @Column({ type: 'varchar', length: 512 })
  title!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  remoteRevisionId!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  contentHash!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  localDocId!: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'timestamp', nullable: true, default: null })
  lastSeenAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  deletedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
