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
import { ConversationService } from '../chat/conversation.service';
import { AgentRunsService } from '../agent-runs/agent-runs.service';
import { AgentCollaborationService } from '../agent-collaboration/agent-collaboration.service';
import { AgentTasksService } from '../agent-tasks/agent-tasks.service';
import { AgentRuntimeEventsService } from '../agent-runtime-events/agent-runtime-events.service';

@Controller('rag/admin/agent-ops')
@UseGuards(ServiceTokenGuard)
export class AgentOpsAdminController {
  constructor(
    private readonly workflows: ProductionWorkflowService,
    private readonly evals: AgentEvalService,
    private readonly feedback: RagFeedbackService,
    private readonly tracing: TracingService,
    private readonly agenticRag: AgenticRagService,
    private readonly conversations: ConversationService,
    private readonly runs: AgentRunsService,
    private readonly collaboration: AgentCollaborationService,
    private readonly tasks: AgentTasksService,
    private readonly runtimeEvents: AgentRuntimeEventsService,
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

  @Get('runs')
  async recentRuns(@Query('limit') limit?: string) {
    const parsed = Number(limit ?? 30);
    const max = Number.isInteger(parsed)
      ? Math.min(Math.max(parsed, 1), 100)
      : 30;
    const conversations = await this.conversations.listConversations();
    const candidates = conversations
      .filter((item) => item.mode !== 'simple')
      .slice(0, max);
    const runs = await Promise.all(
      candidates.map(async (item) => {
        const snapshot = await this.agenticRag.getRunSnapshot(item.threadId);
        return {
          ...item,
          checkpointAvailable: snapshot.available,
          route: snapshot.route,
          retrievalSufficient: snapshot.retrievalSufficient,
        };
      }),
    );
    return runs;
  }

  @Post('runs/:threadId/retry')
  retryRun(@Param('threadId') threadId: string) {
    return this.agenticRag.retryRun(threadId);
  }

  @Get('run-center')
  runCenter(@Query('limit') limit?: string) {
    return this.runs.list(Number(limit ?? 50));
  }

  @Get('run-center/:id')
  runDetail(@Param('id') id: string) {
    return this.runs.get(id);
  }

  @Post('run-center/:id/retry')
  retryRunRecord(@Param('id') id: string) {
    return this.runs.retry(id);
  }

  @Get('collaboration/sops')
  collaborationSops() { return this.collaboration.listSops(); }

  @Post('collaboration/sops')
  saveCollaborationSop(@Body() body: any) { return this.collaboration.upsertSop(body); }

  @Get('collaboration/messages')
  collaborationMessages(@Query('threadId') threadId?: string) { return this.collaboration.listMessages(threadId); }

  @Post('collaboration/messages')
  publishCollaborationMessage(@Body() body: any) { return this.collaboration.publishMessage(body); }

  @Get('collaboration/dependencies')
  collaborationDependencies(@Query('threadId') threadId?: string) { return this.collaboration.listDependencies(threadId); }

  @Post('collaboration/decisions')
  createCollaborationDecision(@Body() body: any) { return this.collaboration.createDecision({ ...body, createdBy: body.createdBy ?? 'admin-backend' }); }

  @Get('collaboration/decisions')
  collaborationDecisions(@Query('threadId') threadId?: string) { return this.collaboration.listDecisions(threadId); }

  @Get('collaboration/conflicts/:threadId')
  collaborationConflicts(@Param('threadId') threadId: string) { return this.collaboration.detectConflicts(threadId); }

  @Get('collaboration/replay/:threadId')
  collaborationReplay(@Param('threadId') threadId: string) { return this.collaboration.collaborationSnapshot(threadId); }

  @Get('tasks')
  listAgentTasks(@Query('threadId') threadId?: string) { return this.tasks.list(threadId); }

  @Post('tasks/:id/retry')
  retryAgentTask(@Param('id') id: string) { return this.tasks.retry(id); }

  @Post('tasks/delegate')
  async delegateAgentTask(@Body() body: any) {
    if (body.runId) await this.runs.reserveDelegation(body.runId);
    return this.tasks.delegate(body);
  }

  @Get('runtime-events')
  runtimeEventsList(@Query('threadId') threadId?: string, @Query('runId') runId?: string) {
    return this.runtimeEvents.list(threadId, runId);
  }

  @Get('runtime-events/metrics')
  runtimeEventMetrics(@Query('threadId') threadId?: string) {
    return this.runtimeEvents.metrics(threadId);
  }
}
