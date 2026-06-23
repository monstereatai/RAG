import { Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
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
  list(@Query() query: any) {
    return this.notificationsService.list(query);
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

  @Patch(':id/read')
  @AuditLog('notifications', 'mark-read-patch')
  @ApiOperation({ summary: '标记单条通知已读（PATCH）' })
  @RequirePermission('admin:notifications:write')
  markReadPatch(@Param('id') id: string) {
    return this.notificationsService.markRead(id);
  }

  @Post('read-all')
  @AuditLog('notifications', 'mark-all-read')
  @ApiOperation({ summary: '标记全部通知已读' })
  @RequirePermission('admin:notifications:write')
  markAllRead() {
    return this.notificationsService.markAllRead();
  }

  @Patch('read-all')
  @AuditLog('notifications', 'mark-all-read-patch')
  @ApiOperation({ summary: '标记全部通知已读（PATCH）' })
  @RequirePermission('admin:notifications:write')
  markAllReadPatch() {
    return this.notificationsService.markAllRead();
  }

  @Delete(':id')
  @AuditLog('notifications', 'delete')
  @ApiOperation({ summary: '删除通知' })
  @RequirePermission('admin:notifications:write')
  delete(@Param('id') id: string) {
    return this.notificationsService.delete(id);
  }
}
