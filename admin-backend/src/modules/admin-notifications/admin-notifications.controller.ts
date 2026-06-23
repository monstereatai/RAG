import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AdminNotificationsService } from './admin-notifications.service';

@ApiTags('admin-notifications')
@ApiBearerAuth()
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(private readonly notificationsService: AdminNotificationsService) {}

  @Get()
  @ApiOperation({ summary: '查看后台通知列表' })
  @RequirePermission('admin:notifications:read')
  list() {
    return this.notificationsService.list();
  }
}
