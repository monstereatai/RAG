import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('iam_tenants')
@Index('UQ_iam_tenants_slug', ['slug'], { unique: true })
export class IamTenantEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Column({ type: 'varchar', length: 96 }) slug!: string;
  @Column({ type: 'varchar', length: 160 }) name!: string;
  @Column({ type: 'varchar', length: 24, default: 'active' }) status!:
    | 'active'
    | 'suspended';
  @Column({ type: 'text', default: '{}' }) settings!: string;
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}
