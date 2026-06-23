import { Module } from '@nestjs/common';
import { SystemConfigController, AdminConfigController } from './system-config.controller';
import { SystemConfigService } from './system-config.service';

@Module({
  controllers: [SystemConfigController, AdminConfigController],
  providers: [SystemConfigService],
})
export class SystemConfigModule {}
