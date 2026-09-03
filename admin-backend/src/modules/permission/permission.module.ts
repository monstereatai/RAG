import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { isDatabaseEnabled } from '../../config/runtime';
import { PermissionService } from './permission.service';
import { PermissionController } from './permission.controller';
import { UserPermissionsController } from './user-permissions.controller';
import { Permission } from '../../database/entities/permission.entity';
import { UserPermission } from '../../database/entities/user-permission.entity';
import { UserModule } from '../user/user.module';

const databaseEnabled = isDatabaseEnabled();

@Module({
  imports: [
    // UserModule 提供 UserService：用于「用户是否存在」校验与角色权限展开
    UserModule,
    ...(databaseEnabled
      ? [TypeOrmModule.forFeature([Permission, UserPermission])]
      : []),
  ],
  controllers: [PermissionController, UserPermissionsController],
  providers: [PermissionService],
  exports: [PermissionService, ...(databaseEnabled ? [TypeOrmModule] : [])],
})
export class PermissionModule {}
