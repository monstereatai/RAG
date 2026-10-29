import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { RedisProvider } from '../../providers/redis/redis.provider';
import type { JwtPayload } from '../../common/interfaces/api-response.interface';

const SPEECH_TICKET_TTL_SECONDS = 30;
const SPEECH_TICKET_PREFIX = 'speech-tts-ticket:';

/** One-time, short-lived ticket scoped only to the TTS WebSocket handshake. */
@Injectable()
export class SpeechTicketService {
  constructor(private readonly redis: RedisProvider) {}

  async issue(
    user: JwtPayload,
  ): Promise<{ ticket: string; expiresIn: number }> {
    const ticket = `speech_${randomBytes(32).toString('base64url')}`;
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
        purpose: 'speech-tts-ws',
      }),
      SPEECH_TICKET_TTL_SECONDS,
    );
    if (!stored) {
      throw new ServiceUnavailableException(
        'Speech ticket store is unavailable; retry after Redis is ready',
      );
    }
    return { ticket, expiresIn: SPEECH_TICKET_TTL_SECONDS };
  }

  async consume(ticket: string): Promise<JwtPayload | null> {
    if (!ticket.startsWith('speech_')) return null;
    const raw = await this.redis.getdel(this.key(ticket));
    if (!raw) return null;
    try {
      const payload = JSON.parse(raw) as JwtPayload & { purpose?: string };
      if (
        payload.purpose !== 'speech-tts-ws' ||
        !payload.userId ||
        !payload.username ||
        !payload.role
      ) {
        return null;
      }
      delete payload.purpose;
      return payload;
    } catch {
      return null;
    }
  }

  private key(ticket: string): string {
    return `${SPEECH_TICKET_PREFIX}${createHash('sha256').update(ticket).digest('hex')}`;
  }
}
