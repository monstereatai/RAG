import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { MemoryConsolidationService } from './memory-consolidation.service';
import { ShortTermMemoryService } from './short-term-memory.service';
import { MemoryController } from './memory.controller';
import { LlmModule } from '../../providers/llm/llm.module';
import { AgentRuntimeEventsModule } from '../agent-runtime-events/agent-runtime-events.module';
import { MetricsModule } from '../metrics/metrics.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationEntity } from '../../providers/db/entities/conversation.entity';
import { MessageEntity } from '../../providers/db/entities/message.entity';
import { UserEntity } from '../../providers/db/entities/user.entity';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { RedisModule } from '../../providers/redis/redis.module';

@Module({
  imports: [
    LlmModule,
    AgentRuntimeEventsModule,
    MetricsModule,
    DomainEventsModule,
    RedisModule,
    TypeOrmModule.forFeature([ConversationEntity, MessageEntity, UserEntity]),
  ],
  controllers: [MemoryController],
  providers: [
    MemoryService,
    MemoryConsolidationService,
    ShortTermMemoryService,
  ],
  exports: [MemoryService, ShortTermMemoryService],
})
export class MemoryModule {}
