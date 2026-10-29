import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { MenusService } from './menus.service';

@ApiTags('admin-menus')
@ApiBearerAuth()
@Controller('admin/menus')
export class AdminMenusController {
  constructor(private readonly menusService: MenusService) {}

  @Get()
  @ApiOperation({ summary: '获取菜单列表' })
  @RequirePermission('admin:role:read')
  list() {
    return this.menusService.getMenuTree();
  }

  @Get('tree')
  @ApiOperation({ summary: '获取菜单树' })
  @RequirePermission('admin:role:read')
  getMenuTree() {
    return this.menusService.getMenuTree();
  }

  @Post()
  @ApiOperation({ summary: '创建菜单' })
  @RequirePermission('admin:role:create')
  create(@Body() body: { name: string; path: string; icon?: string; parentId?: string; sort?: number; visible?: boolean }) {
    return this.menusService.createMenu(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新菜单' })
  @RequirePermission('admin:role:update')
  update(@Param('id') id: string, @Body() body: { name?: string; path?: string; icon?: string; sort?: number; visible?: boolean }) {
    return this.menusService.updateMenu(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除菜单' })
  @RequirePermission('admin:role:delete')
  delete(@Param('id') id: string) {
    return this.menusService.deleteMenu(id);
  }
}
