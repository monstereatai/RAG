import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ServiceTokenGuard } from '../../common/guards/service-token.guard';
import { AgentEvalDto } from '../agent-evals/agent-eval.dto';
import { AgentEvalService } from '../agent-evals/agent-eval.service';
import { RagFeedbackService } from '../chat/rag-feedback.service';
import { TracingService } from '../tracing/tracing.service';
import {
  ResumeProductionWorkflowDto,
  ReviseProductionWorkflowDto,
  StartProductionWorkflowDto,
} from '../workflow/production-workflow.dto';
import { ProductionWorkflowService } from '../workflow/production-workflow.service';
import { AgenticRagService } from '../../rag/agentic/agentic-rag.service';
import { ConversationService } from '../chat/conversation.service';
import { AgentRunsService } from '../agent-runs/agent-runs.service';
import { AgentCollaborationService } from '../agent-collaboration/agent-collaboration.service';
import { AgentTasksService } from '../agent-tasks/agent-tasks.service';
import { AgentRuntimeEventsService } from '../agent-runtime-events/agent-runtime-events.service';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { JobsService } from '../jobs/jobs.service';
import type { CreateJobInput, ScheduledJobSourceType } from '../jobs/job.types';
import { GraphService } from '../graph/graph.service';
import {
  buildPlaywayActivityGraph,
  searchPlaywayActivityTemplates,
  searchPlaywayComponents,
} from '../workflow/playway-component-registry';

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
    private readonly artifacts: ArtifactsService,
    private readonly jobs: JobsService,
    private readonly graphService: GraphService,
  ) {}

  @Get('schedules')
  scheduledJobs() {
    return this.jobs.listAnalysis();
  }

  @Get('component-rules')
  componentRules(@Query('q') query = '', @Query('limit') limit?: string) {
    const parsedLimit = Number.parseInt(limit ?? '18', 10);
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 50)
      : 18;
    return {
      items: searchPlaywayComponents(query, safeLimit),
      total: searchPlaywayComponents(query, 96).length,
    };
  }

  @Get('activity-templates')
  activityTemplates(@Query('q') query = '', @Query('limit') limit?: string) {
    const parsedLimit = Number.parseInt(limit ?? '4', 10);
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 8)
      : 4;
    return {
      items: searchPlaywayActivityTemplates(query, safeLimit),
      total: searchPlaywayActivityTemplates(query, 8).length,
    };
  }

  @Get('activity-graph')
  activityGraph(@Query('q') query = '') {
    return buildPlaywayActivityGraph(query);
  }

  @Post('activity-graph/import')
  async importActivityGraph(
    @Query('ownerUserId') ownerUserId: string,
    @Body() body: { query?: string; sourceId?: string },
  ) {
    const graph = buildPlaywayActivityGraph(body.query ?? '');
    return this.graphService.importStructuredGraph(
      {
        nodes: graph.nodes.map((node) => ({
          id: node.id,
          label: node.type,
          properties: { displayName: node.label, domain: 'playway' },
        })),
        relationships: graph.edges.map((edge) => ({
          source: edge.source,
          target: edge.target,
          type: edge.relation.toUpperCase(),
          properties: { domain: 'playway' },
        })),
      },
      ownerUserId,
      body.sourceId?.trim() || `playway:${body.query?.trim() || 'all'}`,
    );
  }

  @Post('schedules/parse')
  parseScheduledAnalysis(
    @Body() body: { sourceText: string; sourceType: ScheduledJobSourceType },
  ) {
    return this.jobs.parseAnalysisDefinition(body.sourceText, body.sourceType);
  }

  @Post('schedules')
  createScheduledJob(
    @Query('ownerUserId') ownerUserId: string,
    @Body() body: CreateJobInput,
  ) {
    return this.jobs.create({
      ...body,
      taskKind: 'analysis',
      userId: ownerUserId,
    });
  }

  @Post('schedules/:id/run')
  runScheduledJob(@Param('id') id: string) {
    return this.jobs.runNow(id);
  }

  @Patch('schedules/:id/start')
  startScheduledJob(@Param('id') id: string) {
    return this.jobs.start(id);
  }

  @Patch('schedules/:id/stop')
  stopScheduledJob(@Param('id') id: string) {
    return this.jobs.stop(id);
  }

  @Get('schedules/:id/executions')
  scheduledJobExecutions(@Param('id') id: string) {
    return this.jobs.getExecutions(id, 50);
  }

  @Post('schedules/:id/copy')
  copyScheduledJob(@Param('id') id: string) {
    return this.jobs.copy(id);
  }

  @Get('schedules/:id/versions')
  scheduledJobVersions(@Param('id') id: string) {
    return this.jobs.listVersions(id);
  }

  @Post('workflows')
  startWorkflow(
    @Query('ownerUserId') ownerUserId: string,
    @Body() body: StartProductionWorkflowDto,
  ) {
    return this.workflows.startAsync(body, ownerUserId);
  }

  @Get('workflows')
  listWorkflows(@Query('ownerUserId') ownerUserId: string) {
    return this.workflows.list(ownerUserId);
  }

  @Post('workflows/:threadId/resume')
  resumeWorkflow(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Body() body: ResumeProductionWorkflowDto,
  ) {
    return this.workflows.resumeAsync(threadId, body, ownerUserId);
  }

  @Post('workflows/:threadId/revise')
  reviseWorkflow(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Body() body: ReviseProductionWorkflowDto,
  ) {
    return this.workflows.reviseAsync(threadId, body, ownerUserId);
  }

  @Get('workflows/:threadId/coding-context')
  codingContext(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
  ) {
    return this.workflows.codingContext(threadId, ownerUserId);
  }

  @Get('workflows/:threadId/playway-preview')
  playwayPreview(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
  ) {
    return this.workflows.playwayPreview(threadId, ownerUserId);
  }

  @Post('workflows/:threadId/generate-project')
  generateProject(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
  ) {
    return this.workflows.generateProject(threadId, ownerUserId);
  }

  @Post('workflows/:threadId/generate-project-zip')
  async generateProjectZip(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Res() response: Response,
  ) {
    try {
      const zip = await this.workflows.generateProjectZip(
        threadId,
        ownerUserId,
      );
      response
        .status(200)
        .type('application/zip')
        .setHeader(
          'Content-Disposition',
          `attachment; filename="${encodeURIComponent(threadId)}-project.zip"`,
        )
        .send(zip);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'project zip generation failed';
      response.status(500).json({ code: 500, data: null, message });
    }
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
      promotionAction?: 'correction' | 'request' | 'promote' | 'reject';
      promotionSource?: string;
      promotionVersion?: string;
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

  @Get('run-center/:id/artifacts')
  async runDetailArtifacts(@Param('id') id: string) {
    const run = await this.runs.get(id);
    const [files, snapshot] = await Promise.all([
      this.artifacts.listForRunAudit(run.threadId),
      this.agenticRag.getRunSnapshot(run.threadId),
    ]);
    return {
      threadId: run.threadId,
      files,
      structuredArtifacts: snapshot.artifacts,
      checkpointAvailable: snapshot.available,
    };
  }

  @Post('run-center/:id/retry')
  retryRunRecord(@Param('id') id: string) {
    return this.runs.retry(id);
  }

  @Get('collaboration/sops')
  collaborationSops() {
    return this.collaboration.listSops();
  }

  @Post('collaboration/sops')
  saveCollaborationSop(@Body() body: any) {
    return this.collaboration.upsertSop(body);
  }

  @Get('collaboration/messages')
  collaborationMessages(@Query('threadId') threadId?: string) {
    return this.collaboration.listMessages(threadId);
  }

  @Post('collaboration/messages')
  publishCollaborationMessage(@Body() body: any) {
    return this.collaboration.publishMessage(body);
  }

  @Get('collaboration/dependencies')
  collaborationDependencies(@Query('threadId') threadId?: string) {
    return this.collaboration.listDependencies(threadId);
  }

  @Post('collaboration/decisions')
  createCollaborationDecision(@Body() body: any) {
    return this.collaboration.createDecision({
      ...body,
      createdBy: body.createdBy ?? 'admin-backend',
    });
  }

  @Get('collaboration/decisions')
  collaborationDecisions(@Query('threadId') threadId?: string) {
    return this.collaboration.listDecisions(threadId);
  }

  @Get('collaboration/conflicts/:threadId')
  collaborationConflicts(@Param('threadId') threadId: string) {
    return this.collaboration.detectConflicts(threadId);
  }

  @Get('collaboration/replay/:threadId')
  collaborationReplay(@Param('threadId') threadId: string) {
    return this.collaboration.collaborationSnapshot(threadId);
  }

  @Get('tasks')
  listAgentTasks(@Query('threadId') threadId?: string) {
    return this.tasks.list(threadId);
  }

  @Post('tasks/:id/retry')
  retryAgentTask(@Param('id') id: string) {
    return this.tasks.retry(id);
  }

  @Post('tasks/delegate')
  async delegateAgentTask(@Body() body: any) {
    if (body.runId) await this.runs.reserveDelegation(body.runId);
    return this.tasks.delegate(body);
  }

  @Get('runtime-events')
  runtimeEventsList(
    @Query('threadId') threadId?: string,
    @Query('runId') runId?: string,
  ) {
    return this.runtimeEvents.list(threadId, runId);
  }

  @Get('runtime-events/metrics')
  runtimeEventMetrics(
    @Query('threadId') threadId?: string,
    @Query('runId') runId?: string,
  ) {
    return this.runtimeEvents.metrics(threadId, runId);
  }
}
