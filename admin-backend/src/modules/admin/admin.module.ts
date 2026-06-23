import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { isDatabaseEnabled } from '../../config/runtime';
import { AdminController } from './admin.controller';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';
import { Role } from '../../database/entities/role.entity';
import { PermissionModule } from '../permission/permission.module';
import { RagClientModule } from '../rag-client/rag-client.module';
import { AdminDashboardService } from './admin-dashboard.service';

const databaseEnabled = isDatabaseEnabled();

@Module({
  imports: [
    PermissionModule,
    RagClientModule,
    ...(databaseEnabled ? [TypeOrmModule.forFeature([Role])] : []),
  ],
  controllers: [AdminController, RoleController],
  providers: [RoleService, AdminDashboardService],
  exports: [RoleService],
})
export class AdminModule {}
