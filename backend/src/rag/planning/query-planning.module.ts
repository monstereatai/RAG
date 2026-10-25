import { Module } from '@nestjs/common';
import { MetricsModule } from '../../modules/metrics/metrics.module';
import { LlmModule } from '../../providers/llm/llm.module';
import { QueryPlannerService } from './query-planner.service';
import { RetrievalPolicyService } from './retrieval-policy.service';

@Module({
  imports: [LlmModule, MetricsModule],
  providers: [QueryPlannerService, RetrievalPolicyService],
  exports: [QueryPlannerService, RetrievalPolicyService],
})
export class QueryPlanningModule {}
