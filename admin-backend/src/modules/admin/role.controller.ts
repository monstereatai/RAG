import { Controller, Get, Post, Body, Param, Put, Delete, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RoleService } from './role.service';
import { CreateRoleDto, UpdateRoleDto, AssignPermissionsDto } from './dto/role.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';

@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Post()
  @ApiOperation({ summary: '创建角色' })
  @RequirePermission('admin:role:create')
  @AuditLog('角色管理', '创建')
  create(@Body() createRoleDto: CreateRoleDto) {
    return this.roleService.create(createRoleDto);
  }

  @Get()
  @ApiOperation({ summary: '获取所有角色列表' })
  @RequirePermission('admin:role:read')
  findAll() {
    return this.roleService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: '获取单个角色详情' })
  @RequirePermission('admin:role:read')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.roleService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新角色' })
  @RequirePermission('admin:role:update')
  @AuditLog('角色管理', '更新')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateRoleDto: UpdateRoleDto,
  ) {
    return this.roleService.update(id, updateRoleDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除角色' })
  @RequirePermission('admin:role:delete')
  @AuditLog('角色管理', '删除')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.roleService.remove(id);
  }

  @Post(':id/permissions')
  @ApiOperation({ summary: '为角色分配权限' })
  @RequirePermission('admin:role:assign')
  @AuditLog('角色管理', '分配权限')
  assignPermissions(
    @Param('id', ParseIntPipe) id: number,
    @Body() assignPermissionsDto: AssignPermissionsDto,
  ) {
    return this.roleService.assignPermissions(id, assignPermissionsDto);
  }
}
