import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { isDatabaseEnabled } from '../../config/runtime';
import { AdminController } from './admin.controller';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';
import { Role } from '../../database/entities/role.entity';
import { PermissionModule } from '../permission/permission.module';
import { UserModule } from '../user/user.module';
import { RagClientModule } from '../rag-client/rag-client.module';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminRolesController } from './admin-roles.controller';
import { AdminPermissionsController } from './admin-permissions.controller';
import { AdminOrganizationsController } from './admin-organizations.controller';

const databaseEnabled = isDatabaseEnabled();

@Module({
  imports: [
    PermissionModule,
    UserModule,
    RagClientModule,
    ...(databaseEnabled ? [TypeOrmModule.forFeature([Role])] : []),
  ],
  controllers: [
    AdminController,
    RoleController,
    AdminUsersController,
    AdminRolesController,
    AdminPermissionsController,
    AdminOrganizationsController,
  ],
  providers: [RoleService, AdminDashboardService],
  exports: [RoleService],
})
export class AdminModule {}
