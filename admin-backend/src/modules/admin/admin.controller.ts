import { Controller, Get, Patch, Body, Query, UseGuards, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../permission/roles.guard';
import { AdminDashboardService } from './admin-dashboard.service';
import { UserInfo } from '../../common/decorators/user-info.decorator';

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

  @Get('dashboard/overview')
  @ApiOperation({ summary: '大盘概览数据（前端 dashboard service）' })
  getDashboardOverview() {
    return this.dashboardService.overview();
  }

  @Get('dashboard/trend')
  @ApiOperation({ summary: '大盘趋势数据' })
  getDashboardTrend(@Query('days') days?: number) {
    return this.dashboardService.trend(days ? Number(days) : 7);
  }

  @Get('features')
  @ApiOperation({ summary: '管理后台功能完成度总览' })
  getFeatures() {
    return this.dashboardService.features();
  }

  @Get('profile')
  @ApiOperation({ summary: '当前管理员个人中心基础信息' })
  getProfile(@UserInfo() user: unknown) {
    return this.dashboardService.profile(user);
  }

  @Patch('profile')
  @ApiOperation({ summary: '更新当前管理员个人资料' })
  updateProfile(@UserInfo() user: unknown, @Body() body: { nickname?: string; email?: string; phone?: string }) {
    return this.dashboardService.updateProfile(user, body);
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
