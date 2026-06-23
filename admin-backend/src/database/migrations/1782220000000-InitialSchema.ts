import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1782220000000 implements MigrationInterface {
  name = 'InitialSchema1782220000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        id int NOT NULL AUTO_INCREMENT,
        name varchar(50) NOT NULL COMMENT '权限名称',
        code varchar(50) NOT NULL COMMENT '权限代码',
        description varchar(100) NOT NULL COMMENT '权限描述',
        UNIQUE INDEX IDX_permissions_code (code),
        PRIMARY KEY (id)
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id int NOT NULL AUTO_INCREMENT,
        name varchar(50) NOT NULL COMMENT '角色名称',
        code varchar(50) NOT NULL COMMENT '角色标识',
        description varchar(255) NULL COMMENT '角色描述',
        UNIQUE INDEX IDX_roles_name (name),
        UNIQUE INDEX IDX_roles_code (code),
        PRIMARY KEY (id)
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS users (
        id int NOT NULL AUTO_INCREMENT,
        username varchar(255) NOT NULL,
        password varchar(255) NOT NULL,
        email varchar(255) NOT NULL,
        role varchar(255) NOT NULL DEFAULT 'user',
        isActive tinyint NOT NULL DEFAULT 1,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX IDX_users_username (username),
        PRIMARY KEY (id)
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        rolesId int NOT NULL,
        permissionsId int NOT NULL,
        INDEX IDX_role_permissions_rolesId (rolesId),
        INDEX IDX_role_permissions_permissionsId (permissionsId),
        PRIMARY KEY (rolesId, permissionsId),
        CONSTRAINT FK_role_permissions_roles FOREIGN KEY (rolesId) REFERENCES roles(id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT FK_role_permissions_permissions FOREIGN KEY (permissionsId) REFERENCES permissions(id) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_roles (
        usersId int NOT NULL,
        rolesId int NOT NULL,
        INDEX IDX_user_roles_usersId (usersId),
        INDEX IDX_user_roles_rolesId (rolesId),
        PRIMARY KEY (usersId, rolesId),
        CONSTRAINT FK_user_roles_users FOREIGN KEY (usersId) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT FK_user_roles_roles FOREIGN KEY (rolesId) REFERENCES roles(id) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id int NOT NULL AUTO_INCREMENT,
        userId int NOT NULL,
        amount int NOT NULL,
        description text NOT NULL,
        status enum ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled') NOT NULL DEFAULT 'pending',
        items json NOT NULL,
        discount int NOT NULL DEFAULT 0,
        tax decimal(10,2) NOT NULL DEFAULT 0,
        total decimal(10,2) NOT NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id)
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id int NOT NULL AUTO_INCREMENT,
        userId int NOT NULL,
        orderId int NOT NULL,
        amount decimal(10,2) NOT NULL,
        status enum ('pending', 'processing', 'completed', 'failed', 'refunded', 'cancelled') NOT NULL DEFAULT 'pending',
        method enum ('credit_card', 'debit_card', 'paypal', 'bank_transfer', 'alipay', 'wechat') NOT NULL,
        description text NOT NULL,
        transactionId varchar(255) NULL,
        gatewayResponse varchar(255) NULL,
        fee int NOT NULL DEFAULT 0,
        refunded tinyint NOT NULL DEFAULT 0,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id)
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id varchar(36) NOT NULL,
        module varchar(100) NOT NULL COMMENT '操作模块',
        action varchar(50) NOT NULL COMMENT '操作类型',
        userId varchar(255) NULL COMMENT '操作人ID',
        username varchar(255) NULL COMMENT '操作人名称',
        requestData text NULL COMMENT '请求参数',
        responseData text NULL COMMENT '响应结果',
        ip varchar(50) NULL COMMENT 'IP地址',
        traceId varchar(100) NULL COMMENT '链路追踪ID',
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS audit_logs');
    await queryRunner.query('DROP TABLE IF EXISTS payments');
    await queryRunner.query('DROP TABLE IF EXISTS orders');
    await queryRunner.query('DROP TABLE IF EXISTS user_roles');
    await queryRunner.query('DROP TABLE IF EXISTS role_permissions');
    await queryRunner.query('DROP TABLE IF EXISTS users');
    await queryRunner.query('DROP TABLE IF EXISTS roles');
    await queryRunner.query('DROP TABLE IF EXISTS permissions');
  }
}
