import { Module } from '@nestjs/common';
import { SystemConfigController, AdminConfigController } from './system-config.controller';
import { SystemConfigService } from './system-config.service';
import { RagClientModule } from '../rag-client/rag-client.module';

@Module({
  imports: [RagClientModule],
  controllers: [SystemConfigController, AdminConfigController],
  providers: [SystemConfigService],
})
export class SystemConfigModule {}
