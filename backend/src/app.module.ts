import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { configuration } from './config/configuration';
import { LoggerModule } from './common/logger/logger.module';
import { FilesystemPolicyModule } from './common/filesystem/filesystem-policy.module';
import { DatabaseModule } from './providers/db/database.module';
import { SpeechModule as SpeechProviderModule } from './providers/speech/speech.module';
import { ElasticsearchModule } from './providers/elasticsearch/elasticsearch.module';
import { RedisModule } from './providers/redis/redis.module';
import { McpModule } from './providers/mcp/mcp.module';
import { Mem0Module } from './providers/mem0/mem0.module';
import { ObjectStorageModule } from './providers/object-storage/object-storage.module';
import { VisionModule } from './providers/vision/vision.module';
import { ObservabilityModule } from './providers/observability/observability.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { DocumentModule } from './modules/document/document.module';
import { ChatModule } from './modules/chat/chat.module';
import { DebugModule } from './modules/debug/debug.module';
import { SpeechModule } from './modules/speech/speech.module';
import { MemoryModule } from './modules/memory/memory.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { TracingModule } from './modules/tracing/tracing.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { SkillsModule } from './modules/skills/skills.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { AgentsModule } from './rag/agents/agents.module';
import { SupervisorModule } from './modules/supervisor/supervisor.module';
import { McpRoutesModule } from './modules/mcp/mcp.module';

import { StructuredModule } from './modules/structured/structured.module';
import { Neo4jModule } from './providers/neo4j/neo4j.module';
import { GraphModule } from './modules/graph/graph.module';
import { RagAdminModule } from './modules/rag-admin/rag-admin.module';
import { GrpcModule } from './modules/grpc/rag-grpc.module';
import { AguiModule } from './modules/agui/agui.module';
import { QaOpsModule } from './modules/qa-ops/qa-ops.module';
import { WeeklySummaryModule } from './modules/weekly-summary/weekly-summary.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('throttle.ttlMs') ?? 60000,
          limit: config.get<number>('throttle.limit') ?? 60,
        },
      ],
    }),
    LoggerModule,
    FilesystemPolicyModule,
    DatabaseModule,
    SpeechProviderModule,
    ElasticsearchModule,
    RedisModule,
    McpModule,
    Mem0Module,
    ObjectStorageModule,
    ObservabilityModule,
    VisionModule,
    AuthModule,
    HealthModule,
    DocumentModule,
    ChatModule,
    DebugModule,
    SpeechModule,
    MemoryModule,
    MetricsModule,
    TracingModule,
    JobsModule,
    SkillsModule,
    WorkflowModule,
    AgentsModule,
    SupervisorModule,
    McpRoutesModule,
    StructuredModule,
    Neo4jModule,
    GraphModule,
    RagAdminModule,
    GrpcModule,
    AguiModule,
    WeeklySummaryModule,
    QaOpsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
