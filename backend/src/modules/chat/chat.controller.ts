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
import { MemoryService } from '../memory/memory.service';
import { ChatDto } from './chat.dto';
import type { ChatResponse, ChatMode } from './chat.dto';
import { AgenticRagService } from '../../rag/agentic/agentic-rag.service';
import type { SseEvent } from '../../rag/agentic/sse-event';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/api-response.interface';
import { ChatResumeDto } from './chat-resume.dto';
import { ChatFeedbackDto } from './chat-feedback.dto';
import { RagFeedbackService } from './rag-feedback.service';
import { listRolePresets, resolveRoleContext } from './role-presets';
import { PluginRuntimeService } from '../plugin-runtime/plugin-runtime.service';
import { detectDangerousQuery } from '../../rag/prompts/prompt-injection.guard';
import { MetricsService } from '../metrics/metrics.service';
import { SecurityAuditService } from '../metrics/security-audit.service';
import {
  buildContextPolicyMessage,
  selectHistoryForQuery,
} from '../../rag/prompts/context-policy';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly agenticRagService: AgenticRagService,
    private readonly conversationService: ConversationService,
    private readonly memoryService: MemoryService,
    private readonly ragFeedbackService: RagFeedbackService,
    @Optional() private readonly plugins?: PluginRuntimeService,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly securityAudit?: SecurityAuditService,
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
    return this.chatService.chat(body, user.userId);
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
  ): Observable<SseEvent> {
    if (!query || query.trim().length === 0) {
      throw new BadRequestException('query is required');
    }
    const dangerousFindings = detectDangerousQuery(query);
    if (dangerousFindings.length > 0) {
      for (const finding of dangerousFindings) {
        this.metrics?.observeDangerousQuery(finding.pattern, 'chat_stream');
        this.securityAudit?.record({
          pattern: finding.pattern,
          route: 'chat_stream',
          userId: user.userId,
          query,
        });
      }
      throw new BadRequestException({
        code: 'DANGEROUS_QUERY_BLOCKED',
        message: '检测到高风险破坏性操作请求，已阻止进入问答和工具链。',
        patterns: dangerousFindings.map((finding) => finding.pattern),
      });
    }
    const chatMode: ChatMode = mode ?? 'agentic';
    const userId = user.userId;
    return new Observable<SseEvent>((subscriber) => {
      void (async () => {
        try {
          const pluginComposition =
            pluginKeys?.trim() && this.plugins
              ? await this.plugins.resolve(
                  pluginKeys.split(',').map((item) => item.trim()),
                  chatMode,
                )
              : undefined;
          const startTime = Date.now();
          // 对话历史注入（SSE 流式模式）
          const activeThreadId =
            threadId ??
            (await this.conversationService.create(query, 'auto', userId));
          const history = selectHistoryForQuery(
            query,
            await this.conversationService.getRecentHistory(
              activeThreadId,
              5,
              userId,
            ),
          );

          // 先推送 threadId 给前端，以便前端保存后续发请求用
          subscriber.next({
            type: 'thread',
            data: { threadId: activeThreadId },
          });

          // Mem0 长期记忆搜索：SSE 流式前注入记忆上下文
          const memoryResult = await this.memoryService.searchMemory(
            query,
            userId,
            activeThreadId,
          );
          const memoryMessages: Array<{ role: string; content: string }> = [];
          memoryMessages.push({
            role: 'system',
            content: buildContextPolicyMessage(),
          });
          const roleContext = resolveRoleContext(rolePresetId);
          memoryMessages.push({
            role: 'system',
            content: roleContext.systemMessage,
          });
          if (memoryResult.systemMessage) {
            memoryMessages.push({
              role: 'system',
              content: memoryResult.systemMessage.content as string,
            });
          }

          this.agenticRagService
            .run(
              query,
              chatMode,
              (event) => subscriber.next(event),
              history,
              activeThreadId,
              userId,
              memoryMessages,
              false,
              {
                scope: { role: roleContext.role },
                ...(pluginComposition
                  ? {
                      pluginKeys: pluginComposition.pluginKeys,
                      pluginTools: pluginComposition.toolNames,
                    }
                  : {}),
              },
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

              // Mem0 分类写入
              void this.memoryService.classifyAndPersist(
                userId,
                activeThreadId,
                query,
                result.answer,
              );

              await this.chatService.logQuery({
                userId,
                query,
                mode: chatMode,
                threadId: activeThreadId,
                startTime,
                refused: false,
                citationCount: result.references?.length ?? 0,
                hasAnswer: result.answer.length > 0,
                answer: result.answer,
                references: result.references ?? [],
              });

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

  /**
   * 恢复被人工审批中断的 Agentic RAG 图执行
   * POST /api/chat/resume
   *
   * 当 enableInterrupt=true 时，Agentic RAG 在 generate 后暂停等待人工审批。
   * 前端收到 SSE interrupt 事件后，展示审批 UI，用户决定后调用此接口恢复执行。
   */
  @Post('resume')
  async resume(@Body() body: ChatResumeDto, @CurrentUser() user: JwtPayload) {
    const result = await this.agenticRagService.resumeGraph(
      body.threadId,
      body.approval,
      body.feedback,
    );

    if (body.approval === 'approved') {
      // 审批通过后持久化对话
      await this.conversationService.addMessage(
        body.threadId,
        'ai',
        result.answer,
        user.userId,
      );
    }

    return result;
  }
}
