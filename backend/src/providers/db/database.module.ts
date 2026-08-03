import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { UserEntity } from './entities/user.entity';
import { ConversationEntity } from './entities/conversation.entity';
import { MessageEntity } from './entities/message.entity';
import { DocumentMetaEntity } from './entities/document-meta.entity';
import { DocumentChunkEntity } from './entities/document-chunk.entity';
import { FactConflictEntity } from './entities/fact-conflict.entity';
import { ScheduledJobEntity } from './entities/job.entity';
import { QueryLogEntity } from './entities/query-log.entity';
import { WeeklySummaryEntity } from './entities/weekly-summary.entity';
import { JobExecutionEntity } from './entities/job-execution.entity';
import { DocumentTaskEntity } from './entities/document-task.entity';
import { DocumentResourceEntity } from './entities/document-resource.entity';
import { DocumentPermissionEntity } from './entities/document-permission.entity';
import { RagFeedbackEntity } from './entities/rag-feedback.entity';
import { GeneratedArtifactEntity } from './entities/generated-artifact.entity';
import { ArtifactShareEntity } from './entities/artifact-share.entity';
import { ArtifactAccessLogEntity } from './entities/artifact-access-log.entity';

/**
 * 关系型数据库模块（TypeORM，可插拔 postgres/mysql）
 *
 * 当前配置为"不阻断启动"：
 * - retryAttempts: 5（默认 10，缩短等待时间）
 * - 连接失败时警告日志但不 crash
 *
 * 实体列表：UserEntity / ConversationEntity / MessageEntity / DocumentMetaEntity / DocumentChunkEntity / FactConflictEntity / ScheduledJobEntity
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
        const synchronize =
          process.env.TYPEORM_SYNCHRONIZE === 'true' ||
          (process.env.TYPEORM_SYNCHRONIZE !== 'false' &&
            nodeEnv === 'development');

        return {
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
            QueryLogEntity,
            WeeklySummaryEntity,
            JobExecutionEntity,
            DocumentTaskEntity,
            DocumentResourceEntity,
            DocumentPermissionEntity,
            RagFeedbackEntity,
            GeneratedArtifactEntity,
            ArtifactShareEntity,
            ArtifactAccessLogEntity,
          ],
          synchronize,
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
      DocumentChunkEntity,
      FactConflictEntity,
      ScheduledJobEntity,
      QueryLogEntity,
      WeeklySummaryEntity,
      JobExecutionEntity,
      DocumentTaskEntity,
      DocumentResourceEntity,
      DocumentPermissionEntity,
      RagFeedbackEntity,
      GeneratedArtifactEntity,
      ArtifactShareEntity,
      ArtifactAccessLogEntity,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
