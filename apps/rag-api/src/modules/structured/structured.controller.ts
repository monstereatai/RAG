import {
  Controller,
  Query,
  Sse,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { StructuredService } from './structured.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiScopes } from '../../common/decorators/api-scopes.decorator';
import { SseEvent } from '../../rag/agentic/sse-event';

@Controller('structured')
@UseGuards(JwtAuthGuard)
@ApiScopes('rag:structured')
export class StructuredController {
  constructor(private readonly structuredService: StructuredService) {}

  /**
   * SSE 流式返回结构化输出
   * GET /api/structured/stream?topic=...
   */
  @Sse('stream')
  streamReport(@Query('topic') topic: string): Observable<SseEvent> {
    if (!topic || topic.trim().length === 0) {
      throw new BadRequestException('topic is required');
    }

    return new Observable<SseEvent>((subscriber) => {
      void (async () => {
        try {
          await this.structuredService.streamReport(topic, (event) => {
            subscriber.next({
              type: event.type,
              data: event.data,
            });
          });
          subscriber.next({ type: 'done', data: { ok: true } });
          subscriber.complete();
        } catch (err) {
          subscriber.next({
            type: 'error',
            data: { message: (err as Error).message },
          });
          subscriber.complete();
        }
      })();
    });
  }
}
