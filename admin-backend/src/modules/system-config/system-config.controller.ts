import { Controller, Get, Param, Patch, Body } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SystemConfigService } from './system-config.service';

@ApiTags('admin-system-config')
@ApiBearerAuth()
@Controller('admin/system-config')
export class SystemConfigController {
  constructor(private readonly systemConfigService: SystemConfigService) {}

  @Get()
  @ApiOperation({ summary: '查看后台系统配置状态' })
  @RequirePermission('admin:system:read')
  overview() {
    return this.systemConfigService.getOverview();
  }
}

@ApiTags('admin-config')
@ApiBearerAuth()
@Controller('admin/config')
export class AdminConfigController {
  constructor(private readonly systemConfigService: SystemConfigService) {}

  @Get()
  @ApiOperation({ summary: '获取系统配置列表（前端 system-config 页面）' })
  @RequirePermission('admin:system:read')
  list() {
    return this.systemConfigService.getConfigList();
  }

  @Patch(':key')
  @ApiOperation({ summary: '更新配置项' })
  @RequirePermission('admin:system:read')
  update(@Param('key') key: string, @Body() body: { value: string }) {
    return this.systemConfigService.updateConfig(key, body.value);
  }
}
