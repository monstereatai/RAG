import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Sse,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Observable } from 'rxjs';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ServiceTokenGuard } from '../../common/guards/service-token.guard';
import type { JwtPayload } from '../../common/interfaces/api-response.interface';
import type { ChatMode } from '../chat/chat.dto';
import type { LlmModelProvider } from '../../providers/llm/llm-provider.interface';
import { AguiService } from './agui.service';
import type { AguiEvent } from './agui.types';
import { TenantQuotaGuard } from '../../common/guards/tenant-quota.guard';
import { ApiScopes } from '../../common/decorators/api-scopes.decorator';
import { ConversationAttachmentService } from './conversation-attachment.service';

@Controller('agui')
export class AguiController {
  constructor(
    private readonly aguiService: AguiService,
    private readonly attachments: ConversationAttachmentService,
  ) {}

  @Post('admin/attachments')
  @UseGuards(ServiceTokenGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadAdminAttachment(
    @UploadedFile() file: Express.Multer.File,
    @Body('userId') userId?: string,
    @Body('threadId') threadId?: string,
  ) {
    if (!file) throw new BadRequestException('请选择有效文件');
    if (!userId?.trim()) throw new BadRequestException('userId is required');
    if (!threadId || !this.isUuid(threadId)) {
      throw new BadRequestException('有效的 threadId 是必需的');
    }
    return this.attachments.upload(file, userId.trim(), threadId);
  }

  @Get('admin/attachments')
  @UseGuards(ServiceTokenGuard)
  listAdminAttachments(
    @Query('userId') userId?: string,
    @Query('threadId') threadId?: string,
  ) {
    if (!userId?.trim()) throw new BadRequestException('userId is required');
    if (!threadId || !this.isUuid(threadId)) {
      throw new BadRequestException('有效的 threadId 是必需的');
    }
    return this.attachments.list(userId.trim(), threadId);
  }

  @Delete('admin/attachments')
  @UseGuards(ServiceTokenGuard)
  removeAllAdminAttachments(
    @Query('userId') userId?: string,
    @Query('threadId') threadId?: string,
  ) {
    if (!userId?.trim()) throw new BadRequestException('userId is required');
    if (!threadId || !this.isUuid(threadId)) {
      throw new BadRequestException('有效的 threadId 是必需的');
    }
    return this.attachments.removeAll(userId.trim(), threadId);
  }

  @Delete('admin/attachments/:attachmentId')
  @UseGuards(ServiceTokenGuard)
  removeAdminAttachment(
    @Param('attachmentId') attachmentId: string,
    @Query('userId') userId?: string,
    @Query('threadId') threadId?: string,
  ) {
    if (!userId?.trim()) throw new BadRequestException('userId is required');
    if (!threadId || !this.isUuid(threadId)) {
      throw new BadRequestException('有效的 threadId 是必需的');
    }
    if (!this.isUuid(attachmentId)) {
      throw new BadRequestException('有效的 attachmentId 是必需的');
    }
    return this.attachments.remove(userId.trim(), threadId, attachmentId);
  }

  @Sse('stream')
  @UseGuards(JwtAuthGuard, TenantQuotaGuard)
  @ApiScopes('rag:chat')
  stream(
    @Query('query') query: string,
    @CurrentUser() user: JwtPayload,
    @Query('mode') mode?: ChatMode,
    @Query('threadId') threadId?: string,
    @Query('model') model?: LlmModelProvider,
    @Query('rolePresetId') rolePresetId?: string,
    @Query('pluginKeys') pluginKeys?: string,
    @Query('approvalRequired') approvalRequired?: string,
    @Query('attachmentIds') attachmentIds?: string,
  ): Observable<AguiEvent> {
    const chatMode = mode ?? 'auto';
    if (!['simple', 'agentic', 'auto'].includes(chatMode)) {
      throw new BadRequestException(
        'mode must be one of: simple, agentic, auto',
      );
    }
    const chatModel = this.parseModel(model);
    return this.aguiService.stream({
      query,
      mode: chatMode,
      threadId,
      userId: user.userId,
      tenantId: user.tenantId,
      model: chatModel,
      rolePresetId,
      pluginKeys: pluginKeys
        ?.split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      approvalRequired: approvalRequired === 'true',
      attachmentIds: this.parseAttachmentIds(attachmentIds),
    });
  }

  @Sse('admin/stream')
  @UseGuards(ServiceTokenGuard)
  adminStream(
    @Query('query') query: string,
    @Query('mode') mode?: ChatMode,
    @Query('userId') userId?: string,
    @Query('threadId') threadId?: string,
    @Query('model') model?: LlmModelProvider,
    @Query('rolePresetId') rolePresetId?: string,
    @Query('pluginKeys') pluginKeys?: string,
    @Query('approvalRequired') approvalRequired?: string,
    @Query('attachmentIds') attachmentIds?: string,
  ): Observable<AguiEvent> {
    const chatMode = mode ?? 'auto';
    if (!['simple', 'agentic', 'auto'].includes(chatMode)) {
      throw new BadRequestException(
        'mode must be one of: simple, agentic, auto',
      );
    }
    const chatModel = this.parseModel(model);
    return this.aguiService.stream({
      query,
      mode: chatMode,
      threadId,
      // 管理后台没有浏览器用户 JWT 时使用管理员知识库身份。历史上的
      // `admin-backend` 是服务调用方标识，不是文档所有者，不能拿它做检索隔离。
      userId: userId?.trim() || process.env.RAG_ADMIN_USER_ID || '1',
      model: chatModel,
      rolePresetId,
      pluginKeys: pluginKeys
        ?.split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      approvalRequired: approvalRequired === 'true',
      attachmentIds: this.parseAttachmentIds(attachmentIds),
    });
  }

  private parseModel(model?: string): LlmModelProvider {
    if (!model) return 'qwen';
    if (model === 'qwen' || model === 'deepseek' || model === 'zhipu')
      return model;
    throw new BadRequestException(
      'model must be one of: qwen, deepseek, zhipu',
    );
  }

  private parseAttachmentIds(value?: string) {
    if (!value?.trim()) return undefined;
    const ids = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
    if (ids.length > 5 || ids.some((id) => !this.isUuid(id))) {
      throw new BadRequestException('attachmentIds 格式无效或附件数量超过 5 个');
    }
    return ids;
  }

  private isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }
}
