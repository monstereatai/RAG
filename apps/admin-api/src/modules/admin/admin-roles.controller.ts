import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Patch,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RoleService } from './role.service';
import { CreateRoleDto, UpdateRoleDto, AssignPermissionsDto } from './dto/role.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';

@ApiTags('admin/roles')
@ApiBearerAuth()
@Controller('admin/roles')
export class AdminRolesController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  @ApiOperation({ summary: '获取角色列表（管理后台）' })
  @RequirePermission('admin:role:read')
  async findAll() {
    const roles = await this.roleService.findAll();
    return {
      data: roles.map((r: any) => ({
        id: String(r.id),
        name: r.name,
        description: r.description ?? null,
        permissions: (r.permissions || []).map((p: any) => ({
          id: String(p.id),
          code: p.code,
          name: p.name,
        })),
        userCount: (r as any).userCount ?? 0,
        createdAt: r.createdAt?.toISOString?.() ?? r.createdAt,
      })),
      total: roles.length,
    };
  }

  @Post()
  @AuditLog('admin/roles', 'create')
  @ApiOperation({ summary: '创建角色（管理后台）' })
  @RequirePermission('admin:role:create')
  async create(@Body() createRoleDto: CreateRoleDto) {
    return this.roleService.create(createRoleDto);
  }

  @Patch(':id')
  @AuditLog('admin/roles', 'update')
  @ApiOperation({ summary: '更新角色（管理后台）' })
  @RequirePermission('admin:role:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateRoleDto: UpdateRoleDto,
  ) {
    return this.roleService.update(id, updateRoleDto);
  }

  @Delete(':id')
  @AuditLog('admin/roles', 'delete')
  @ApiOperation({ summary: '删除角色（管理后台）' })
  @RequirePermission('admin:role:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.roleService.remove(id);
  }

  @Post(':id/permissions')
  @AuditLog('admin/roles', 'assign-permissions')
  @ApiOperation({ summary: '为角色分配权限（管理后台）' })
  @RequirePermission('admin:role:assign')
  async assignPermissions(
    @Param('id', ParseIntPipe) id: number,
    @Body() assignPermissionsDto: AssignPermissionsDto,
  ) {
    return this.roleService.assignPermissions(id, assignPermissionsDto);
  }
}
