import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../user/user.service';
import { PermissionService } from '../permission/permission.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly userService: UserService,
    private readonly configService: ConfigService,
    private readonly permissionService: PermissionService,
  ) {}

  /**
   * 验证用户名和密码，供 LocalStrategy 调用。
   * 返回去掉 password 的用户对象；验证失败返回 null。
   */
  async validateUser(username: string, password: string): Promise<Omit<any, 'password'> | null> {
    const user = await this.userService.validateUser(username, password);
    if (!user || user.isActive === false) {
      return null;
    }
    // 不向 passport 透传 password 字段
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _pwd, ...result } = user as any;
    return result;
  }

  /**
   * 生成 JWT access_token，payload 携带 userId / username / role / permissions。
   *
   * permissions 为用户有效权限：
   *   角色权限 ∪ 用户直赋权限（并集，见 PermissionService.resolveUserPermissionCodes）。
   * 内存模式登录时上游可能已带扁平 permissions（历史约定），为避免重复查询直接沿用。
   */
  async login(user: { id: number; username: string; role?: string; permissions?: string[] }) {
    const permissions = user.permissions?.length
      ? user.permissions
      : await this.permissionService.resolveUserPermissionCodes(user.id);

    const payload = {
      type: 'access',
      sub: user.id,
      username: user.username,
      role: user.role ?? 'user',
      permissions,
    };

    const access_token = this.jwtService.sign(payload);
    const refresh_token = this.jwtService.sign(
      { type: 'refresh', sub: user.id, username: user.username },
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
      if (data.type !== 'refresh') {
        throw new UnauthorizedException('token 失效，请重新登录');
      }
      const id = data.sub || data.userId;
      const user = id ? await this.userService.findOne(Number(id)) : await this.userService.findByUsername(data.username);

      if (!user || user.isActive === false) {
        throw new UnauthorizedException('token 失效，请重新登录');
      }

      return this.login({
        id: user.id,
        username: user.username,
        role: user.role,
        // 刷新令牌时重新解析有效权限（角色权限 ∪ 用户直赋权限），
        // 保证授权变更在 token 刷新后即时生效
        permissions: await this.permissionService.resolveUserPermissionCodes(user.id),
      });
    } catch (e) {
      throw new UnauthorizedException('token 失效，请重新登录');
    }
  }
}
