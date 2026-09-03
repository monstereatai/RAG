import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { ApiTokenService } from './api-token.service';
import { LoginDto, RefreshTokenDto } from './dto/login.dto';
import type { LoginResponse } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import type { RegisterResponse } from './dto/register.dto';
import {
  PasswordResetCodeDto,
  PasswordResetDto,
} from './dto/password-reset.dto';
import type {
  PasswordResetCodeResponse,
  PasswordResetResponse,
  VerifyEmailResponse,
} from './dto/password-reset.dto';
import { CreateApiTokenDto } from './dto/api-token.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ServiceTokenGuard } from '../../common/guards/service-token.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/interfaces/api-response.interface';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly apiTokenService: ApiTokenService,
  ) {}

  @Post('login')
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.authService.login(dto);
  }

  /**
   * 注册新用户并发送激活邮件（emailVerified=false，激活后才能登录）
   */
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<RegisterResponse> {
    return this.authService.register(dto);
  }

  /**
   * 邮箱激活：消费注册时邮件里的一次性激活 token
   * （链接来自激活邮件，形如 {AUTH_EMAIL_LINK_BASE_URL}/api/v1/auth/verify-email?token=xxx）
   */
  @Get('verify-email')
  verifyEmail(@Query('token') token: string): Promise<VerifyEmailResponse> {
    return this.authService.verifyEmail(token ?? '');
  }

  /**
   * 发送密码重置验证码（6 位数字，10 分钟有效）
   * 邮箱不存在时返回与成功一致的响应，防止枚举注册邮箱
   */
  @Post('password/reset-code')
  sendPasswordResetCode(
    @Body() dto: PasswordResetCodeDto,
  ): Promise<PasswordResetCodeResponse> {
    return this.authService.sendPasswordResetCode(dto);
  }

  /**
   * 验证码重置密码：校验通过即更新口令并删除验证码
   */
  @Post('password/reset')
  resetPassword(@Body() dto: PasswordResetDto): Promise<PasswordResetResponse> {
    return this.authService.resetPassword(dto);
  }

  /**
   * 刷新双 token：携带 refresh token 换发新的 access + refresh
   * 注意不挂 JwtAuthGuard——refresh token 会被业务 Guard 以 401 拒绝
   */
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto): Promise<LoginResponse> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  profile(@CurrentUser() user: JwtPayload): JwtPayload {
    return user;
  }

  @Get('api-tokens')
  @UseGuards(ServiceTokenGuard)
  listApiTokens(@CurrentUser() user: JwtPayload) {
    return this.apiTokenService.listTokens(user);
  }

  @Post('api-tokens')
  @UseGuards(ServiceTokenGuard)
  createApiToken(
    @Body() dto: CreateApiTokenDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.apiTokenService.createToken(dto, user);
  }

  @Delete('api-tokens/:id')
  @UseGuards(ServiceTokenGuard)
  revokeApiToken(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.apiTokenService.revokeToken(id, user);
  }
}
