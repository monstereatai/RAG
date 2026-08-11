import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentRunEntity } from '../../providers/db/entities/agent-run.entity';
import { AgentActionEntity } from '../../providers/db/entities/agent-action.entity';
import { AgentRunsService } from './agent-runs.service';
import { AgentRuntimeEventsModule } from '../agent-runtime-events/agent-runtime-events.module';

@Module({
  imports: [TypeOrmModule.forFeature([AgentRunEntity, AgentActionEntity]), AgentRuntimeEventsModule],
  providers: [AgentRunsService],
  exports: [AgentRunsService],
})
export class AgentRunsModule {}
