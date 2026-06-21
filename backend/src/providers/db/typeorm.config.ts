/**
 * TypeORM DataSource 配置（用于 migration CLI）
 *
 * 使用方式：
 *   # 生成迁移文件（diff entities vs DB）
 *   npx typeorm-ts-node-commonjs migration:generate src/migrations/InitSchema -d src/providers/db/typeorm.config.ts
 *
 *   # 运行迁移
 *   npx typeorm-ts-node-commonjs migration:run -d src/providers/db/typeorm.config.ts
 *
 *   # 回滚迁移
 *   npx typeorm-ts-node-commonjs migration:revert -d src/providers/db/typeorm.config.ts
 *
 * 注意：此文件读取本地 .env（dotenv），独立于 NestJS 配置体系。
 */

import 'dotenv/config';
import { DataSource } from 'typeorm';
import { UserEntity } from './entities/user.entity';
import { ConversationEntity } from './entities/conversation.entity';
import { MessageEntity } from './entities/message.entity';
import { DocumentMetaEntity } from './entities/document-meta.entity';
import { DocumentChunkEntity } from './entities/document-chunk.entity';
import { FactConflictEntity } from './entities/fact-conflict.entity';
import { ScheduledJobEntity } from './entities/job.entity';

const provider = process.env.RELATIONAL_DB_PROVIDER ?? 'postgres';
const isPostgres = provider !== 'mysql';

const url = isPostgres
  ? (process.env.POSTGRES_URL ??
    'postgresql://postgres:postgres@localhost:5432/rag')
  : (process.env.MYSQL_URL ?? 'mysql://root:root@localhost:3306/rag');

export default new DataSource({
  type: isPostgres ? 'postgres' : 'mysql',
  url,
  entities: [
    UserEntity,
    ConversationEntity,
    MessageEntity,
    DocumentMetaEntity,
    DocumentChunkEntity,
    FactConflictEntity,
    ScheduledJobEntity,
  ],
  migrations: ['src/migrations/*.ts'],
  synchronize: false, // CLI 模式始终关闭自动同步，使用 migration:run
  logging: true,
});
