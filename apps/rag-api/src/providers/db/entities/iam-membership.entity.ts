import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('iam_memberships')
@Index('UQ_iam_memberships_tenant_user', ['tenantId', 'userId'], {
  unique: true,
})
@Index('IDX_iam_memberships_user', ['userId'])
export class IamMembershipEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Column({ type: 'varchar', length: 64 }) tenantId!: string;
  @Column({ type: 'varchar', length: 64 }) userId!: string;
  @Column({ type: 'varchar', length: 24, default: 'active' }) status!:
    | 'active'
    | 'suspended';
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}
