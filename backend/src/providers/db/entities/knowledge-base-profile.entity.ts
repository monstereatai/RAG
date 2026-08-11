import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('knowledge_base_profiles')
@Index('IDX_knowledge_base_profiles_workspace_key', ['workspaceId', 'key'], { unique: true })
export class KnowledgeBaseProfileEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Column({ type: 'varchar', length: 128 }) key!: string;
  @Column({ type: 'varchar', length: 255 }) name!: string;
  @Column({ type: 'varchar', length: 64, default: 'default' }) workspaceId!: string;
  @Column({ type: 'varchar', length: 32, default: 'general' }) documentType!: string;
  @Column({ type: 'int', default: 500 }) chunkSize!: number;
  @Column({ type: 'int', default: 50 }) chunkOverlap!: number;
  @Column({ type: 'text', default: '{}' }) retrievalConfig!: string;
  @Column({ type: 'text', default: '{}' }) syncConfig!: string;
  @Column({ type: 'varchar', length: 32, default: 'enabled' }) status!: 'enabled' | 'disabled';
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}
