import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('model_registry')
@Index('IDX_model_registry_provider_model', ['provider', 'model'], { unique: true })
export class ModelRegistryEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Column({ type: 'varchar', length: 64 }) provider!: string;
  @Column({ type: 'varchar', length: 128 }) model!: string;
  @Column({ type: 'text', default: '[]' }) capabilities!: string;
  @Column({ type: 'text', default: '{}' }) pricing!: string;
  @Column({ type: 'varchar', length: 128, nullable: true, default: null }) fallbackModel!: string | null;
  @Column({ type: 'varchar', length: 32, default: 'enabled' }) status!: 'enabled' | 'disabled' | 'degraded';
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}
