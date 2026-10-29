/**
 * TypeORM CLI 专用 DataSource。
 *
 * 用途：migration:generate / migration:run / migration:revert
 * 不被应用主流程直接引用，由 npm run migration:* 脚本调用。
 *
 * 使用前必须设置环境变量（可用 .env.development 文件）：
 *   ENABLE_DATABASE=true
 *   DB_HOST=localhost
 *   DB_PORT=3306
 *   DB_USERNAME=root
 *   DB_PASSWORD=your_password
 *   DB_DATABASE=nestjs_enterprise
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { Permission } from './entities/permission.entity';
import { Order } from './entities/order.entity';
import { Payment } from './entities/payment.entity';
import { AuditLog } from './entities/audit-log.entity';
import { Notification } from './entities/notification.entity';
import { Team } from './entities/team.entity';
import { TeamMember } from './entities/team-member.entity';
import { UserPermission } from './entities/user-permission.entity';

// CLI 默认读取开发配置；容器和 CI 通过环境变量覆盖。
dotenv.config({ path: `.env.${process.env.NODE_ENV || 'development'}`, quiet: true });
dotenv.config({ quiet: true });

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || 'nestjs_enterprise',
  entities: [User, Role, Permission, Order, Payment, AuditLog, Notification, Team, TeamMember, UserPermission],
  migrations: [`${__dirname}/migrations/*{.ts,.js}`],
  // 生产环境 CLI 迁移时 synchronize 必须为 false
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
});
