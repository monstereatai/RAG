import { Module } from '@nestjs/common';
import { RagClientModule } from '../rag-client/rag-client.module';
import { AgentOpsController } from './agent-ops.controller';

@Module({
  imports: [RagClientModule],
  controllers: [AgentOpsController],
})
export class AgentOpsModule {}
