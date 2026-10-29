import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentRuntimeEventEntity } from '../../providers/db/entities/agent-runtime-event.entity';
import { AgentRuntimeEventSequenceEntity } from '../../providers/db/entities/agent-runtime-event-sequence.entity';
import { AgentRuntimeEventsService } from './agent-runtime-events.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AgentRuntimeEventEntity,
      AgentRuntimeEventSequenceEntity,
    ]),
  ],
  providers: [AgentRuntimeEventsService],
  exports: [AgentRuntimeEventsService],
})
export class AgentRuntimeEventsModule {}
