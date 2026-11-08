import {
  All,
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Optional,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ServiceTokenGuard } from '../../common/guards/service-token.guard';
import { retryAgentRunRecord } from './retry-agent-run-record';
import { Public } from '../../common/decorators/public.decorator';
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
import {
  ApplyProductionCodeEditDto,
  ApplyProductionArtifactEditDto,
  GenerateProductionArtifactsDto,
  ProposeProductionCodeEditDto,
  ProposeProductionArtifactEditDto,
  RestoreProductionArtifactVersionDto,
} from '../workflow/production-artifact-studio.dto';
import { ProductionArtifactStudioService } from '../workflow/production-artifact-studio.service';
import { ProductionProjectWorkspaceService } from '../workflow/production-project-workspace.service';
import { ProductionProjectWorkspaceAgentService } from '../workflow/production-project-workspace-agent.service';
import { CodingTaskService } from '../workflow/coding-task.service';
import {
  CreateProductionProjectWorkspacePreviewTicketDto,
  DestroyProductionProjectWorkspaceDto,
  RunProductionProjectWorkspaceAgentDto,
  RunProductionProjectWorkspaceCommandDto,
  StartProductionProjectWorkspaceDevServerDto,
  StartProductionProjectWorkspaceDto,
  SubmitWorkspaceCodingTaskDto,
} from '../workflow/production-project-workspace.dto';
import { AgenticRagService } from '../../rag/agentic/agentic-rag.service';
import { ConversationService } from '../chat/conversation.service';
import { ChatService } from '../chat/chat.service';
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

type AgentTaskDelegationBody = {
  ownerUserId?: unknown;
  threadId?: unknown;
  runId?: unknown;
  parentTaskId?: unknown;
  role?: unknown;
  title?: unknown;
  description?: unknown;
  processType?: unknown;
  dependsOnTaskIds?: unknown;
};

function readRequiredBodyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`${field} is required`);
  }
  return value.trim();
}

function readOptionalBodyString(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`${field} must be a non-empty string`);
  }
  return value.trim();
}

