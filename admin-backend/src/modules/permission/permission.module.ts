import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { isDatabaseEnabled } from '../../config/runtime';
import { PermissionService } from './permission.service';
import { PermissionController } from './permission.controller';
import { Permission } from '../../database/entities/permission.entity';

const databaseEnabled = isDatabaseEnabled();

@Module({
  imports: databaseEnabled ? [TypeOrmModule.forFeature([Permission])] : [],
  controllers: [PermissionController],
  providers: [PermissionService],
  exports: [PermissionService, ...(databaseEnabled ? [TypeOrmModule] : [])],
})
export class PermissionModule {}
