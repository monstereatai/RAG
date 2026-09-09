import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentTaskEntity } from '../../providers/db/entities/agent-task.entity';
import { AgentTasksService } from './agent-tasks.service';
import { AgentRuntimeEventsModule } from '../agent-runtime-events/agent-runtime-events.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AgentTaskEntity]),
    AgentRuntimeEventsModule,
  ],
  providers: [AgentTasksService],
  exports: [AgentTasksService],
})
export class AgentTasksModule {}
