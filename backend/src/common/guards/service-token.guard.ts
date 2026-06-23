import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

/**
 * 复合认证守卫：支持 JWT token 和内部服务 token
 * - JWT: Authorization: Bearer <jwt>
 * - 服务 token: Authorization: Bearer <service_token> 或 X-Service-Token: <token>
 */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  private readonly serviceToken: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.serviceToken =
      this.configService.get<string>('RAG_SERVICE_TOKEN') ??
      process.env.RAG_SERVICE_TOKEN ??
      '';
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    const serviceTokenHeader = request.headers['x-service-token'] as
      | string
      | undefined;

    // 1. 先尝试服务 token
    const token = serviceTokenHeader ?? this.extractBearerToken(authHeader);
    if (token && this.serviceToken && token === this.serviceToken) {
      request.user = {
        userId: 'admin-backend',
        username: 'admin-backend',
        role: 'admin',
      };
      return true;
    }

    // 2. 再尝试 JWT
    if (authHeader) {
      const jwtToken = this.extractBearerToken(authHeader);
      if (jwtToken) {
        return this.jwtService
          .verifyAsync(jwtToken)
          .then((payload) => {
            request.user = payload;
            return true;
          })
          .catch(() => {
            throw new UnauthorizedException('token invalid or expired');
          });
      }
    }

    throw new UnauthorizedException('missing or invalid authentication');
  }

  private extractBearerToken(header?: string): string | null {
    if (!header) return null;
    const match = /^Bearer\s+(.+)$/i.exec(header);
    return match?.[1] ?? null;
  }
}
