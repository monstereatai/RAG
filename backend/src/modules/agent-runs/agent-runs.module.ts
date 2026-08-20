import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentRunEntity } from '../../providers/db/entities/agent-run.entity';
import { AgentActionEntity } from '../../providers/db/entities/agent-action.entity';
import { AgentRunsService } from './agent-runs.service';
import { AgentGoalService } from './agent-goal.service';
import { AgentRuntimeEventsModule } from '../agent-runtime-events/agent-runtime-events.module';
import { AgentRuntimeModule } from '../agent-runtime/agent-runtime.module';

@Module({
  imports: [TypeOrmModule.forFeature([AgentRunEntity, AgentActionEntity]), AgentRuntimeEventsModule, AgentRuntimeModule],
  providers: [AgentRunsService, AgentGoalService],
  exports: [AgentRunsService, AgentGoalService],
})
export class AgentRunsModule {}
