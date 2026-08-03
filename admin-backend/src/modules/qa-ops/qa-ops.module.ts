import { Module } from '@nestjs/common';
import { QaOpsController } from './qa-ops.controller';
import { RagClientModule } from '../rag-client/rag-client.module';
import { PublicArtifactSharesController } from './public-artifact-shares.controller';

@Module({
  imports: [RagClientModule],
  controllers: [QaOpsController, PublicArtifactSharesController],
})
export class QaOpsModule {}
