import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { UserInfo } from '../../common/decorators/user-info.decorator';
import { AdminMenusService } from './admin-menus.service';

@ApiTags('admin-menus')
@ApiBearerAuth()
@Controller('admin/menus')
export class AdminMenusController {
  constructor(private readonly adminMenusService: AdminMenusService) {}

  @Get('tree')
  @ApiOperation({ summary: '查看管理后台菜单树' })
  @RequirePermission('admin:system:read')
  getTree() {
    return this.adminMenusService.getTree();
  }

  @Get('sidebar')
  @ApiOperation({ summary: '查看当前用户可见侧边栏菜单' })
  getSidebar(@UserInfo('permissions') permissions: string[] | null) {
    return this.adminMenusService.getSidebar(permissions ?? []);
  }

  @Get('button-permissions')
  @ApiOperation({ summary: '查看后台按钮权限点' })
  @RequirePermission('admin:system:read')
  getButtonPermissions() {
    return this.adminMenusService.getButtonPermissions();
  }
}
