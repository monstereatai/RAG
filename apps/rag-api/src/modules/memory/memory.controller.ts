import {
  Controller,
  Get,
  Delete,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MemoryService } from './memory.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/api-response.interface';
import { ApiScopes } from '../../common/decorators/api-scopes.decorator';
import { MemoryConsolidationService } from './memory-consolidation.service';

@Controller('memories')
@UseGuards(JwtAuthGuard)
@ApiScopes('rag:memory')
export class MemoryController {
  constructor(
    private readonly memoryService: MemoryService,
    private readonly consolidationService: MemoryConsolidationService,
  ) {}

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

  @Get('consolidations/pending')
  async listPendingConsolidations(@CurrentUser() user: JwtPayload) {
    if (!this.memoryService.isEnabled()) {
      return { enabled: false, proposals: [] };
    }
    const proposals = await this.consolidationService.listPending(user.userId);
    return { enabled: true, proposals };
  }

  @Post('consolidations/:memoryId/approve')
  async approveConsolidation(
    @Param('memoryId') memoryId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.consolidationService.approve(user.userId, memoryId);
  }

  @Post('consolidations/:memoryId/reject')
  async rejectConsolidation(
    @Param('memoryId') memoryId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.consolidationService.reject(user.userId, memoryId);
  }

  @Post('consolidations/:memoryId/revoke')
  async revokeConsolidation(
    @Param('memoryId') memoryId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.consolidationService.revoke(user.userId, memoryId);
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
