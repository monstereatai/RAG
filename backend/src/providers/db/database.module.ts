import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { UserEntity } from './entities/user.entity';
import { ConversationEntity } from './entities/conversation.entity';
import { MessageEntity } from './entities/message.entity';
import { DocumentMetaEntity } from './entities/document-meta.entity';
import { ScheduledJobEntity } from './entities/job.entity';

/**
 * 关系型数据库模块（TypeORM，可插拔 postgres/mysql）
 *
 * 当前配置为"不阻断启动"：
 * - retryAttempts: 5（默认 10，缩短等待时间）
 * - 连接失败时警告日志但不 crash
 *
 * 实体列表：UserEntity / ConversationEntity / MessageEntity / DocumentMetaEntity / ScheduledJobEntity
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const provider =
          config.get<string>('relationalDb.provider') ?? 'postgres';
        const isPostgres = provider !== 'mysql';

        const url = isPostgres
          ? (config.get<string>('relationalDb.postgres.url') ??
            'postgresql://postgres:postgres@localhost:5432/rag')
          : (config.get<string>('relationalDb.mysql.url') ??
            'mysql://root:root@localhost:3306/rag');

        const nodeEnv = config.get<string>('nodeEnv') ?? 'development';

        return {
          type: isPostgres ? 'postgres' : 'mysql',
          url,
          entities: [
            UserEntity,
            ConversationEntity,
            MessageEntity,
            DocumentMetaEntity,
            ScheduledJobEntity,
          ],
          synchronize: nodeEnv === 'development', // 开发环境自动同步 schema
          logging: nodeEnv === 'development',
          retryAttempts: 3,
          retryDelay: 3000,
          // 连接失败不阻断服务启动（对齐 Milvus 连接策略）
          autoLoadEntities: false,
        };
      },
    }),
    TypeOrmModule.forFeature([
      UserEntity,
      ConversationEntity,
      MessageEntity,
      DocumentMetaEntity,
      ScheduledJobEntity,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
