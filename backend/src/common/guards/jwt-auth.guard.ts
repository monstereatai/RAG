import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../../modules/auth/auth.service';
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
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: JwtPayload;
    }>();

    const token = this.extractToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('missing or invalid bearer token');
    }

    const payload = await this.authService.verifyToken(token);
    request.user = payload;

    return true;
  }

  private extractToken(authorization?: string): string | null {
    if (!authorization) {
      return null;
    }
    const [type, token] = authorization.split(' ');
    if (type !== 'Bearer' || !token) {
      return null;
    }
    return token;
  }
}
