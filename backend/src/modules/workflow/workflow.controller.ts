import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/interfaces/api-response.interface';
import {
  buildAgenticWorkflowMermaid,
  parseSseEventTypes,
} from './agentic-workflow.mermaid';
import { ProductionWorkflowService } from './production-workflow.service';
import {
  ResumeProductionWorkflowDto,
  StartProductionWorkflowDto,
} from './production-workflow.dto';

@Controller('workflows')
@UseGuards(JwtAuthGuard)
export class WorkflowController {
  constructor(private readonly productionWorkflow: ProductionWorkflowService) {}

  @Get('agentic/mermaid')
  getAgenticMermaid(@Query('events') events?: string) {
    return buildAgenticWorkflowMermaid(parseSseEventTypes(events));
  }

  @Post('production')
  startProduction(
    @Body() body: StartProductionWorkflowDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productionWorkflow.startAsync(body, user.userId);
  }

  @Get('production')
  listProduction(@CurrentUser() user: JwtPayload) {
    return this.productionWorkflow.list(user.userId);
  }

  @Post('production/:threadId/resume')
  resumeProduction(
    @Param('threadId') threadId: string,
    @Body() body: ResumeProductionWorkflowDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productionWorkflow.resumeAsync(threadId, body, user.userId);
  }

  @Get('production/:threadId/coding-context')
  productionCodingContext(
    @Param('threadId') threadId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productionWorkflow.codingContext(threadId, user.userId);
  }

  @Get('production/:threadId')
  productionStatus(
    @Param('threadId') threadId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productionWorkflow.status(threadId, user.userId);
  }
}
