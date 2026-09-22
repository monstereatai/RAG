import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiScopes } from '../../common/decorators/api-scopes.decorator';
import { ObsidianKnowledgeService } from './obsidian-knowledge.service';

@Controller('obsidian/graph')
@UseGuards(JwtAuthGuard)
@ApiScopes('rag:obsidian')
export class ObsidianGraphController {
  constructor(private readonly obsidianKnowledge: ObsidianKnowledgeService) {}

  @Get('seed')
  exportSeed() {
    return this.obsidianKnowledge.exportGraphSeed();
  }
}
