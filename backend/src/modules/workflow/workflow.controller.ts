import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  buildAgenticWorkflowMermaid,
  parseSseEventTypes,
} from './agentic-workflow.mermaid';

@Controller('workflows')
@UseGuards(JwtAuthGuard)
export class WorkflowController {
  @Get('agentic/mermaid')
  getAgenticMermaid(@Query('events') events?: string) {
    return buildAgenticWorkflowMermaid(parseSseEventTypes(events));
  }
}
