import {
  Controller,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RagClientService } from '../rag-client/rag-client.service';

interface AuthenticatedAdmin {
  userId?: string | number;
  role?: string;
}

@Controller('speech')
export class SpeechTicketController {
  constructor(private readonly ragClient: RagClientService) {}

  @Post('tts-ticket')
  @RequirePermission('admin:qa-ops:read')
  async issueTtsTicket(@Req() request: Request) {
    const user = (request as Request & { user?: AuthenticatedAdmin }).user;
    if (user?.userId === undefined || user.userId === null) {
      throw new UnauthorizedException('authenticated user is required');
    }

    const result = await this.ragClient.issueSpeechTicket(
      String(user.userId),
      user.role === 'admin' ? 'admin' : 'user',
      'legacy',
    );
    if (!result.available || !result.data) {
      throw new ServiceUnavailableException(
        result.error ?? 'RAG speech ticket service is unavailable',
      );
    }

    const response = result.data as {
      data?: { ticket?: string; expiresIn?: number };
    };
    if (!response.data?.ticket) {
      throw new ServiceUnavailableException('RAG speech ticket response is invalid');
    }
    return response.data;
  }
}
