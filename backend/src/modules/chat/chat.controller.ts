import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Sse,
  Query,
  Param,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
import { ChatDto } from './chat.dto';
import type { ChatResponse, ChatMode } from './chat.dto';
import { AgenticRagService } from '../../rag/agentic/agentic-rag.service';
import type { SseEvent } from '../../rag/agentic/sse-event';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/api-response.interface';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly agenticRagService: AgenticRagService,
    private readonly conversationService: ConversationService,
  ) {}

  /**
   * 非流式聊天（simple 模式；也可 agentic，无 SSE）
   * POST /api/chat
   */
  @Post()
  chat(
    @Body() body: ChatDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<ChatResponse> {
    return this.chatService.chat(body, user.userId);
  }

  /**
   * SSE 流式聊天（agentic/auto 模式，推送完整 SSE 事件链）
   * GET /api/chat/stream?query=...&mode=agentic&threadId=...
   */
  @Sse('stream')
  stream(
    @Query('query') query: string,
    @CurrentUser() user: JwtPayload,
    @Query('mode') mode?: ChatMode,
    @Query('threadId') threadId?: string,
  ): Observable<SseEvent> {
    if (!query || query.trim().length === 0) {
      throw new BadRequestException('query is required');
    }
    const chatMode: ChatMode = mode ?? 'agentic';
    const userId = user.userId;

    return new Observable<SseEvent>((subscriber) => {
      void (async () => {
        try {
          // 对话历史注入（SSE 流式模式）
          const activeThreadId =
            threadId ??
            (await this.conversationService.create(query, 'auto', userId));
          const history = await this.conversationService.getRecentHistory(
            activeThreadId,
            5,
            userId,
          );

          // 先推送 threadId 给前端，以便前端保存后续发请求用
          subscriber.next({
            type: 'thread',
            data: { threadId: activeThreadId },
          });

          this.agenticRagService
            .run(
              query,
              chatMode,
              (event) => subscriber.next(event),
              history,
              activeThreadId,
              userId,
            )
            .then(async (result) => {
              // 持久化本轮对话
              await this.conversationService.addMessage(
                activeThreadId,
                'human',
                query,
                userId,
              );
              await this.conversationService.addMessage(
                activeThreadId,
                'ai',
                result.answer,
                userId,
              );
              subscriber.complete();
            })
            .catch((err) => {
              subscriber.next({
                type: 'error',
                data: { message: (err as Error).message },
              });
              subscriber.complete();
            });
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

  /**
   * 获取对话列表
   * GET /api/chat/conversations
   */
  @Get('conversations')
  async listConversations(@CurrentUser() user: JwtPayload) {
    return await this.conversationService.listConversations(user.userId);
  }

  /**
   * 获取单个对话（含消息历史）
   * GET /api/chat/conversations/:threadId
   */
  @Get('conversations/:threadId')
  async getConversation(
    @Param('threadId') threadId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const conv = await this.conversationService.get(threadId, user.userId);
    if (!conv) {
      throw new BadRequestException(`conversation ${threadId} not found`);
    }
    return conv;
  }

  /**
   * 删除对话
   * DELETE /api/chat/conversations/:threadId
   */
  @Delete('conversations/:threadId')
  async deleteConversation(
    @Param('threadId') threadId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const deleted = await this.conversationService.delete(
      threadId,
      user.userId,
    );
    if (!deleted) {
      throw new BadRequestException(`conversation ${threadId} not found`);
    }
    return { message: `conversation ${threadId} deleted` };
  }
}
