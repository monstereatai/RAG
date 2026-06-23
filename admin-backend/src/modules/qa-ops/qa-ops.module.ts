import { Module } from '@nestjs/common';
import { QaOpsController } from './qa-ops.controller';
import { RagClientModule } from '../rag-client/rag-client.module';

@Module({
  imports: [RagClientModule],
  controllers: [QaOpsController],
})
export class QaOpsModule {}
