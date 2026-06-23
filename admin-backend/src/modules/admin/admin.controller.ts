import { Controller, Get, UseGuards, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../permission/roles.guard';
import { AdminDashboardService } from './admin-dashboard.service';

export const Roles = (...roles: string[]) => SetMetadata('roles', roles);

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminController {
  constructor(private readonly dashboardService: AdminDashboardService) {}

  @Get('dashboard')
  @ApiOperation({ summary: '管理后台首页大盘' })
  @Roles('admin')
  @UseGuards(RolesGuard)
  getDashboard() {
    return this.dashboardService.overview();
  }

  @Get('boundary')
  @ApiOperation({ summary: '管理后台服务边界说明' })
  getBoundary() {
    return {
      service: 'admin-backend',
      owns: [
        'users',
        'roles',
        'permissions',
        'dashboard',
        'documents',
        'audit-logs',
        'notifications',
        'system-config',
      ],
      calls: ['rag-backend:http-api'],
      doesNotOwn: [
        'rag-retrieval',
        'document-ingestion',
        'agent-workflow',
        'vector-store-provider',
        'graphrag-runtime',
      ],
      sharedPackage: false,
    };
  }
}
