import { Entity, PrimaryColumn } from 'typeorm';

@Entity('iam_membership_roles')
export class IamMembershipRoleEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) membershipId!: string;
  @PrimaryColumn({ type: 'varchar', length: 64 }) roleId!: string;
}
