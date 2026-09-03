import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/** 团队内角色取值 */
export const TEAM_MEMBER_ROLES = ['owner', 'member'] as const;
export type TeamMemberRole = (typeof TEAM_MEMBER_ROLES)[number];

@Entity('team_members')
@Index('IDX_team_members_team_user', ['teamId', 'userId'], { unique: true })
@Index('IDX_team_members_userId', ['userId'])
export class TeamMember {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ comment: '团队ID' })
  teamId!: number;

  @Column({ comment: '用户ID' })
  userId!: number;

  @Column({ length: 20, default: 'member', comment: '团队内角色 (owner/member)' })
  role!: string;

  @CreateDateColumn()
  joinedAt!: Date;
}
