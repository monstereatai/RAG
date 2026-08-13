import { Module } from '@nestjs/common';
import { BochaSearchService } from './bocha-search.service';
import { DashScopeRerankService } from './dashscope-rerank.service';
import { GraphSearchService } from './graph-search.service';
import { ToolExecutionPolicyService } from './tool-execution-policy.service';

@Module({
  providers: [BochaSearchService, DashScopeRerankService, GraphSearchService, ToolExecutionPolicyService],
  exports: [BochaSearchService, DashScopeRerankService, GraphSearchService, ToolExecutionPolicyService],
})
export class ToolsModule {}
