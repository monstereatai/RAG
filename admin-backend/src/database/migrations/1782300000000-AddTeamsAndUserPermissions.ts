import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 团队/部门组织架构 + 用户直接授权
 *
 * - teams: 团队（部门）表，name 唯一
 * - team_members: 团队成员表，(teamId, userId) 唯一，含团队内角色 owner/member
 * - user_permissions: 用户直赋权限表，(userId, permissionId) 唯一
 *
 * 权限解析语义：有效权限 = 角色权限 ∪ 用户直赋权限（见 PermissionService）。
 */
export class AddTeamsAndUserPermissions1782300000000 implements MigrationInterface {
  name = 'AddTeamsAndUserPermissions1782300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id int NOT NULL AUTO_INCREMENT,
        name varchar(100) NOT NULL COMMENT '团队名称',
        description varchar(255) NULL COMMENT '团队描述',
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX IDX_teams_name (name),
        PRIMARY KEY (id)
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_members (
        id int NOT NULL AUTO_INCREMENT,
        teamId int NOT NULL COMMENT '团队ID',
        userId int NOT NULL COMMENT '用户ID',
        role varchar(20) NOT NULL DEFAULT 'member' COMMENT '团队内角色 (owner/member)',
        joinedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE INDEX IDX_team_members_team_user (teamId, userId),
        INDEX IDX_team_members_userId (userId),
        PRIMARY KEY (id),
        CONSTRAINT FK_team_members_team FOREIGN KEY (teamId) REFERENCES teams(id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT FK_team_members_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_permissions (
        id int NOT NULL AUTO_INCREMENT,
        userId int NOT NULL COMMENT '用户ID',
        permissionId int NOT NULL COMMENT '权限ID',
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '授权时间',
        UNIQUE INDEX IDX_user_permissions_user_permission (userId, permissionId),
        INDEX IDX_user_permissions_permissionId (permissionId),
        PRIMARY KEY (id),
        CONSTRAINT FK_user_permissions_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT FK_user_permissions_permission FOREIGN KEY (permissionId) REFERENCES permissions(id) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS user_permissions');
    await queryRunner.query('DROP TABLE IF EXISTS team_members');
    await queryRunner.query('DROP TABLE IF EXISTS teams');
  }
}
