import { Module } from '@nestjs/common';
import { BochaSearchService } from './bocha-search.service';
import { DashScopeRerankService } from './dashscope-rerank.service';
import { GraphSearchService } from './graph-search.service';
import { ImageSearchToolService } from './image-search.service';
import { ToolExecutionPolicyService } from './tool-execution-policy.service';
import { ToolExecutionService } from './tool-execution.service';
import { ImageIndexModule } from '../modules/image-index/image-index.module';
import { AgentRuntimeEventsModule } from '../modules/agent-runtime-events/agent-runtime-events.module';
import { RedisModule } from '../providers/redis/redis.module';
import { ArtifactsModule } from '../modules/artifacts/artifacts.module';
import { MetricsModule } from '../modules/metrics/metrics.module';
import { McpModule } from '../providers/mcp/mcp.module';
import { ToolExecutionReconciliationController } from './tool-execution-reconciliation.controller';
import { ToolExecutionReconciliationService } from './tool-execution-reconciliation.service';

@Module({
  imports: [
    AgentRuntimeEventsModule,
    RedisModule,
    ArtifactsModule,
    ImageIndexModule,
    MetricsModule,
    McpModule,
  ],
  controllers: [ToolExecutionReconciliationController],
  providers: [
    BochaSearchService,
    DashScopeRerankService,
    GraphSearchService,
    ImageSearchToolService,
    ToolExecutionPolicyService,
    ToolExecutionService,
    ToolExecutionReconciliationService,
  ],
  exports: [
    BochaSearchService,
    DashScopeRerankService,
    GraphSearchService,
    ImageSearchToolService,
    ToolExecutionPolicyService,
    ToolExecutionService,
  ],
})
export class ToolsModule {}
