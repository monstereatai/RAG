import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { ShortTermMemoryService } from './short-term-memory.service';
import { MemoryController } from './memory.controller';
import { LlmModule } from '../../providers/llm/llm.module';
import { AgentRuntimeEventsModule } from '../agent-runtime-events/agent-runtime-events.module';

@Module({
  imports: [LlmModule, AgentRuntimeEventsModule],
  controllers: [MemoryController],
  providers: [MemoryService, ShortTermMemoryService],
  exports: [MemoryService, ShortTermMemoryService],
})
export class MemoryModule {}
