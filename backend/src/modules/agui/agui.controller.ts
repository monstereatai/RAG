import {
  BadRequestException,
  Controller,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ServiceTokenGuard } from '../../common/guards/service-token.guard';
import type { JwtPayload } from '../../common/interfaces/api-response.interface';
import type { ChatMode } from '../chat/chat.dto';
import type { LlmModelProvider } from '../../providers/llm/llm-provider.interface';
import { AguiService } from './agui.service';
import type { AguiEvent } from './agui.types';

@Controller('agui')
export class AguiController {
  constructor(private readonly aguiService: AguiService) {}

  @Sse('stream')
  @UseGuards(JwtAuthGuard)
  stream(
    @Query('query') query: string,
    @CurrentUser() user: JwtPayload,
    @Query('mode') mode?: ChatMode,
    @Query('threadId') threadId?: string,
    @Query('model') model?: LlmModelProvider,
    @Query('rolePresetId') rolePresetId?: string,
    @Query('pluginKeys') pluginKeys?: string,
  ): Observable<AguiEvent> {
    const chatMode = mode ?? 'agentic';
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
      model: chatModel,
      rolePresetId,
      pluginKeys: pluginKeys?.split(',').map((item) => item.trim()).filter(Boolean),
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
  ): Observable<AguiEvent> {
    const chatMode = mode ?? 'agentic';
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
      userId: userId?.trim() || 'admin-backend',
      model: chatModel,
      rolePresetId,
      pluginKeys: pluginKeys?.split(',').map((item) => item.trim()).filter(Boolean),
    });
  }

  private parseModel(model?: string): LlmModelProvider {
    if (!model) return 'qwen';
    if (model === 'qwen' || model === 'deepseek') return model;
    throw new BadRequestException('model must be one of: qwen, deepseek');
  }
}
