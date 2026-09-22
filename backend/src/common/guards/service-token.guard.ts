import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const LOCAL_DEV_RAG_SERVICE_TOKEN = 'local-rag-service-token';
const MISSING_PRODUCTION_TOKEN_MESSAGE =
  'RAG_SERVICE_TOKEN is required when NODE_ENV=production';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: unknown;
}

/**
 * 内部服务令牌守卫。
 *
 * 这里故意不接受用户 JWT。管理、运维和跨服务接口通常带有 userId、runId
 * 或租户范围参数，若把普通 JWT 当作服务身份放行，会把内部接口变成 IDOR
 * 入口。需要用户身份的接口应显式使用 JwtAuthGuard。
 * - 服务 token: Authorization: Bearer <service_token> 或 X-Service-Token: <token>
 */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  private readonly serviceToken: string;

  constructor(
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

    const token = serviceTokenHeader ?? this.extractBearerToken(authHeader);
    if (token && this.serviceToken && token === this.serviceToken) {
      request.user = {
        userId: 'admin-backend',
        username: 'admin-backend',
        role: 'admin',
        authType: 'service',
      };
      return true;
    }

    throw new UnauthorizedException('invalid internal service authentication');
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