@Public()
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
    private readonly artifactStudio: ProductionArtifactStudioService,
    private readonly projectWorkspace: ProductionProjectWorkspaceService,
    private readonly projectWorkspaceAgent: ProductionProjectWorkspaceAgentService,
    private readonly codingTasks: CodingTaskService,
    @Optional() private readonly chat?: ChatService,
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

  @Post('workflows/:threadId/cancel')
  cancelWorkflow(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Body() body: { reason?: string },
  ) {
    return this.workflows.cancel(threadId, ownerUserId, undefined, body.reason);
  }

  @Get('workflows/:threadId/coding-context')
  codingContext(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
  ) {
    return this.workflows.codingContext(threadId, ownerUserId);
  }

  @Get('workflows/:threadId/handoff')
  handoff(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
  ) {
    return this.workflows.handoffManifest(threadId, ownerUserId);
  }

  @Get('workflows/:threadId/artifacts')
  productionArtifacts(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
  ) {
    return this.artifactStudio.list(threadId, ownerUserId);
  }

  @Post('workflows/:threadId/artifacts/generate')
  generateProductionArtifacts(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Body() body: GenerateProductionArtifactsDto,
  ) {
    return this.artifactStudio.generate(
      threadId,
      ownerUserId,
      undefined,
      body.targets,
    );
  }

  @Post('workflows/:threadId/artifacts/edit')
  proposeProductionArtifactEdit(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Body() body: ProposeProductionArtifactEditDto,
  ) {
    return this.artifactStudio.proposeEdit(
      threadId,
      ownerUserId,
      body.target,
      body.baseArtifactId,
      body.instruction,
    );
  }

  @Post('workflows/:threadId/artifacts/code-edit')
  proposeProductionCodeEdit(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Body() body: ProposeProductionCodeEditDto,
  ) {
    return this.artifactStudio.proposeCodeEdit(
      threadId,
      ownerUserId,
      body.baseArtifactId,
      body.instruction,
    );
  }

  @Post('workflows/:threadId/artifacts/code-edit/apply')
  applyProductionCodeEdit(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Body() body: ApplyProductionCodeEditDto,
  ) {
    return this.artifactStudio.applyCodeEdit(
      threadId,
      ownerUserId,
      undefined,
      body,
    );
  }

  @Post('workflows/:threadId/artifacts/apply')
  applyProductionArtifactEdit(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Body() body: ApplyProductionArtifactEditDto,
  ) {
    return this.artifactStudio.applyEdit(
      threadId,
      ownerUserId,
      undefined,
      body,
    );
  }

  @Post('workflows/:threadId/artifacts/restore')
  restoreProductionArtifactVersion(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Body() body: RestoreProductionArtifactVersionDto,
  ) {
    return this.artifactStudio.restore(
      threadId,
      ownerUserId,
      undefined,
      body.artifactId,
    );
  }

  @Post('workflows/:threadId/artifacts/:artifactId/simulated-sync')
  simulateProductionArtifactSync(
    @Param('threadId') threadId: string,
    @Param('artifactId') artifactId: string,
    @Query('ownerUserId') ownerUserId: string,
  ) {
    return this.artifactStudio.simulateSync(threadId, ownerUserId, artifactId);
  }

  @Get('workflows/:threadId/artifacts/:artifactId/preview')
  previewProductionArtifact(
    @Param('threadId') threadId: string,
    @Param('artifactId') artifactId: string,
    @Query('ownerUserId') ownerUserId: string,
  ) {
    return this.artifactStudio.preview(threadId, ownerUserId, artifactId);
  }

  @Get('workflows/:threadId/artifacts/:artifactId/source')
  sourceProductionArtifact(
    @Param('threadId') threadId: string,
    @Param('artifactId') artifactId: string,
    @Query('ownerUserId') ownerUserId: string,
  ) {
    return this.artifactStudio.source(threadId, ownerUserId, artifactId);
  }

  @Get('workflows/:threadId/artifacts/:artifactId/download')
  async downloadProductionArtifact(
    @Param('threadId') threadId: string,
    @Param('artifactId') artifactId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Res() response: Response,
  ) {
    const file = await this.artifactStudio.download(
      threadId,
      ownerUserId,
      artifactId,
    );
    response
      .status(200)
      .type(file.artifact.contentType ?? 'application/octet-stream')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(file.artifact.filename)}"`,
      )
      .send(file.body);
  }

  @Get('workflows/:threadId/workspace')
  productionProjectWorkspaceStatus(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.projectWorkspace.getStatus(threadId, ownerUserId, tenantId);
  }

  @Post('workflows/:threadId/workspace/start')
  startProductionProjectWorkspace(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() body: StartProductionProjectWorkspaceDto,
  ) {
    return this.projectWorkspace.startWorkspace(
      threadId,
      ownerUserId,
      tenantId,
      body.artifactId,
    );
  }

  @Post('workflows/:threadId/workspace/agent')
  runProductionProjectWorkspaceAgent(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() body: RunProductionProjectWorkspaceAgentDto,
  ) {
    return this.projectWorkspaceAgent.run(
      threadId,
      ownerUserId,
      tenantId,
      body.artifactId,
      body.instruction,
    );
  }

  @Post('workflows/:threadId/workspace/coding-tasks')
  async submitProductionProjectWorkspaceCodingTask(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() body: SubmitWorkspaceCodingTaskDto,
  ) {
    await this.workflows.assertOwnedThread(threadId, ownerUserId);
    return this.codingTasks.submit({ threadId, ownerUserId, tenantId, body });
  }

  @Get('workflows/:threadId/workspace/coding-tasks/:taskId')
  productionProjectWorkspaceCodingTaskStatus(
    @Param('threadId') threadId: string,
    @Param('taskId') taskId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.codingTasks.get({ taskId, threadId, ownerUserId, tenantId });
  }

  @Post('workflows/:threadId/workspace/coding-tasks/:taskId/cancel')
  cancelProductionProjectWorkspaceCodingTask(
    @Param('threadId') threadId: string,
    @Param('taskId') taskId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() body: { reason?: string },
  ) {
    return this.codingTasks.cancel({
      taskId,
      threadId,
      ownerUserId,
      tenantId,
      reason: body?.reason,
    });
  }

  @Post('workflows/:threadId/workspace/coding-tasks/:taskId/resume')
  resumeProductionProjectWorkspaceCodingTask(
    @Param('threadId') threadId: string,
    @Param('taskId') taskId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Query('tenantId') tenantId: string | undefined,
  ) {
    return this.codingTasks.resume({ taskId, threadId, ownerUserId, tenantId });
  }

  @Post('workflows/:threadId/workspace/command')
  runProductionProjectWorkspaceCommand(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() body: RunProductionProjectWorkspaceCommandDto,
  ) {
    return this.projectWorkspace.runCommand(
      threadId,
      ownerUserId,
      tenantId,
      body.command,
      body.timeoutSeconds,
    );
  }

  @Post('workflows/:threadId/workspace/dev-server/start')
  startProductionProjectWorkspaceDevServer(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() body: StartProductionProjectWorkspaceDevServerDto,
  ) {
    return this.projectWorkspace.startDevServer(
      threadId,
      ownerUserId,
      tenantId,
      {
        port: body.port,
        command: body.command,
      },
    );
  }

  @Post('workflows/:threadId/workspace/dev-server/stop')
  stopProductionProjectWorkspaceDevServer(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Query('tenantId') tenantId: string | undefined,
  ) {
    return this.projectWorkspace.stopDevServer(threadId, ownerUserId, tenantId);
  }

  @Post('workflows/:threadId/workspace/preview-ticket')
  createProductionProjectWorkspacePreviewTicket(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() body: CreateProductionProjectWorkspacePreviewTicketDto,
  ) {
    return this.projectWorkspace.issuePreviewTicket(
      threadId,
      ownerUserId,
      tenantId,
      body.port,
    );
  }

  @All('workflows/:threadId/workspace/preview/:ticket/{*path}')
  async proxyProductionProjectWorkspacePreview(
    @Param('threadId') threadId: string,
    @Param('ticket') ticket: string,
    @Param('path') path: string[] | string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const normalizedPath = Array.isArray(path) ? path.join('/') : (path ?? '');
    const segments = normalizedPath.split('/').filter(Boolean);
    if (
      segments.some(
        (segment) =>
          segment === '.' ||
          segment === '..' ||
          segment.length > 255 ||
          segment.includes('\0'),
      )
    ) {
      throw new BadRequestException('invalid workspace preview path');
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      throw new BadRequestException('workspace preview supports GET and HEAD');
    }
    const query = request.originalUrl.includes('?')
      ? request.originalUrl.slice(request.originalUrl.indexOf('?') + 1)
      : '';
    if (query.length > 8_192) {
      throw new BadRequestException('workspace preview query is too long');
    }
    const abortController = new AbortController();
    const abortWhenDisconnected = () => {
      if (!response.writableEnded) abortController.abort();
    };
    request.once('aborted', abortWhenDisconnected);
    response.once('close', abortWhenDisconnected);
    const headers: Record<string, string> = {};
    for (const name of [
      'accept',
      'if-none-match',
      'if-modified-since',
      'range',
    ]) {
      const value = request.headers[name];
      if (typeof value === 'string') headers[name] = value.slice(0, 2_000);
    }
    let result: Awaited<
      ReturnType<ProductionProjectWorkspaceService['proxyPreview']>
    >;
    try {
      result = await this.projectWorkspace.proxyPreview(ticket, threadId, {
        method: request.method as 'GET' | 'HEAD',
        headers,
        query,
        path: segments.join('/'),
        signal: abortController.signal,
      });
    } finally {
      request.off('aborted', abortWhenDisconnected);
      response.off('close', abortWhenDisconnected);
    }
    if (!response.destroyed) {
      response.status(result.status).set(result.headers).send(result.body);
    }
  }

  @Post('workflows/:threadId/workspace/export')
  async exportProductionProjectWorkspace(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Query('tenantId') tenantId: string | undefined,
  ) {
    const artifact = await this.projectWorkspace.exportWorkspace(
      threadId,
      ownerUserId,
      tenantId,
    );
    return { artifact };
  }

  @Delete('workflows/:threadId/workspace')
  destroyProductionProjectWorkspace(
    @Param('threadId') threadId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() body: DestroyProductionProjectWorkspaceDto,
  ) {
    return this.projectWorkspace.destroyWorkspace(
      threadId,
      ownerUserId,
      tenantId,
      body.confirmDiscard,
    );
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
  async retryRunRecord(@Param('id') id: string) {
    return retryAgentRunRecord(id, this.runs, this.agenticRag, this.chat);
  }

  @Post('run-center/:id/cancel')
  cancelRunRecord(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.runs.cancel(id, body.reason);
  }

  @Get('collaboration/sops')
  collaborationSops() {
    return this.collaboration.listSops();
  }

  @Post('collaboration/sops')
  saveCollaborationSop(
    @Body() body: Parameters<AgentCollaborationService['upsertSop']>[0],
  ) {
    return this.collaboration.upsertSop(body);
  }

  @Get('collaboration/messages')
  collaborationMessages(@Query('threadId') threadId?: string) {
    return this.collaboration.listMessages(threadId);
  }

  @Post('collaboration/messages')
  publishCollaborationMessage(
    @Body() body: Parameters<AgentCollaborationService['publishMessage']>[0],
  ) {
    return this.collaboration.publishMessage(body);
  }

  @Get('collaboration/dependencies')
  collaborationDependencies(@Query('threadId') threadId?: string) {
    return this.collaboration.listDependencies(threadId);
  }

  @Post('collaboration/decisions')
  createCollaborationDecision(
    @Body() body: Parameters<AgentCollaborationService['createDecision']>[0],
  ) {
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
  async listAgentTasks(
    @Query('threadId') threadId: string | undefined,
    @Query('ownerUserId') ownerUserId: string,
  ) {
    if (!ownerUserId?.trim()) {
      throw new Error('ownerUserId is required for task listing');
    }
    if (threadId) {
      await this.workflows.assertOwnedThread(threadId, ownerUserId);
      return this.tasks.list(threadId);
    }
    const workflows = await this.workflows.list(ownerUserId);
    const ownedThreads = new Set(workflows.map((item) => item.threadId));
    const tasks = await this.tasks.list();
    return tasks.filter((task) => ownedThreads.has(task.threadId));
  }

  @Post('tasks/:id/retry')
  async retryAgentTask(
    @Param('id') id: string,
    @Query('ownerUserId') ownerUserId: string,
  ) {
    const task = await this.tasks.findById(id);
    await this.workflows.assertOwnedThread(task.threadId, ownerUserId);
    return this.tasks.retry(id);
  }

  @Post('tasks/delegate')
  async delegateAgentTask(@Body() body: AgentTaskDelegationBody) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Request body must be an object.');
    }
    const ownerUserId = readRequiredBodyString(body.ownerUserId, 'ownerUserId');
    const threadId = readRequiredBodyString(body.threadId, 'threadId');
    const runId = readOptionalBodyString(body.runId, 'runId');
    const parentTaskId = readOptionalBodyString(
      body.parentTaskId,
      'parentTaskId',
    );
    const role = readRequiredBodyString(body.role, 'role');
    const title = readRequiredBodyString(body.title, 'title');
    const description = readRequiredBodyString(body.description, 'description');
    const processType = readOptionalBodyString(body.processType, 'processType');
    const rawDependencies = body.dependsOnTaskIds;
    if (
      rawDependencies !== undefined &&
      rawDependencies !== null &&
      (!Array.isArray(rawDependencies) ||
        rawDependencies.length > 50 ||
        !rawDependencies.every(
          (item) =>
            typeof item === 'string' &&
            item.trim().length > 0 &&
            item.length <= 64,
        ))
    ) {
      throw new BadRequestException(
        'dependsOnTaskIds must contain at most 50 non-empty task IDs',
      );
    }

    await this.workflows.assertOwnedThread(threadId, ownerUserId);
    if (runId) {
      const run = await this.runs.get(runId);
      if (run.threadId !== threadId || run.userId !== ownerUserId) {
        throw new NotFoundException('Agent run not found.');
      }
    }
    const referencedTaskIds = [
      ...(parentTaskId ? [parentTaskId] : []),
      ...(Array.isArray(rawDependencies) ? rawDependencies : []),
    ];
    const referencedTasks = await Promise.all(
      referencedTaskIds.map((id) => this.tasks.findById(id)),
    );
    const expectedRunId = runId ?? null;
    if (
      referencedTasks.some(
        (task) =>
          task.threadId !== threadId || task.runId !== expectedRunId,
      )
    ) {
      throw new NotFoundException('Agent task not found.');
    }
    if (runId) await this.runs.reserveDelegation(runId);
    return this.tasks.delegate({
      threadId,
      runId,
      parentTaskId,
      role,
      title,
      description,
      processType,
      dependsOnTaskIds: Array.isArray(rawDependencies)
        ? rawDependencies.map((item) => (item as string).trim())
        : undefined,
    });
  }

  @Get('runtime-events')
  runtimeEventsList(
    @Query('threadId') threadId?: string,
    @Query('runId') runId?: string,
    @Query('beforeSequence') beforeSequence?: string,
    @Query('limit') limit?: string,
  ) {
    const cursor = Number(beforeSequence);
    const pageSize = Number(limit);
    return this.runtimeEvents.list(
      threadId,
      runId,
      'legacy',
      Number.isFinite(cursor) && cursor > 0 ? cursor : undefined,
      Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 200,
    );
  }

  @Get('runtime-events/metrics')
  runtimeEventMetrics(
    @Query('threadId') threadId?: string,
    @Query('runId') runId?: string,
  ) {
    return this.runtimeEvents.metrics(threadId, runId);
  }

  @Get('runs/summary')
  agentRunSummary(@Query('limit') limit?: string) {
    return this.runs.summary(Number(limit) || 500);
  }
}
