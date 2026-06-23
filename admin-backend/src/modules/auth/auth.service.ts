import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../user/user.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly userService: UserService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 验证用户名和密码，供 LocalStrategy 调用。
   * 返回去掉 password 的用户对象；验证失败返回 null。
   */
  async validateUser(username: string, password: string): Promise<Omit<any, 'password'> | null> {
    const user = await this.userService.validateUser(username, password);
    if (!user) {
      return null;
    }
    // 不向 passport 透传 password 字段
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _pwd, ...result } = user as any;
    return result;
  }

  /**
   * 生成 JWT access_token，payload 携带 userId / username / role。
   */
  async login(user: { id: number; username: string; role?: string; permissions?: string[] }) {
    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role ?? 'user',
      permissions: user.permissions ?? [],
    };

    const access_token = this.jwtService.sign(payload);
    const refresh_token = this.jwtService.sign(
      { sub: user.id, username: user.username },
      { expiresIn: (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d') as any },
    );

    return {
      access_token,
      refresh_token,
      token_type: 'Bearer',
    };
  }

  /**
   * 刷新 Token
   */
  async refreshToken(refreshToken: string) {
    try {
      const data = this.jwtService.verify(refreshToken);
      const id = data.sub || data.userId;
      const user = id ? await this.userService.findOne(Number(id)) : await this.userService.findByUsername(data.username);

      if (!user) {
        throw new UnauthorizedException('token 失效，请重新登录');
      }

      return this.login({
        id: user.id,
        username: user.username,
        role: user.role,
        permissions: await this.userService.getPermissionCodes(user.id),
      });
    } catch (e) {
      throw new UnauthorizedException('token 失效，请重新登录');
    }
  }
}
