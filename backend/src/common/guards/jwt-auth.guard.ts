import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../../modules/auth/auth.service';
import { ApiTokenService } from '../../modules/auth/api-token.service';
import { JwtPayload } from '../interfaces/api-response.interface';
import { SseTicketService } from '../../modules/auth/sse-ticket.service';
import { API_SCOPES_KEY } from '../decorators/api-scopes.decorator';

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
    private readonly sseTicketService: SseTicketService,
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      query?: { ticket?: string };
      user?: JwtPayload;
    }>();

    const ticket = request.query?.ticket;
    let payload: JwtPayload | null = null;
    if (ticket) {
      payload = await this.sseTicketService.consume(ticket);
      if (!payload) {
        throw new UnauthorizedException('missing or invalid stream ticket');
      }
    }

    const token = this.extractBearerToken(request);
    if (!payload && !token) {
      throw new UnauthorizedException('missing or invalid bearer token');
    }

    if (!payload && token) {
      try {
        payload = await this.authService.verifyToken(token);
      } catch {
        payload = await this.apiTokenService.verifyApiToken(token);
      }
    }

    // refresh token 仅可用于 /auth/refresh 换发，禁止访问业务接口；
    // 双 token 机制上线前的旧 token 无 type 字段，视为 access 放行
    if (payload?.type === 'refresh') {
      throw new UnauthorizedException(
        'refresh token cannot access business APIs',
      );
    }

    const authenticatedPayload = payload as JwtPayload;
    if (
      this.configService.get<boolean>('auth.requireTenantContext') === true &&
      authenticatedPayload.authType !== 'service' &&
      !authenticatedPayload.tenantId?.trim()
    ) {
      throw new ForbiddenException('tenant context is required');
    }
    request.user = authenticatedPayload;

    const requiredScopes = this.reflector.getAllAndOverride<string[]>(
      API_SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (
      requiredScopes?.length &&
      authenticatedPayload.authType === 'api-token' &&
      !requiredScopes.every((required) =>
        (authenticatedPayload.scopes ?? []).some((granted) =>
          this.scopeMatches(granted, required),
        ),
      )
    ) {
      throw new ForbiddenException('api token scope is insufficient');
    }

    return true;
  }

  private scopeMatches(granted: string, required: string): boolean {
    const normalizedGranted = granted.trim();
    if (!normalizedGranted) return false;
    if (normalizedGranted === '*' || normalizedGranted === required)
      return true;
    if (normalizedGranted.endsWith('*')) {
      return required.startsWith(normalizedGranted.slice(0, -1));
    }
    return false;
  }

  private extractBearerToken(request: {
    headers: { authorization?: string };
    query?: { ticket?: string };
  }): string | null {
    const authorization = request.headers.authorization;
    if (authorization) {
      const [type, token] = authorization.split(' ');
      if (type === 'Bearer' && token) {
        return token;
      }
    }

    return null;
  }
}
