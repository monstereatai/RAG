import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentRuntimeEventEntity } from '../../providers/db/entities/agent-runtime-event.entity';
import { AgentRuntimeEventsService } from './agent-runtime-events.service';

@Module({ imports: [TypeOrmModule.forFeature([AgentRuntimeEventEntity])], providers: [AgentRuntimeEventsService], exports: [AgentRuntimeEventsService] })
export class AgentRuntimeEventsModule {}
