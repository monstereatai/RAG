import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { ShortTermMemoryService } from './short-term-memory.service';
import { MemoryController } from './memory.controller';
import { LlmModule } from '../../providers/llm/llm.module';

@Module({
  imports: [LlmModule],
  controllers: [MemoryController],
  providers: [MemoryService, ShortTermMemoryService],
  exports: [MemoryService, ShortTermMemoryService],
})
export class MemoryModule {}
