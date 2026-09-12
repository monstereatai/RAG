import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { ShortTermMemoryService } from './short-term-memory.service';
import { MemoryController } from './memory.controller';
import { LlmModule } from '../../providers/llm/llm.module';
import { AgentRuntimeEventsModule } from '../agent-runtime-events/agent-runtime-events.module';
import { MetricsModule } from '../metrics/metrics.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationEntity } from '../../providers/db/entities/conversation.entity';
import { MessageEntity } from '../../providers/db/entities/message.entity';

@Module({
  imports: [
    LlmModule,
    AgentRuntimeEventsModule,
    MetricsModule,
    TypeOrmModule.forFeature([ConversationEntity, MessageEntity]),
  ],
  controllers: [MemoryController],
  providers: [MemoryService, ShortTermMemoryService],
  exports: [MemoryService, ShortTermMemoryService],
})
export class MemoryModule {}
