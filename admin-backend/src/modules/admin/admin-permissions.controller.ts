import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Patch,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PermissionService } from '../permission/permission.service';
import { CreatePermissionDto, UpdatePermissionDto } from '../permission/dto/permission.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';

@ApiTags('admin/permissions')
@ApiBearerAuth()
@Controller('admin/permissions')
export class AdminPermissionsController {
  constructor(private readonly permissionService: PermissionService) {}

  @Get()
  @ApiOperation({ summary: '获取权限列表（管理后台）' })
  @RequirePermission('admin:permission:read')
  async findAll(@Query() query: any) {
    const permissions = await this.permissionService.findAll();
    const page = Number(query.current) || 1;
    const pageSize = Number(query.pageSize) || 10;
    const start = (page - 1) * pageSize;
    const filtered = query.module
      ? permissions.filter((p: any) => p.module === query.module)
      : permissions;
    return {
      data: filtered.slice(start, start + pageSize).map((p: any) => ({
        id: String(p.id),
        code: p.code,
        name: p.name,
        module: p.module ?? null,
        description: p.description ?? null,
      })),
      total: filtered.length,
    };
  }

  @Post()
  @AuditLog('admin/permissions', 'create')
  @ApiOperation({ summary: '创建权限（管理后台）' })
  @RequirePermission('admin:permission:create')
  async create(@Body() createPermissionDto: CreatePermissionDto) {
    return this.permissionService.create(createPermissionDto);
  }

  @Patch(':id')
  @AuditLog('admin/permissions', 'update')
  @ApiOperation({ summary: '更新权限（管理后台）' })
  @RequirePermission('admin:permission:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updatePermissionDto: UpdatePermissionDto,
  ) {
    return this.permissionService.update(id, updatePermissionDto);
  }

  @Delete(':id')
  @AuditLog('admin/permissions', 'delete')
  @ApiOperation({ summary: '删除权限（管理后台）' })
  @RequirePermission('admin:permission:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.permissionService.remove(id);
  }
}
