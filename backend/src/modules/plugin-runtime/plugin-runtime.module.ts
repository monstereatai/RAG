import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformPluginEntity } from '../../providers/db/entities/platform-plugin.entity';
import { PluginRuntimeService } from './plugin-runtime.service';

@Module({
  imports: [TypeOrmModule.forFeature([PlatformPluginEntity])],
  providers: [PluginRuntimeService],
  exports: [PluginRuntimeService],
})
export class PluginRuntimeModule {}
