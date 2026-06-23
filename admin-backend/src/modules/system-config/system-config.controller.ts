import { Controller, Get } from '@nestjs/common';
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
