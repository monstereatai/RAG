import {
  Controller,
  Get,
  Delete,
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
