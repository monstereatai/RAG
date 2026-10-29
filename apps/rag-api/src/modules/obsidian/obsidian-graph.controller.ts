import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiScopes } from '../../common/decorators/api-scopes.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/interfaces/api-response.interface';
import { ObsidianKnowledgeService } from './obsidian-knowledge.service';

@Controller('obsidian/graph')
@UseGuards(JwtAuthGuard)
@ApiScopes('rag:obsidian')
export class ObsidianGraphController {
  constructor(private readonly obsidianKnowledge: ObsidianKnowledgeService) {}

  @Get('seed')
  exportSeed(@CurrentUser() user: JwtPayload) {
    return this.obsidianKnowledge.exportGraphSeed({
      userId: user.userId,
      roles: [user.role],
      tenantId: user.tenantId,
    });
  }
}
