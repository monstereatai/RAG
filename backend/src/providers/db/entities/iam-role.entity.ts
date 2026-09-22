import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('iam_roles')
@Index('UQ_iam_roles_scope_name', ['tenantId', 'name'], { unique: true })
export class IamRoleEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  tenantId!: string | null;
  @Column({ type: 'varchar', length: 96 }) name!: string;
  @Column({ type: 'varchar', length: 255, nullable: true, default: null })
  description!: string | null;
  @Column({ type: 'boolean', default: false }) isSystem!: boolean;
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}
