import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionService } from './permission.service';
import { GrantUserPermissionsDto } from './dto/user-permissions.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';

/**
 * 用户直接赋权接口（admin 后台）。
 *
 * 与「角色授权」互补：这里的授权写入 user_permissions 表，
 * 登录/刷新令牌时由 PermissionService.resolveUserPermissionCodes
 * 计算并集「角色权限 ∪ 用户直赋权限」后写入 JWT。
 */
@ApiTags('admin/users/permissions')
@ApiBearerAuth()
@Controller('admin/users/:userId/permissions')
export class UserPermissionsController {
  constructor(private readonly permissionService: PermissionService) {}

  @Get()
  @ApiOperation({ summary: '查询用户直赋权限列表' })
  @RequirePermission('admin:permission:read')
  list(@Param('userId', ParseIntPipe) userId: number) {
    return this.permissionService.listUserDirectPermissions(userId);
  }

  @Post()
  @AuditLog('user-permissions', 'grant')
  @ApiOperation({ summary: '授予用户直赋权限（幂等）' })
  @RequirePermission('admin:permission:update')
  grant(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: GrantUserPermissionsDto,
  ) {
    return this.permissionService.grantToUser(userId, dto.permissionIds);
  }

  @Delete()
  @AuditLog('user-permissions', 'revoke')
  @ApiOperation({ summary: '撤销用户直赋权限' })
  @RequirePermission('admin:permission:update')
  async revoke(
    @Param('userId', ParseIntPipe) userId: number,
    // DELETE body 携带列表兼容性差，约定用 query：?permissionIds=1,2,3
    @Query('permissionIds') permissionIds?: string,
  ) {
    const ids = (permissionIds ?? '')
      .split(',')
      .map(item => Number(item.trim()))
      .filter(item => Number.isInteger(item) && item > 0);
    if (ids.length === 0) {
      throw new BadRequestException('请通过 permissionIds=1,2,3 指定要撤销的权限');
    }
    await this.permissionService.revokeFromUser(userId, ids);
    return { success: true };
  }
}
