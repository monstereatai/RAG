import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  ForbiddenException,
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
import { Public } from '../../common/decorators/public.decorator';

@Controller('agui')
export class AguiController {
  constructor(
    private readonly aguiService: AguiService,
    private readonly attachments: ConversationAttachmentService,
  ) {}

  @Post('admin/attachments')
  @Public()
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
  @Public()
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
  @Public()
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
  @Public()
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
      departmentIds: user.departmentIds,
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
  @Public()
  @UseGuards(ServiceTokenGuard)
  // 服务令牌证明请求来自 Admin API；这里继续校验映射后的管理员身份和租户，不能把服务账号当成数据所有者。
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
    const adminUserId = userId?.trim();
    if (!adminUserId || !/^admin:[a-f0-9]{58}$/.test(adminUserId)) {
      throw new ForbiddenException('管理后台缺少有效的管理员身份映射。');
    }
    const tenantId = process.env.RAG_ADMIN_TENANT_ID?.trim();
    if (!tenantId) {
      throw new ForbiddenException('必须配置 RAG_ADMIN_TENANT_ID。');
    }
    return this.aguiService.stream({
      query,
      mode: chatMode,
      threadId,
      // Admin Backend 通过服务令牌进入此路由，并传入由 Admin 会话派生的稳定身份。
      userId: adminUserId,
      tenantId: tenantId || 'legacy',
      trustedAdminPrincipal: true,
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
