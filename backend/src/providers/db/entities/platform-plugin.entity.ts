import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('platform_plugins')
@Index('IDX_platform_plugins_key_version', ['key', 'version'], { unique: true })
export class PlatformPluginEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Column({ type: 'varchar', length: 128 }) key!: string;
  @Column({ type: 'varchar', length: 32 }) type!: 'model' | 'tool' | 'mcp' | 'datasource' | 'agent_strategy' | 'trigger';
  @Column({ type: 'varchar', length: 64 }) version!: string;
  @Column({ type: 'text', default: '[]' }) capabilities!: string;
  @Column({ type: 'text', default: '[]' }) permissions!: string;
  @Column({ type: 'varchar', length: 32, default: 'enabled' }) status!: 'enabled' | 'disabled' | 'degraded';
  @Column({ type: 'int', default: 0 }) timeoutMs!: number;
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}
