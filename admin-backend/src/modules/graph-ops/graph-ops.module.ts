import { Module } from '@nestjs/common';
import { GraphOpsController } from './graph-ops.controller';
import { RagClientModule } from '../rag-client/rag-client.module';

@Module({
  imports: [RagClientModule],
  controllers: [GraphOpsController],
})
export class GraphOpsModule {}
