import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
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

  @Get('unread-count')
  @ApiOperation({ summary: '查看后台未读通知数量' })
  @RequirePermission('admin:notifications:read')
  unreadCount() {
    return this.notificationsService.unreadCount();
  }

  @Post(':id/read')
  @AuditLog('notifications', 'mark-read')
  @ApiOperation({ summary: '标记单条通知已读' })
  @RequirePermission('admin:notifications:write')
  markRead(@Param('id') id: string) {
    return this.notificationsService.markRead(id);
  }

  @Post('read-all')
  @AuditLog('notifications', 'mark-all-read')
  @ApiOperation({ summary: '标记全部通知已读' })
  @RequirePermission('admin:notifications:write')
  markAllRead() {
    return this.notificationsService.markAllRead();
  }
}
