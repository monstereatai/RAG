import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * 用户直赋权限（绕过角色的直接授权）。
 * 权限解析时与「角色权限」取并集，见 PermissionService.resolveUserPermissionCodes。
 */
@Entity('user_permissions')
@Index('IDX_user_permissions_user_permission', ['userId', 'permissionId'], { unique: true })
@Index('IDX_user_permissions_permissionId', ['permissionId'])
export class UserPermission {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ comment: '用户ID' })
  userId!: number;

  @Column({ comment: '权限ID' })
  permissionId!: number;

  @CreateDateColumn({ comment: '授权时间' })
  createdAt!: Date;
}
