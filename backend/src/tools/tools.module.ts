import { Module } from '@nestjs/common';
import { BochaSearchService } from './bocha-search.service';
import { DashScopeRerankService } from './dashscope-rerank.service';

@Module({
  providers: [BochaSearchService, DashScopeRerankService],
  exports: [BochaSearchService, DashScopeRerankService],
})
export class ToolsModule {}
