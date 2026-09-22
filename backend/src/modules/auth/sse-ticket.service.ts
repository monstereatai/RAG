import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { RedisProvider } from '../../providers/redis/redis.provider';
import type { JwtPayload } from '../../common/interfaces/api-response.interface';

const SSE_TICKET_TTL_SECONDS = 60;
const SSE_TICKET_PREFIX = 'sse-ticket:';

/**
 * EventSource 不支持自定义 Authorization header，因此只允许使用一次、
 * 60 秒有效的 Redis 票据。原始 JWT 不会进入 URL、代理日志或浏览器历史。
 */
@Injectable()
export class SseTicketService {
  constructor(private readonly redis: RedisProvider) {}

  async issue(
    user: JwtPayload,
  ): Promise<{ ticket: string; expiresIn: number }> {
    const ticket = `sse_${randomBytes(32).toString('base64url')}`;
    const stored = await this.redis.setRequired(
      this.key(ticket),
      JSON.stringify({
        userId: user.userId,
        username: user.username,
        role: user.role,
        tenantId: user.tenantId,
        authType: user.authType,
        scopes: user.scopes,
        type: 'access',
      } satisfies JwtPayload),
      SSE_TICKET_TTL_SECONDS,
    );
    if (!stored) {
      throw new ServiceUnavailableException(
        'SSE ticket store is unavailable; retry after Redis is ready',
      );
    }
    return { ticket, expiresIn: SSE_TICKET_TTL_SECONDS };
  }

  async consume(ticket: string): Promise<JwtPayload | null> {
    if (!ticket.startsWith('sse_')) return null;
    const raw = await this.redis.getdel(this.key(ticket));
    if (!raw) return null;
    try {
      const payload = JSON.parse(raw) as JwtPayload;
      if (!payload.userId || !payload.username || !payload.role) return null;
      return payload;
    } catch {
      return null;
    }
  }

  private key(ticket: string): string {
    return `${SSE_TICKET_PREFIX}${createHash('sha256').update(ticket).digest('hex')}`;
  }
}
