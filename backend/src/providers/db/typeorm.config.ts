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
import { JobExecutionEntity } from './entities/job-execution.entity';
import { DocumentTaskEntity } from './entities/document-task.entity';
import { DocumentResourceEntity } from './entities/document-resource.entity';
import { DocumentPermissionEntity } from './entities/document-permission.entity';
import { QueryLogEntity } from './entities/query-log.entity';
import { RagFeedbackEntity } from './entities/rag-feedback.entity';
import { GeneratedArtifactEntity } from './entities/generated-artifact.entity';
import { ArtifactShareEntity } from './entities/artifact-share.entity';
import { ArtifactAccessLogEntity } from './entities/artifact-access-log.entity';
import { AgenticStructuredArtifactEntity } from './entities/agentic-structured-artifact.entity';
import { WorkflowTemplateEntity } from './entities/workflow-template.entity';
import { WorkflowTemplateVersionEntity } from './entities/workflow-template-version.entity';
import { PlatformPluginEntity } from './entities/platform-plugin.entity';
import { ModelRegistryEntity } from './entities/model-registry.entity';
import { EvaluationCaseEntity } from './entities/evaluation-case.entity';
import { KnowledgeBaseProfileEntity } from './entities/knowledge-base-profile.entity';
import { AgentRunEntity } from './entities/agent-run.entity';
import { AgentActionEntity } from './entities/agent-action.entity';
import { AgentSopEntity } from './entities/agent-sop.entity';
import { AgentCollaborationMessageEntity } from './entities/agent-collaboration-message.entity';
import { ArtifactDependencyEntity } from './entities/artifact-dependency.entity';
import { DecisionRecordEntity } from './entities/decision-record.entity';
import { AgentTaskEntity } from './entities/agent-task.entity';
import { AgentRuntimeEventEntity } from './entities/agent-runtime-event.entity';
import { DocumentReviewEntity } from './entities/document-review.entity';
import { DomainEventOutboxEntity } from './entities/domain-event-outbox.entity';
import { DomainEventSubscriptionEntity } from './entities/domain-event-subscription.entity';

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
    JobExecutionEntity,
    DocumentTaskEntity,
    DocumentResourceEntity,
    DocumentPermissionEntity,
    QueryLogEntity,
    RagFeedbackEntity,
    GeneratedArtifactEntity,
    ArtifactShareEntity,
    ArtifactAccessLogEntity,
    AgenticStructuredArtifactEntity,
    WorkflowTemplateEntity,
    WorkflowTemplateVersionEntity,
    PlatformPluginEntity,
    ModelRegistryEntity,
    EvaluationCaseEntity,
    KnowledgeBaseProfileEntity,
    AgentRunEntity,
    AgentActionEntity,
    AgentSopEntity,
    AgentCollaborationMessageEntity,
    ArtifactDependencyEntity,
    DecisionRecordEntity,
    AgentTaskEntity,
    AgentRuntimeEventEntity,
    DocumentReviewEntity,
    DomainEventOutboxEntity,
    DomainEventSubscriptionEntity,
  ],
  migrations: ['src/migrations/*.ts'],
  synchronize: false, // CLI 模式始终关闭自动同步，使用 migration:run
  logging: true,
});
