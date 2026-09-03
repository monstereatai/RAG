import { Module } from '@nestjs/common';
import { AgentRuntimeEventsModule } from '../agent-runtime-events/agent-runtime-events.module';
import { RedisModule } from '../../providers/redis/redis.module';
import { ToolsModule } from '../../tools/tools.module';
import { AgentLoopService } from './agent-loop.service';

@Module({
  imports: [ToolsModule, AgentRuntimeEventsModule, RedisModule],
  providers: [AgentLoopService],
  exports: [AgentLoopService],
})
export class AgentLoopModule {}
