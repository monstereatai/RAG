import { Controller, Post, Get, Query, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './local-auth.guard';
import { LoginDto } from './dto/login.dto';
import { LoginVo } from './vo/login.vo';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RequireLogin } from '../../common/decorators/require-login.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @RequireLogin(false)
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @AuditLog('auth', 'login')
  @ApiOperation({ summary: '用户登录', description: '使用用户名和密码获取 JWT access_token' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description: '登录成功，返回 access_token 和 refresh_token',
    type: LoginVo,
  })
  @ApiResponse({ status: 401, description: '用户名或密码错误' })
  async login(@Request() req: any) {
    return this.authService.login(req.user);
  }

  @RequireLogin(false)
  @Get('refresh')
  @AuditLog('auth', 'refresh')
  @ApiOperation({ summary: '刷新 Token', description: '使用 refresh_token 获取新的 access_token' })
  @ApiResponse({ status: 200, description: '刷新成功', type: LoginVo })
  @ApiResponse({ status: 401, description: 'refresh_token 失效' })
  async refresh(@Query() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshToken(refreshTokenDto.refresh_token);
  }
}
