import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ServiceTokenGuard } from '../../common/guards/service-token.guard';
import { AgentEvalDto } from '../agent-evals/agent-eval.dto';
import { AgentEvalService } from '../agent-evals/agent-eval.service';
import { RagFeedbackService } from '../chat/rag-feedback.service';
import { TracingService } from '../tracing/tracing.service';
import {
  ResumeProductionWorkflowDto,
  StartProductionWorkflowDto,
} from '../workflow/production-workflow.dto';
import { ProductionWorkflowService } from '../workflow/production-workflow.service';
import { AgenticRagService } from '../../rag/agentic/agentic-rag.service';

@Controller('rag/admin/agent-ops')
@UseGuards(ServiceTokenGuard)
export class AgentOpsAdminController {
  constructor(
    private readonly workflows: ProductionWorkflowService,
    private readonly evals: AgentEvalService,
    private readonly feedback: RagFeedbackService,
    private readonly tracing: TracingService,
    private readonly agenticRag: AgenticRagService,
  ) {}

  @Post('workflows')
  startWorkflow(
    @Query('ownerUserId') ownerUserId: string,
    @Body() body: StartProductionWorkflowDto,
  ) {
    return this.workflows.startAsync(body, ownerUserId);
  }

  @Post('workflows/:threadId/resume')
  resumeWorkflow(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Body() body: ResumeProductionWorkflowDto,
  ) {
    return this.workflows.resumeAsync(threadId, body, ownerUserId);
  }

  @Get('workflows/:threadId')
  workflowStatus(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
  ) {
    return this.workflows.status(threadId, ownerUserId);
  }

  @Post('evals')
  evaluate(@Body() body: AgentEvalDto) {
    return this.evals.evaluate(body);
  }

  @Get('bad-cases')
  badCases(
    @Query('status') status?: 'pending' | 'reviewed' | 'resolved' | 'ignored',
  ) {
    return this.feedback.list({ status, feedback: 'negative', limit: 200 });
  }

  @Patch('bad-cases/:id')
  reviewBadCase(
    @Param('id') id: string,
    @Body()
    body: {
      status?: 'pending' | 'reviewed' | 'resolved' | 'ignored';
      errorType?: string;
      correctedAnswer?: string;
      includeInRegression?: boolean;
      reviewedBy?: string;
    },
  ) {
    return this.feedback.review(id, body);
  }

  @Get('traces')
  traces(@Query('limit') limit?: string) {
    const parsed = Number(limit ?? 50);
    return this.tracing.recent(
      Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 100) : 50,
    );
  }

  @Get('runs/:threadId/artifacts')
  getRunArtifacts(@Param('threadId') threadId: string) {
    return this.agenticRag.getRunSnapshot(threadId);
  }

  @Post('runs/:threadId/retry')
  retryRun(@Param('threadId') threadId: string) {
    return this.agenticRag.retryRun(threadId);
  }
}
