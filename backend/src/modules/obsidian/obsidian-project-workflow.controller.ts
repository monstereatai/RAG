import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiScopes } from '../../common/decorators/api-scopes.decorator';
import {
  ObsidianKnowledgeService,
  ProjectWorkflowType,
} from './obsidian-knowledge.service';

interface ProjectWorkflowBody {
  title?: string;
  question?: string;
  context?: string;
  constraints?: string[];
  options?: string[];
}

const WORKFLOW_TYPES: ProjectWorkflowType[] = [
  'solution',
  'tech-selection',
  'adr',
  'task-breakdown',
];

@Controller('obsidian/project-workflows')
@UseGuards(JwtAuthGuard)
@ApiScopes('rag:obsidian')
export class ObsidianProjectWorkflowController {
  constructor(private readonly obsidianKnowledge: ObsidianKnowledgeService) {}

  @Post(':type')
  async generate(
    @Param('type') type: string,
    @Body() body: ProjectWorkflowBody,
  ) {
    if (!WORKFLOW_TYPES.includes(type as ProjectWorkflowType)) {
      throw new BadRequestException(
        `type must be one of: ${WORKFLOW_TYPES.join(', ')}`,
      );
    }
    const question = body.question?.trim();
    if (!question) {
      throw new BadRequestException('question is required');
    }

    return this.obsidianKnowledge.generateProjectWorkflow({
      type: type as ProjectWorkflowType,
      title: body.title?.trim() || question,
      question,
      context: body.context?.trim(),
      constraints: this.cleanStringArray(body.constraints),
      options: this.cleanStringArray(body.options),
    });
  }

  private cleanStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value
          .map((item) => String(item).trim())
          .filter((item) => item.length > 0)
      : [];
  }
}
