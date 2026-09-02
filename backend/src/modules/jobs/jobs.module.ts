import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { ScheduledJobEntity } from '../../providers/db/entities/job.entity';
import { JobExecutionEntity } from '../../providers/db/entities/job-execution.entity';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SupervisorModule } from '../supervisor/supervisor.module';
import { ScheduledAnalysisService } from './scheduled-analysis.service';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { RagFeedbackEntity } from '../../providers/db/entities/rag-feedback.entity';
import { QueryLogEntity } from '../../providers/db/entities/query-log.entity';
import { AgentTaskEntity } from '../../providers/db/entities/agent-task.entity';
import { MetricsModule } from '../metrics/metrics.module';
import { LlmModule } from '../../providers/llm/llm.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([
      ScheduledJobEntity,
      JobExecutionEntity,
      DocumentMetaEntity,
      RagFeedbackEntity,
      QueryLogEntity,
      AgentTaskEntity,
    ]),
    SupervisorModule,
    MetricsModule,
    LlmModule,
  ],
  controllers: [JobsController],
  providers: [JobsService, ScheduledAnalysisService, RolesGuard],
  exports: [JobsService],
})
export class JobsModule {}
