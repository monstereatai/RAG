import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { RequireLogin } from '../../common/decorators/require-login.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';

@ApiTags('users')
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * 注册新用户，公开接口（无需 token）。
   */
  @Post()
  @RequireLogin(false)
  @AuditLog('users', 'create')
  @ApiOperation({ summary: '注册用户', description: '创建新用户账号，不需要认证' })
  @ApiResponse({ status: 201, description: '用户创建成功' })
  @ApiResponse({ status: 400, description: '参数校验失败' })
  async create(@Body() createUserDto: CreateUserDto) {
    // Public registration may never choose a privileged legacy role.
    const user = await this.userService.create({ ...createUserDto, role: 'user' });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _pwd, ...safeUser } = user as any;
    return safeUser;
  }

  /**
   * 以下路由均需要 JWT token。
   */
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前登录用户信息', description: '需要登录' })
  @ApiResponse({ status: 200, description: '成功返回当前用户信息' })
  @ApiResponse({ status: 401, description: '未认证' })
  async findMe(@Req() req: any) {
    const userId = req.user?.userId ?? req.user?.sub;
    if (!userId) {
      return { data: null };
    }
    try {
      const user = await this.userService.findOne(Number(userId));
      const { password: _pwd, ...safeUser } = user as any;
      return { data: safeUser };
    } catch {
      return { data: null };
    }
  }

  @Get()
  @RequirePermission('admin:role:read')
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取所有用户列表', description: '需要登录' })
  @ApiResponse({ status: 200, description: '成功返回用户列表' })
  @ApiResponse({ status: 401, description: '未认证' })
  async findAll() {
    return (await this.userService.findAll()).map((user: any) => {
      const safeUser = { ...user };
      delete safeUser.password;
      return safeUser;
    });
  }

  @Get(':id')
  @RequirePermission('admin:role:read')
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取单个用户', description: '需要登录' })
  @ApiParam({ name: 'id', type: Number, description: '用户 ID' })
  @ApiResponse({ status: 200, description: '成功返回用户信息' })
  @ApiResponse({ status: 401, description: '未认证' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const user = await this.userService.findOne(id);
    if (!user) return null;
    const safeUser = { ...user };
    delete (safeUser as any).password;
    return safeUser;
  }

  @Put(':id')
  @RequirePermission('admin:role:update')
  @AuditLog('users', 'update')
  @ApiBearerAuth()
  @ApiOperation({ summary: '更新用户信息', description: '需要登录' })
  @ApiParam({ name: 'id', type: Number, description: '用户 ID' })
  @ApiResponse({ status: 200, description: '成功更新用户' })
  @ApiResponse({ status: 401, description: '未认证' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    const user = await this.userService.update(id, updateUserDto);
    if (!user) return null;
    const safeUser = { ...user };
    delete (safeUser as any).password;
    return safeUser;
  }

  @Delete(':id')
  @RequirePermission('admin:role:delete')
  @AuditLog('users', 'delete')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除用户', description: '需要登录' })
  @ApiParam({ name: 'id', type: Number, description: '用户 ID' })
  @ApiResponse({ status: 204, description: '成功删除用户' })
  @ApiResponse({ status: 401, description: '未认证' })
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.userService.remove(id);
  }
}
