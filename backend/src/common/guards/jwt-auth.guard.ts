import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../../modules/auth/auth.service';
import { ApiTokenService } from '../../modules/auth/api-token.service';
import { JwtPayload } from '../interfaces/api-response.interface';

/**
 * JWT 认证守卫
 *
 * 从 Authorization: Bearer <token> 提取 token，
 * 用 AuthService.verifyToken 验签并注入 payload 到 request.user。
 *
 * 用法：在 Controller 上加 @UseGuards(JwtAuthGuard)
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly apiTokenService: ApiTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      query?: { token?: string };
      user?: JwtPayload;
    }>();

    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('missing or invalid bearer token');
    }

    let payload: JwtPayload;
    try {
      payload = await this.authService.verifyToken(token);
    } catch {
      payload = await this.apiTokenService.verifyApiToken(token);
    }

    // refresh token 仅可用于 /auth/refresh 换发，禁止访问业务接口；
    // 双 token 机制上线前的旧 token 无 type 字段，视为 access 放行
    if (payload.type === 'refresh') {
      throw new UnauthorizedException('refresh token cannot access business APIs');
    }

    request.user = payload;

    return true;
  }

  private extractToken(request: {
    headers: { authorization?: string };
    query?: { token?: string };
  }): string | null {
    const authorization = request.headers.authorization;
    if (authorization) {
      const [type, token] = authorization.split(' ');
      if (type === 'Bearer' && token) {
        return token;
      }
    }

    // 容错/SSE 支持：如果 Header 没传，尝试从 query 中获取 token
    const queryToken = request.query?.token;
    if (queryToken) {
      return queryToken;
    }

    return null;
  }
}
