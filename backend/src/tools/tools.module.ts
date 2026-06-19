import { Module } from '@nestjs/common';
import { BochaSearchService } from './bocha-search.service';
import { DashScopeRerankService } from './dashscope-rerank.service';
import { GraphSearchService } from './graph-search.service';

@Module({
  providers: [BochaSearchService, DashScopeRerankService, GraphSearchService],
  exports: [BochaSearchService, DashScopeRerankService, GraphSearchService],
})
export class ToolsModule {}
