import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from './auth.service';
import { AccountSecurityService } from '../account-security/account-security.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly authService: AuthService,
    private readonly accountSecurityService: AccountSecurityService,
  ) {
    super({ usernameField: 'username' });
  }

  async validate(username: string, password: string): Promise<any> {
    this.accountSecurityService.assertCanLogin(username);

    const user = await this.authService.validateUser(username, password);
    if (!user) {
      this.accountSecurityService.recordLoginFailure(username);
      throw new UnauthorizedException('用户名或密码错误');
    }

    this.accountSecurityService.recordLoginSuccess(username);
    return user;
  }
}
