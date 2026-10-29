import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ServiceTokenGuard } from './service-token.guard';

/**
 * API Token 管理是唯一同时服务于管理后台和用户个人设置的边界：
 * - Admin Backend 使用内部服务令牌；
 * - 用户端使用自己的 JWT，ApiTokenService 仍按 userId 做归属过滤。
 * 其他管理／运维接口不能复用这个兼容守卫，避免重新引入 JWT 绕过。
 */
@Injectable()
export class ApiTokenAccessGuard implements CanActivate {
  constructor(
    private readonly serviceTokenGuard: ServiceTokenGuard,
    private readonly jwtAuthGuard: JwtAuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return await this.serviceTokenGuard.canActivate(context);
    } catch {
      return this.jwtAuthGuard.canActivate(context);
    }
  }
}
