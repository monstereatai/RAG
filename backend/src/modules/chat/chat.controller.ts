import {
  Controller,
  Post,
  Body,
  Sse,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ChatService } from './chat.service';
import { ChatDto } from './chat.dto';
import type { ChatResponse, ChatMode } from './chat.dto';
import { AgenticRagService } from '../../rag/agentic/agentic-rag.service';
import type { SseEvent } from '../../rag/agentic/sse-event';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly agenticRagService: AgenticRagService,
  ) {}

  @Post()
  chat(@Body() body: ChatDto): Promise<ChatResponse> {
    return this.chatService.chat(body);
  }

  /**
   * SSE 流式接口：agentic/auto 模式下推送 routing/token/retrieval/citation/final 事件
   * GET /api/chat/stream?query=...&mode=agentic
   */
  @Sse('stream')
  stream(
    @Query('query') query: string,
    @Query('mode') mode?: ChatMode,
  ): Observable<SseEvent> {
    if (!query || query.trim().length === 0) {
      throw new BadRequestException('query is required');
    }
    const chatMode: ChatMode = mode ?? 'agentic';

    return new Observable<SseEvent>((subscriber) => {
      this.agenticRagService
        .run(query, chatMode, (event) => subscriber.next(event))
        .then(() => subscriber.complete())
        .catch((err) => {
          subscriber.next({
            type: 'error',
            data: { message: (err as Error).message },
          });
          subscriber.complete();
        });
    });
  }
}
