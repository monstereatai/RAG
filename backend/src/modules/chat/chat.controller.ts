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
  Optional,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
import { ChatDto } from './chat.dto';
import type { ChatResponse, ChatMode } from './chat.dto';
import type { SseEvent } from '../../rag/agentic/sse-event';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/api-response.interface';
import { ChatResumeDto } from './chat-resume.dto';
import { ChatFeedbackDto } from './chat-feedback.dto';
import { RagFeedbackService } from './rag-feedback.service';
import { listRolePresets } from './role-presets';
import { AgentRunsService } from '../agent-runs/agent-runs.service';
import { TenantQuotaGuard } from '../../common/guards/tenant-quota.guard';
import { ApiScopes } from '../../common/decorators/api-scopes.decorator';

@Controller('chat')
@UseGuards(JwtAuthGuard, TenantQuotaGuard)
@ApiScopes('rag:chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly conversationService: ConversationService,
    private readonly ragFeedbackService: RagFeedbackService,
    @Optional() private readonly agentRuns?: AgentRunsService,
  ) {}

  @Get('role-presets')
  rolePresets() {
    return {
      defaultRolePresetId: 'business-owner',
      roles: listRolePresets(),
    };
  }
  /**
   * 非流式聊天（simple 模式；也可 agentic，无 SSE）
   * POST /api/chat
   */
  @Post()
  chat(
    @Body() body: ChatDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<ChatResponse> {
    return this.chatService.chat(body, user.userId, undefined, {
      tenantId: user.tenantId,
    });
  }

  @Post('feedback')
  submitFeedback(
    @Body() body: ChatFeedbackDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ragFeedbackService.create(body, user.userId);
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
    @Query('rolePresetId') rolePresetId?: string,
    @Query('pluginKeys') pluginKeys?: string,
    @Query('approvalRequired') approvalRequired?: string,
  ): Observable<SseEvent> {
    if (!query || query.trim().length === 0) {
      throw new BadRequestException('query is required');
    }
    const chatMode: ChatMode = mode ?? 'auto';
    const parsedPluginKeys = pluginKeys
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    // SSE 只适配传输协议；请求语义、执行引擎、最终校验和持久化全部收敛到
    // ChatService，避免流式链路重新分类或与 HTTP 写出不同的最终答案。
    let activeThreadId = threadId;
    let settled = false;
    return new Observable<SseEvent>((subscriber) => {
      const abortController = new AbortController();
      void this.chatService
        .chat(
          {
            query,
            mode: chatMode,
            threadId,
            rolePresetId,
            pluginKeys: parsedPluginKeys,
            approvalRequired: approvalRequired === 'true',
          },
          user.userId,
          (event) => {
            if (
              event.type === 'thread' &&
              typeof (event.data as { threadId?: unknown } | undefined)
                ?.threadId === 'string'
            ) {
              activeThreadId = (event.data as { threadId: string }).threadId;
            }
            subscriber.next(event);
          },
          { signal: abortController.signal, tenantId: user.tenantId },
        )
        .then((result) => {
          // ChatService 已在最终持久化前后发出完整生命周期事件；这里只负责结束传输。
          subscriber.next({ type: 'done', data: result });
          subscriber.complete();
        })
        .catch((error) => {
          subscriber.next({
            type: 'error',
            data: { message: (error as Error).message },
          });
          subscriber.complete();
        })
        .finally(() => {
          settled = true;
        });

      // 浏览器关闭 SSE 时，Nest 会退订 Observable。把该退订映射到运行
      // 取消标记，Agentic Loop 会在下一轮边界停止并保留运行审计。
      return () => {
        abortController.abort();
        if (!settled && activeThreadId && this.agentRuns) {
          void this.agentRuns.cancelActiveForThread(
            activeThreadId,
            user.userId,
            '客户端断开流式连接',
            user.tenantId,
          );
        }
      };
    });
  }

  @Post('conversations/:threadId/cancel')
  async cancelConversationRun(
    @Param('threadId') threadId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const run = await this.agentRuns?.cancelActiveForThread(
      threadId,
      user.userId,
      '用户取消运行',
      user.tenantId,
    );
    return { status: run?.status ?? 'idle', runId: run?.id ?? null };
  }

  /**
   * 获取对话列表
   * GET /api/chat/conversations
   */
  @Get('conversations')
  async listConversations(@CurrentUser() user: JwtPayload) {
    return await this.conversationService.listConversations(
      user.userId,
      user.tenantId,
    );
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
    const conv = await this.conversationService.get(
      threadId,
      user.userId,
      user.tenantId,
    );
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
      user.tenantId,
    );
    if (!deleted) {
      throw new BadRequestException(`conversation ${threadId} not found`);
    }
    return { message: `conversation ${threadId} deleted` };
  }

  /**
   * 恢复被人工审批中断的 Agentic RAG 图执行
   * POST /api/chat/resume
   *
   * 当 enableInterrupt=true 时，Agentic RAG 在 generate 后暂停等待人工审批。
   * 前端收到 SSE interrupt 事件后，展示审批 UI，用户决定后调用此接口恢复执行。
   */
  @Post('resume')
  async resume(@Body() body: ChatResumeDto, @CurrentUser() user: JwtPayload) {
    return this.chatService.resume(
      body.threadId,
      body.approval,
      body.feedback,
      user.userId,
      user.tenantId,
    );
  }
}
