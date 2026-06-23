import { Module } from '@nestjs/common';
import { RagClientModule } from '../rag-client/rag-client.module';
import { RagOpsController, RagOpsAliasController } from './rag-ops.controller';

@Module({
  imports: [RagClientModule],
  controllers: [RagOpsController, RagOpsAliasController],
})
export class RagOpsModule {}
