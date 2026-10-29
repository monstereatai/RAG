import { Module } from '@nestjs/common';
import { GraphOpsController } from './graph-ops.controller';
import { GraphOpsMockService } from './graph-ops-mock.service';
import { RagClientModule } from '../rag-client/rag-client.module';

@Module({
  imports: [RagClientModule],
  controllers: [GraphOpsController],
  providers: [GraphOpsMockService],
})
export class GraphOpsModule {}
