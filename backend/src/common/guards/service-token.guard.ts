import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

const LOCAL_DEV_RAG_SERVICE_TOKEN = 'local-rag-service-token';
const MISSING_PRODUCTION_TOKEN_MESSAGE =
  'RAG_SERVICE_TOKEN is required when NODE_ENV=production';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: unknown;
}

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
    this.serviceToken = this.resolveServiceToken();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = this.firstHeader(request.headers.authorization);
    const serviceTokenHeader = this.firstHeader(
      request.headers['x-service-token'],
    );

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

  private firstHeader(value?: string | string[]): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }

  private resolveServiceToken(): string {
    const configured =
      this.configService.get<string>('RAG_SERVICE_TOKEN') ??
      process.env.RAG_SERVICE_TOKEN ??
      '';
    if (configured.trim()) {
      return configured.trim();
    }

    const nodeEnv =
      this.configService.get<string>('nodeEnv') ??
      this.configService.get<string>('NODE_ENV') ??
      process.env.NODE_ENV ??
      'development';
    if (nodeEnv === 'production') {
      throw new Error(MISSING_PRODUCTION_TOKEN_MESSAGE);
    }

    return LOCAL_DEV_RAG_SERVICE_TOKEN;
  }
}
