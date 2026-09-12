import {
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ServiceTokenGuard } from '../../common/guards/service-token.guard';
import { AguiService } from '../agui/agui.service';
import type { AguiEvent } from '../agui/agui.types';
import type { ChatMode } from '../chat/chat.dto';
import type { LlmModelProvider } from '../../providers/llm/llm-provider.interface';
import { ConversationService } from '../chat/conversation.service';
import { QaOpsService } from './qa-ops.service';

@Controller('admin/qa-ops')
@UseGuards(ServiceTokenGuard)
export class QaOpsController {
  private readonly logger = new Logger(QaOpsController.name);

  constructor(
    private readonly conversationService: ConversationService,
    private readonly aguiService: AguiService,
    private readonly qaOpsService: QaOpsService,
  ) {}

  /**
   * 获取会话列表
   */
  @Get('conversations')
  async listConversations() {
    const userId = this.qaOpsService.getAdminUserId();
    const conversations =
      await this.conversationService.listConversations(userId);
    return { data: conversations };
  }

  /**
   * 获取单个会话的消息
   */
  @Get('conversations/:threadId')
  async getConversation(@Param('threadId') threadId: string) {
    const userId = this.qaOpsService.getAdminUserId();
    const conversation = await this.conversationService.get(threadId, userId);
    if (!conversation) {
      throw new NotFoundException('会话不存在');
    }
    return { data: conversation };
  }

  /**
   * 删除会话
   */
  @Delete('conversations/:threadId')
  async deleteConversation(@Param('threadId') threadId: string) {
    const userId = this.qaOpsService.getAdminUserId();
    const deleted = await this.conversationService.delete(threadId, userId);
    if (!deleted) {
      throw new NotFoundException('会话不存在');
    }
    return { success: true };
  }

  /**
   * AG-UI 流式问答（后台管理用）
   */
  @Sse('agui/stream')
  stream(
    @Query('query') query: string,
    @Query('mode') mode?: ChatMode,
    @Query('threadId') threadId?: string,
    @Query('model') model?: LlmModelProvider,
  ): Observable<AguiEvent> {
    const chatMode = mode ?? 'auto';
    if (!['simple', 'agentic', 'auto'].includes(chatMode)) {
      throw new NotFoundException('mode must be one of: simple, agentic, auto');
    }
    const chatModel = this.parseModel(model);
    return this.aguiService.stream({
      query,
      mode: chatMode,
      threadId,
      userId: this.qaOpsService.getAdminUserId(),
      model: chatModel,
    });
  }

  private parseModel(model?: string): LlmModelProvider {
    if (!model) return 'qwen';
    if (model === 'qwen' || model === 'deepseek' || model === 'zhipu')
      return model;
    throw new NotFoundException('model must be one of: qwen, deepseek, zhipu');
  }
}
