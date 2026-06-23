import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Patch,
  Query,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserService } from '../user/user.service';
import { CreateUserDto } from '../user/dto/create-user.dto';
import { UpdateUserDto } from '../user/dto/update-user.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';

@ApiTags('admin/users')
@ApiBearerAuth()
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @ApiOperation({ summary: '获取用户列表（管理后台）' })
  @RequirePermission('admin:role:read')
  async findAll(@Query() query: any) {
    const users = await this.userService.findAll();
    const page = Number(query.current) || 1;
    const pageSize = Number(query.pageSize) || 10;
    const start = (page - 1) * pageSize;
    const filtered = query.username
      ? users.filter((u: any) => u.username?.includes(query.username))
      : users;
    const filteredByStatus = query.status
      ? filtered.filter((u: any) => {
          if (query.status === 'active') return u.isActive;
          if (query.status === 'inactive') return !u.isActive;
          if (query.status === 'locked') return (u as any).locked;
          return true;
        })
      : filtered;
    return {
      data: filteredByStatus.slice(start, start + pageSize).map((u: any) => ({
        id: String(u.id),
        username: u.username,
        email: u.email,
        phone: u.phone ?? null,
        status: u.isActive ? 'active' : (u as any).locked ? 'locked' : 'inactive',
        roles: (u.roles || []).map((r: any) => ({
          id: String(r.id ?? r),
          name: r.name ?? r,
        })),
        createdAt: u.createdAt?.toISOString?.() ?? u.createdAt,
        lastLoginAt: u.lastLoginAt?.toISOString?.() ?? null,
      })),
      total: filteredByStatus.length,
    };
  }

  @Post()
  @AuditLog('admin/users', 'create')
  @ApiOperation({ summary: '创建用户（管理后台）' })
  @RequirePermission('admin:role:create')
  async create(@Body() createUserDto: CreateUserDto) {
    const user = await this.userService.create(createUserDto);
    const { password: _pwd, ...safeUser } = user as any;
    return safeUser;
  }

  @Patch(':id')
  @AuditLog('admin/users', 'update')
  @ApiOperation({ summary: '更新用户（管理后台）' })
  @RequirePermission('admin:role:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.userService.update(id, updateUserDto);
  }

  @Delete(':id')
  @AuditLog('admin/users', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除用户（管理后台）' })
  @RequirePermission('admin:role:delete')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.userService.remove(id);
  }

  @Post(':id/reset-password')
  @AuditLog('admin/users', 'reset-password')
  @ApiOperation({ summary: '重置用户密码（管理后台）' })
  @RequirePermission('admin:role:update')
  async resetPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { password: string },
  ) {
    await this.userService.update(id, { password: body.password } as any);
    return { success: true };
  }
}
