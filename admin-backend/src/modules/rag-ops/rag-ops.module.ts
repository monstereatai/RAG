import { Module } from '@nestjs/common';
import { RagClientModule } from '../rag-client/rag-client.module';
import { RagOpsController } from './rag-ops.controller';

@Module({
  imports: [RagClientModule],
  controllers: [RagOpsController],
})
export class RagOpsModule {}
