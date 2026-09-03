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

@Module({
  imports: [
    AgentRuntimeEventsModule,
    RedisModule,
    ArtifactsModule,
    ImageIndexModule,
  ],
  providers: [
    BochaSearchService,
    DashScopeRerankService,
    GraphSearchService,
    ImageSearchToolService,
    ToolExecutionPolicyService,
    ToolExecutionService,
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
