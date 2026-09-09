import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MemoryService } from './memory.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/api-response.interface';

@Controller('memories')
@UseGuards(JwtAuthGuard)
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Get('status')
  getStatus() {
    return this.memoryService.getStatus();
  }

  @Get('search')
  async searchMemories(
    @Query('q') query: string,
    @Query('conversationId') conversationId: string | undefined,
    @Query('topK') topK: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!this.memoryService.isEnabled()) {
      return {
        enabled: false,
        userMemories: [],
        sessionMemories: [],
        systemMessage: null,
      };
    }
    return {
      enabled: true,
      ...(await this.memoryService.searchMemories(
        query ?? '',
        user.userId,
        conversationId,
        topK ? Number(topK) : 5,
      )),
    };
  }

  @Get('sessions/:conversationId')
  async listSessionMemories(
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!this.memoryService.isEnabled()) {
      return { enabled: false, memories: [] };
    }
    const memories = await this.memoryService.listSessionMemories(
      user.userId,
      conversationId,
    );
    return { enabled: true, memories };
  }

  /**
   * 获取当前用户的所有长期记忆
   * GET /api/memories
   */
  @Get()
  async listMemories(@CurrentUser() user: JwtPayload) {
    if (!this.memoryService.isEnabled()) {
      return { enabled: false, memories: [] };
    }
    const memories = await this.memoryService.listMemories(user.userId);
    return { enabled: true, memories };
  }

  /**
   * 清空当前用户的所有长期记忆
   * DELETE /api/memories
   */
  @Delete()
  async clearMemories(@CurrentUser() user: JwtPayload) {
    if (!this.memoryService.isEnabled()) {
      return { message: 'Mem0 is disabled' };
    }
    await this.memoryService.clearMemories(user.userId);
    return { message: 'All memories cleared' };
  }
}
