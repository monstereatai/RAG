import { Module } from '@nestjs/common';
import { QaOpsController } from './qa-ops.controller';
import { RagClientModule } from '../rag-client/rag-client.module';
import { PublicArtifactSharesController } from './public-artifact-shares.controller';
import { QaOpsAguiStreamProxyService } from './qa-ops-agui-stream-proxy.service';

@Module({
  imports: [RagClientModule],
  controllers: [QaOpsController, PublicArtifactSharesController],
  providers: [QaOpsAguiStreamProxyService],
})
export class QaOpsModule {}
