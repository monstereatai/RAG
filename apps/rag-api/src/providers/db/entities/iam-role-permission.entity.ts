import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('iam_role_permissions')
export class IamRolePermissionEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) roleId!: string;
  @PrimaryColumn({ type: 'varchar', length: 64 }) permissionId!: string;
  @Column({ type: 'timestamp', nullable: true, default: null })
  grantedAt!: Date | null;
}
