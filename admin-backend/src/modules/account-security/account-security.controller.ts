import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireLogin } from '../../common/decorators/require-login.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { UserInfo } from '../../common/decorators/user-info.decorator';
import { AccountSecurityService } from './account-security.service';

@ApiTags('admin-account-security')
@ApiBearerAuth()
@Controller()
export class AccountSecurityController {
  constructor(private readonly accountSecurityService: AccountSecurityService) {}

  @Get('admin/account-security/policy')
  @ApiOperation({ summary: '查看账号安全策略' })
  @RequirePermission('admin:account-security:read')
  getPolicy() {
    return this.accountSecurityService.getPolicy();
  }

  @Get('admin/account-security/login-attempts')
  @ApiOperation({ summary: '查看登录失败与锁定状态' })
  @RequirePermission('admin:account-security:read')
  getAttemptStatus(@Query('username') username?: string) {
    return this.accountSecurityService.getAttemptStatus(username);
  }

  @RequireLogin(false)
  @Post('auth/forgot-password')
  @ApiOperation({ summary: '忘记密码请求占位' })
  forgotPassword(@Body('usernameOrEmail') usernameOrEmail: string) {
    return this.accountSecurityService.requestPasswordReset(usernameOrEmail);
  }

  @Get('admin/account-security/mfa')
  @ApiOperation({ summary: '查看当前账号 MFA 状态' })
  getMfaStatus(@UserInfo() user: unknown) {
    return this.accountSecurityService.getMfaStatus(user);
  }

  @Post('admin/account-security/mfa/setup')
  @ApiOperation({ summary: 'MFA 设置占位' })
  startMfaSetup(@UserInfo() user: unknown) {
    return this.accountSecurityService.startMfaSetup(user);
  }
}

/** 前端 /admin/security 别名路由 */
@ApiTags('admin-security')
@ApiBearerAuth()
@Controller('admin/security')
export class AdminSecurityController {
  constructor(private readonly accountSecurityService: AccountSecurityService) {}

  @Get('policy')
  @ApiOperation({ summary: '查看账号安全策略' })
  @RequirePermission('admin:account-security:read')
  getPolicy() {
    return this.accountSecurityService.getPolicy();
  }

  @Get('login-attempts')
  @ApiOperation({ summary: '查看登录失败与锁定状态' })
  @RequirePermission('admin:account-security:read')
  getAttemptStatus(@Query('username') username?: string) {
    return this.accountSecurityService.getAttemptStatus(username);
  }

  @Get('mfa')
  @ApiOperation({ summary: '查看当前账号 MFA 状态' })
  getMfaStatus(@UserInfo() user: unknown) {
    return this.accountSecurityService.getMfaStatus(user);
  }

  @Post('mfa/setup')
  @ApiOperation({ summary: 'MFA 设置占位' })
  startMfaSetup(@UserInfo() user: unknown) {
    return this.accountSecurityService.startMfaSetup(user);
  }
}

/** 前端 /admin/account 别名路由 */
@ApiTags('admin-account')
@ApiBearerAuth()
@Controller('admin/account')
export class AdminAccountController {
  constructor(private readonly accountSecurityService: AccountSecurityService) {}

  @Get('security')
  @ApiOperation({ summary: '获取账号安全信息' })
  @RequirePermission('admin:account-security:read')
  getSecurityInfo() {
    return this.accountSecurityService.getSecurityInfo();
  }

  @Post('change-password')
  @ApiOperation({ summary: '修改密码' })
  changePassword(@Body() body: { oldPassword: string; newPassword: string }) {
    return this.accountSecurityService.changePassword(body);
  }

  @Post('two-factor')
  @ApiOperation({ summary: '切换两步验证' })
  toggleTwoFactor(@Body() body: { enabled: boolean }) {
    return this.accountSecurityService.toggleTwoFactor(body.enabled);
  }
}
