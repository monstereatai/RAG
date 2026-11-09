import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Head,
  HttpException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { RequireLogin } from '../../common/decorators/require-login.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RagClientService } from '../rag-client/rag-client.service';

const WORKSPACE_PREVIEW_ABORT_TIMEOUT_MS = 80_000;

@ApiTags('Agent Ops')
@ApiBearerAuth()
@Controller('admin/agent-ops')
export class AgentOpsController {
  constructor(private readonly ragClient: RagClientService) {}

  @Get('schedules')
  @RequirePermission('admin:qa-ops:read')
  schedules() {
    return this.ragClient.listScheduledAnalysisJobs();
  }

  @Get('security/policies')
  @RequirePermission('admin:qa-ops:read')
  securityPolicies() {
    return this.ragClient.listSecurityPolicies();
  }

  @Get('security/audit')
  @RequirePermission('admin:qa-ops:read')
  securityAudit(@Query('limit') limit?: string) {
    return this.ragClient.listSecurityAudit(Number(limit) || 100);
  }

  @Post('schedules/parse')
  @RequirePermission('admin:qa-ops:write')
  parseSchedule(@Body() body: unknown) {
    return this.ragClient.parseScheduledAnalysisJob(body);
  }

  @Post('schedules')
  @RequirePermission('admin:qa-ops:write')
  createSchedule(@Body() body: unknown, @Req() req: Request) {
    return this.ragClient.createScheduledAnalysisJob(this.userId(req), body);
  }

  @Post('schedules/:id/run')
  @RequirePermission('admin:qa-ops:write')
  runSchedule(@Param('id') id: string) {
    return this.ragClient.runScheduledAnalysisJob(id);
  }

  @Patch('schedules/:id/start')
  @RequirePermission('admin:qa-ops:write')
  startSchedule(@Param('id') id: string) {
    return this.ragClient.startScheduledAnalysisJob(id);
  }

  @Patch('schedules/:id/stop')
  @RequirePermission('admin:qa-ops:write')
  stopSchedule(@Param('id') id: string) {
    return this.ragClient.stopScheduledAnalysisJob(id);
  }

  @Get('schedules/:id/executions')
  @RequirePermission('admin:qa-ops:read')
  scheduleExecutions(@Param('id') id: string) {
    return this.ragClient.listScheduledAnalysisExecutions(id);
  }

  @Post('schedules/:id/copy')
  @RequirePermission('admin:qa-ops:write')
  copySchedule(@Param('id') id: string) { return this.ragClient.copyScheduledAnalysisJob(id); }

  @Get('schedules/:id/versions')
  @RequirePermission('admin:qa-ops:read')
  scheduleVersions(@Param('id') id: string) { return this.ragClient.listScheduledAnalysisVersions(id); }

  @Post('workflows')
  @ApiOperation({ summary: '启动产研运工作流' })
  @RequirePermission('admin:qa-ops:write')
  startWorkflow(@Body() body: unknown, @Req() req: Request) {
    return this.ragClient.startProductionWorkflow(this.userId(req), body);
  }

  @Get('workflows')
  @RequirePermission('admin:qa-ops:read')
  listWorkflows(@Req() req: Request) {
    return this.ragClient.listProductionWorkflows(this.userId(req));
  }

  @Get('component-rules')
  @RequirePermission('admin:qa-ops:read')
  listComponentRules(@Query('q') query?: string, @Query('limit') limit?: string) {
    return this.ragClient.listProductionComponentRules(query ?? '', Number(limit) || 18);
  }

  @Get('activity-templates')
  @RequirePermission('admin:qa-ops:read')
  listActivityTemplates(@Query('q') query?: string, @Query('limit') limit?: string) {
    return this.ragClient.listProductionActivityTemplates(query ?? '', Number(limit) || 4);
  }

  @Get('activity-graph')
  @RequirePermission('admin:qa-ops:read')
  getActivityGraph(@Query('q') query?: string) {
    return this.ragClient.getProductionActivityGraph(query ?? '');
  }

  @Post('activity-graph/import')
  @RequirePermission('admin:qa-ops:write')
  importActivityGraph(@Body() body: unknown, @Req() req: Request) {
    return this.ragClient.importProductionPlaywayGraph(this.userId(req), body);
  }

  @Post('workflows/:threadId/resume')
  @ApiOperation({ summary: '审批并恢复产研运工作流' })
  @RequirePermission('admin:qa-ops:write')
  resumeWorkflow(
    @Param('threadId') threadId: string,
    @Body() body: unknown,
    @Req() req: Request
  ) {
    return this.ragClient.resumeProductionWorkflow(
      threadId,
      this.userId(req),
      body
    );
  }

  @Post('workflows/:threadId/revise')
  @ApiOperation({ summary: '按驳回意见生成新版本并局部重跑' })
  @RequirePermission('admin:qa-ops:write')
  reviseWorkflow(
    @Param('threadId') threadId: string,
    @Body() body: unknown,
    @Req() req: Request
  ) {
    return this.ragClient.reviseProductionWorkflow(threadId, this.userId(req), body);
  }

  @Post('workflows/:threadId/cancel')
  @ApiOperation({ summary: '取消正在执行或等待审批的产研运工作流' })
  @RequirePermission('admin:qa-ops:write')
  cancelWorkflow(
    @Param('threadId') threadId: string,
    @Body() body: { reason?: string },
    @Req() req: Request
  ) {
    return this.ragClient.cancelProductionWorkflow(
      threadId,
      this.userId(req),
      body
    );
  }

  @Get('workflows/:threadId/coding-context')
  @RequirePermission('admin:qa-ops:read')
  getWorkflowCodingContext(@Param('threadId') threadId: string, @Req() req: Request) {
    return this.ragClient.getProductionWorkflowCodingContext(threadId, this.userId(req));
  }

  @Get('workflows/:threadId/playway-preview')
  @RequirePermission('admin:qa-ops:read')
  getWorkflowPlaywayPreview(@Param('threadId') threadId: string, @Req() req: Request) {
    return this.ragClient.getProductionPlaywayPreview(threadId, this.userId(req));
  }

  @Post('workflows/:threadId/generate-project')
  @RequirePermission('admin:qa-ops:write')
  generateWorkflowProject(@Param('threadId') threadId: string, @Req() req: Request) {
    return this.ragClient.generateProductionWorkflowProject(threadId, this.userId(req));
  }

  @Get('workflows/:threadId/artifacts')
  @RequirePermission('admin:qa-ops:read')
  listWorkflowArtifacts(@Param('threadId') threadId: string, @Req() req: Request) {
    return this.ragClient.getProductionWorkflowArtifacts(threadId, this.userId(req));
  }

  @Post('workflows/:threadId/artifacts/generate')
  @RequirePermission('admin:qa-ops:write')
  generateWorkflowArtifacts(
    @Param('threadId') threadId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.ragClient.generateProductionWorkflowArtifacts(
      threadId,
      this.userId(req),
      body,
    );
  }

  @Post('workflows/:threadId/artifacts/edit')
  @RequirePermission('admin:qa-ops:write')
  proposeWorkflowArtifactEdit(
    @Param('threadId') threadId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.ragClient.proposeProductionWorkflowArtifactEdit(
      threadId,
      this.userId(req),
      body,
    );
  }

  @Post('workflows/:threadId/artifacts/code-edit')
  @RequirePermission('admin:qa-ops:write')
  proposeWorkflowCodeEdit(
    @Param('threadId') threadId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.ragClient.proposeProductionWorkflowCodeEdit(
      threadId,
      this.userId(req),
      body,
    );
  }

  @Post('workflows/:threadId/artifacts/code-edit/apply')
  @RequirePermission('admin:qa-ops:write')
  applyWorkflowCodeEdit(
    @Param('threadId') threadId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.ragClient.applyProductionWorkflowCodeEdit(
      threadId,
      this.userId(req),
      body,
    );
  }

  @Post('workflows/:threadId/artifacts/apply')
  @RequirePermission('admin:qa-ops:write')
  applyWorkflowArtifactEdit(
    @Param('threadId') threadId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.ragClient.applyProductionWorkflowArtifactEdit(
      threadId,
      this.userId(req),
      body,
    );
  }

  @Post('workflows/:threadId/artifacts/restore')
  @RequirePermission('admin:qa-ops:write')
  restoreWorkflowArtifactVersion(
    @Param('threadId') threadId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.ragClient.restoreProductionWorkflowArtifactVersion(
      threadId,
      this.userId(req),
      body,
    );
  }

  @Post('workflows/:threadId/artifacts/:artifactId/simulated-sync')
  @RequirePermission('admin:qa-ops:write')
  simulateWorkflowArtifactSync(
    @Param('threadId') threadId: string,
    @Param('artifactId') artifactId: string,
    @Req() req: Request,
  ) {
    return this.ragClient.simulateProductionWorkflowArtifactSync(
      threadId,
      this.userId(req),
      artifactId,
    );
  }

  @Get('workflows/:threadId/artifacts/:artifactId/preview')
  @RequirePermission('admin:qa-ops:read')
  previewWorkflowArtifact(
    @Param('threadId') threadId: string,
    @Param('artifactId') artifactId: string,
    @Req() req: Request,
  ) {
    return this.ragClient.previewProductionWorkflowArtifact(
      threadId,
      this.userId(req),
      artifactId,
    );
  }

  @Get('workflows/:threadId/artifacts/:artifactId/source')
  @RequirePermission('admin:qa-ops:read')
  sourceWorkflowArtifact(
    @Param('threadId') threadId: string,
    @Param('artifactId') artifactId: string,
    @Req() req: Request,
  ) {
    return this.ragClient.sourceProductionWorkflowArtifact(
      threadId,
      this.userId(req),
      artifactId,
    );
  }

  @Get('workflows/:threadId/artifacts/:artifactId/download')
  @RequirePermission('admin:qa-ops:read')
  async downloadWorkflowArtifact(
    @Param('threadId') threadId: string,
    @Param('artifactId') artifactId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const response = await this.ragClient.downloadProductionWorkflowArtifact(
      threadId,
      this.userId(req),
      artifactId,
    );
    res.status(response.status ?? 500);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    return res.send(Buffer.from(await response.arrayBuffer()));
  }

  @Get('workflows/:threadId/workspace')
  @RequirePermission('admin:qa-ops:read')
  workflowWorkspace(@Param('threadId') threadId: string, @Req() req: Request) {
    return this.ragClient.getProductionWorkflowWorkspace(
      threadId,
      this.userId(req),
      this.tenantId(req),
    );
  }

  @Post('workflows/:threadId/workspace/start')
  @RequirePermission('admin:qa-ops:write')
  startWorkflowWorkspace(
    @Param('threadId') threadId: string,
    @Body() body: { artifactId: string; role?: 'frontend' | 'backend' | 'qa' },
    @Req() req: Request,
  ) {
    return this.ragClient.startProductionWorkflowWorkspace(
      threadId,
      this.userId(req),
      this.tenantId(req),
      body,
    );
  }

  @Post('workflows/:threadId/workspace/agent')
  @RequirePermission('admin:qa-ops:write')
  runWorkflowWorkspaceAgent(
    @Param('threadId') threadId: string,
    @Body() body: { artifactId: string; instruction: string },
    @Req() req: Request,
  ) {
    return this.ragClient.runProductionWorkflowWorkspaceAgent(
      threadId,
      this.userId(req),
      this.tenantId(req),
      body,
    );
  }

  @Post('workflows/:threadId/workspace/coding-tasks')
  @RequirePermission('admin:qa-ops:write')
  submitWorkflowWorkspaceCodingTask(
    @Param('threadId') threadId: string,
    @Body()
    body: {
      artifactId: string;
      instruction: string;
      requestId: string;
      role?: 'frontend' | 'backend' | 'qa';
      task?: 'code' | 'verify';
    },
    @Req() req: Request,
  ) {
    return this.ragClient.submitProductionWorkflowWorkspaceCodingTask(
      threadId,
      this.userId(req),
      this.tenantId(req),
      body,
    );
  }

  @Get('workflows/:threadId/workspace/coding-tasks/:taskId')
  @RequirePermission('admin:qa-ops:read')
  getWorkflowWorkspaceCodingTask(
    @Param('threadId') threadId: string,
    @Param('taskId') taskId: string,
    @Req() req: Request,
  ) {
    return this.ragClient.getProductionWorkflowWorkspaceCodingTask(
      threadId,
      taskId,
      this.userId(req),
      this.tenantId(req),
    );
  }

  @Get('workflows/:threadId/workspace/coding-tasks/:taskId/report/download')
  @RequirePermission('admin:qa-ops:read')
  async downloadWorkflowWorkspaceCodingTaskReport(
    @Param('threadId') threadId: string,
    @Param('taskId') taskId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const response =
      await this.ragClient.downloadProductionWorkflowWorkspaceCodingTaskReport(
        threadId,
        taskId,
        this.userId(req),
        this.tenantId(req),
      );
    res.status(response.status ?? 500);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    return res.send(Buffer.from(await response.arrayBuffer()));
  }

  @Get('workflows/:threadId/workspace/coding-tasks/:taskId/logs/download')
  @RequirePermission('admin:qa-ops:read')
  async downloadWorkflowWorkspaceCodingTaskLogs(
    @Param('threadId') threadId: string,
    @Param('taskId') taskId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const response =
      await this.ragClient.downloadProductionWorkflowWorkspaceCodingTaskLogs(
        threadId,
        taskId,
        this.userId(req),
        this.tenantId(req),
      );
    res.status(response.status ?? 500);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    return res.send(Buffer.from(await response.arrayBuffer()));
  }

  @Post('workflows/:threadId/workspace/coding-tasks/:taskId/review')
  @RequirePermission('admin:qa-ops:write')
  reviewWorkflowWorkspaceCodingTask(
    @Param('threadId') threadId: string,
    @Param('taskId') taskId: string,
    @Body()
    body: {
      reviewId: string;
      decision: 'approved' | 'rejected';
      comment?: string;
      remediationTaskId?: string;
    },
    @Req() req: Request,
  ) {
    return this.ragClient.reviewProductionWorkflowWorkspaceCodingTask(
      threadId,
      taskId,
      this.userId(req),
      this.tenantId(req),
      body,
    );
  }

  @Post('workflows/:threadId/workspace/coding-tasks/:taskId/cancel')
  @RequirePermission('admin:qa-ops:write')
  cancelWorkflowWorkspaceCodingTask(
    @Param('threadId') threadId: string,
    @Param('taskId') taskId: string,
    @Body() body: { reason?: string },
    @Req() req: Request,
  ) {
    return this.ragClient.cancelProductionWorkflowWorkspaceCodingTask(
      threadId,
      taskId,
      this.userId(req),
      this.tenantId(req),
      body,
    );
  }

  @Post('workflows/:threadId/workspace/coding-tasks/:taskId/resume')
  @RequirePermission('admin:qa-ops:write')
  resumeWorkflowWorkspaceCodingTask(
    @Param('threadId') threadId: string,
    @Param('taskId') taskId: string,
    @Req() req: Request,
  ) {
    return this.ragClient.resumeProductionWorkflowWorkspaceCodingTask(
      threadId,
      taskId,
      this.userId(req),
      this.tenantId(req),
    );
  }

  @Post('workflows/:threadId/workspace/command')
  @RequirePermission('admin:qa-ops:write')
  runWorkflowWorkspaceCommand(
    @Param('threadId') threadId: string,
    @Body() body: { command: string },
    @Req() req: Request,
  ) {
    return this.ragClient.runProductionWorkflowWorkspaceCommand(
      threadId,
      this.userId(req),
      this.tenantId(req),
      body,
    );
  }

  @Post('workflows/:threadId/workspace/dev-server/start')
  @RequirePermission('admin:qa-ops:write')
  startWorkflowWorkspaceDevServer(
    @Param('threadId') threadId: string,
    @Body() body: { port: number; command?: string },
    @Req() req: Request,
  ) {
    return this.ragClient.startProductionWorkflowWorkspaceDevServer(
      threadId,
      this.userId(req),
      this.tenantId(req),
      body,
    );
  }

  @Post('workflows/:threadId/workspace/dev-server/stop')
  @RequirePermission('admin:qa-ops:write')
  stopWorkflowWorkspaceDevServer(
    @Param('threadId') threadId: string,
    @Req() req: Request,
  ) {
    return this.ragClient.stopProductionWorkflowWorkspaceDevServer(
      threadId,
      this.userId(req),
      this.tenantId(req),
    );
  }

  @Post('workflows/:threadId/workspace/preview-ticket')
  @RequirePermission('admin:qa-ops:write')
  async createWorkflowWorkspacePreviewTicket(
    @Param('threadId') threadId: string,
    @Body() body: { port: number },
    @Req() req: Request,
  ) {
    const result = await this.ragClient.createProductionWorkflowWorkspacePreviewTicket(
      threadId,
      this.userId(req),
      this.tenantId(req),
      body,
    );
    const ticket =
      result.data && typeof result.data === 'object'
        ? (result.data as { ticket?: unknown }).ticket
        : undefined;
    if (!result.available || typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(ticket)) {
      throw new HttpException(
        result.error || 'RAG returned an invalid preview ticket',
        result.status && result.status >= 400 ? result.status : 502,
      );
    }
    return {
      url: `/api/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/workspace/preview/${encodeURIComponent(ticket)}/`,
    };
  }

  // Admin API uses Nest 10 / Express 4; keep separate root and unnamed wildcard routes.
  @Get('workflows/:threadId/workspace/preview/:ticket')
  @RequireLogin(false)
  async previewWorkflowWorkspaceRoot(
    @Param('threadId') threadId: string,
    @Param('ticket') ticket: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.pipeWorkflowWorkspacePreview(
      threadId,
      ticket,
      '',
      req,
      res,
    );
  }

  @Head('workflows/:threadId/workspace/preview/:ticket')
  @RequireLogin(false)
  async headWorkflowWorkspacePreviewRoot(
    @Param('threadId') threadId: string,
    @Param('ticket') ticket: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.pipeWorkflowWorkspacePreview(
      threadId,
      ticket,
      '',
      req,
      res,
    );
  }

  @Get('workflows/:threadId/workspace/preview/:ticket/*')
  @RequireLogin(false)
  async previewWorkflowWorkspacePath(
    @Param('threadId') threadId: string,
    @Param('ticket') ticket: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.pipeWorkflowWorkspacePreview(
      threadId,
      ticket,
      this.workflowWorkspacePreviewPath(req),
      req,
      res,
    );
  }

  @Head('workflows/:threadId/workspace/preview/:ticket/*')
  @RequireLogin(false)
  async headWorkflowWorkspacePreviewPath(
    @Param('threadId') threadId: string,
    @Param('ticket') ticket: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.pipeWorkflowWorkspacePreview(
      threadId,
      ticket,
      this.workflowWorkspacePreviewPath(req),
      req,
      res,
    );
  }

  @Post('workflows/:threadId/workspace/export')
  @RequirePermission('admin:qa-ops:write')
  exportWorkflowWorkspace(
    @Param('threadId') threadId: string,
    @Req() req: Request,
  ) {
    return this.ragClient.exportProductionWorkflowWorkspace(
      threadId,
      this.userId(req),
      this.tenantId(req),
    );
  }

  @Delete('workflows/:threadId/workspace')
  @RequirePermission('admin:qa-ops:write')
  deleteWorkflowWorkspace(
    @Param('threadId') threadId: string,
    @Body() body: { confirmDiscard?: boolean },
    @Req() req: Request,
  ) {
    if (body?.confirmDiscard !== true) {
      throw new BadRequestException('confirmDiscard must be true to discard workspace changes');
    }
    return this.ragClient.deleteProductionWorkflowWorkspace(
      threadId,
      this.userId(req),
      this.tenantId(req),
      { confirmDiscard: true },
    );
  }

  @Post('workflows/:threadId/generate-project-zip')
  @RequirePermission('admin:qa-ops:write')
  async generateWorkflowProjectZip(@Param('threadId') threadId: string, @Req() req: Request, @Res() res: Response) {
    const response = await this.ragClient.generateProductionWorkflowProjectZip(threadId, this.userId(req));
    res.status(response.status ?? 500);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    const buffer = Buffer.from(await response.arrayBuffer());
    return res.send(buffer);
  }

  @Get('workflows/:threadId')
  @RequirePermission('admin:qa-ops:read')
  workflow(@Param('threadId') threadId: string, @Req() req: Request) {
    return this.ragClient.getProductionWorkflow(threadId, this.userId(req));
  }

  @Post('evals')
  @RequirePermission('admin:qa-ops:write')
  evaluate(@Body() body: unknown) {
    return this.ragClient.evaluateAgent(body);
  }

  @Get('bad-cases')
  @RequirePermission('admin:qa-ops:read')
  badCases(@Query('status') status?: string) {
    return this.ragClient.getAgentBadCases(status);
  }

  @Patch('bad-cases/:id')
  @RequirePermission('admin:qa-ops:write')
  reviewBadCase(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request
  ) {
    return this.ragClient.reviewAgentBadCase(id, {
      ...body,
      reviewedBy: this.userId(req),
    });
  }

  @Get('traces')
  @RequirePermission('admin:qa-ops:read')
  traces(@Query('limit') limit?: string) {
    return this.ragClient.getAgentTraces(Number(limit ?? 50));
  }

  @Get('runs/:threadId/artifacts')
  @RequirePermission('admin:qa-ops:read')
  runArtifacts(@Param('threadId') threadId: string) {
    return this.ragClient.getAgentRunArtifacts(threadId);
  }

  @Get('runs')
  @RequirePermission('admin:qa-ops:read')
  runs(@Query('limit') limit?: string) {
    return this.ragClient.getAgentRuns(Number(limit ?? 30));
  }

  @Post('runs/:threadId/retry')
  @RequirePermission('admin:qa-ops:write')
  retryRun(@Param('threadId') threadId: string) {
    return this.ragClient.retryAgentRun(threadId);
  }

  @Get('run-center')
  @RequirePermission('admin:qa-ops:read')
  runCenter(@Query('limit') limit?: string) { return this.ragClient.getAgentRunCenter(Number(limit ?? 50)); }

  @Get('run-center/:id')
  @RequirePermission('admin:qa-ops:read')
  runCenterDetail(@Param('id') id: string) { return this.ragClient.getAgentRunDetail(id); }

  @Get('run-center/:id/artifacts')
  @RequirePermission('admin:qa-ops:read')
  runCenterDetailArtifacts(@Param('id') id: string) { return this.ragClient.getAgentRunDetailArtifacts(id); }

  @Get('runtime/capabilities')
  @RequirePermission('admin:qa-ops:read')
  runtimeCapabilities() { return this.ragClient.getAgentRuntimeCapabilities(); }

  @Post('runtime/plans')
  @RequirePermission('admin:qa-ops:write')
  createRuntimePlan(@Body() body: unknown) { return this.ragClient.createAgentRuntimePlan(body); }

  @Post('run-center/:id/retry')
  @RequirePermission('admin:qa-ops:write')
  retryRunRecord(@Param('id') id: string) { return this.ragClient.retryAgentRunRecord(id); }

  @Get('governance/workflows')
  @RequirePermission('admin:qa-ops:read')
  governanceWorkflows(@Query('workspaceId') workspaceId?: string) { return this.ragClient.listGovernanceWorkflows(workspaceId); }

  @Post('governance/workflows')
  @RequirePermission('admin:qa-ops:write')
  createGovernanceWorkflow(@Body() body: unknown) { return this.ragClient.createGovernanceWorkflow(body); }

  @Post('governance/workflows/:id/publish')
  @RequirePermission('admin:qa-ops:write')
  publishGovernanceWorkflow(@Param('id') id: string, @Body('version') version: number) { return this.ragClient.publishGovernanceWorkflow(id, Number(version)); }

  @Post('governance/workflows/:id/clone')
  @RequirePermission('admin:qa-ops:write')
  cloneGovernanceWorkflow(@Param('id') id: string, @Body() body: { key: string; name?: string }) { return this.ragClient.cloneGovernanceWorkflow(id, body); }

  @Get('collaboration/sops')
  @RequirePermission('admin:qa-ops:read')
  collaborationSops() { return this.ragClient.listCollaborationSops(); }

  @Get('collaboration/messages')
  @RequirePermission('admin:qa-ops:read')
  collaborationMessages(@Query('threadId') threadId?: string) { return this.ragClient.listCollaborationMessages(threadId); }

  @Get('collaboration/dependencies')
  @RequirePermission('admin:qa-ops:read')
  artifactDependencies(@Query('threadId') threadId?: string) { return this.ragClient.listArtifactDependencies(threadId); }

  @Get('collaboration/decisions')
  @RequirePermission('admin:qa-ops:read')
  decisionRecords(@Query('threadId') threadId?: string) { return this.ragClient.listDecisionRecords(threadId); }

  @Get('collaboration/conflicts/:threadId')
  @RequirePermission('admin:qa-ops:read')
  collaborationConflicts(@Param('threadId') threadId: string) { return this.ragClient.detectCollaborationConflicts(threadId); }

  @Post('collaboration/decisions')
  @RequirePermission('admin:qa-ops:write')
  createDecisionRecord(@Body() body: unknown) { return this.ragClient.createDecisionRecord(body); }

  @Get('collaboration/replay/:threadId')
  @RequirePermission('admin:qa-ops:read')
  collaborationReplay(@Param('threadId') threadId: string) { return this.ragClient.getCollaborationReplay(threadId); }

  @Get('tasks')
  @RequirePermission('admin:qa-ops:read')
  agentTasks(@Query('threadId') threadId: string | undefined, @Req() req: Request) {
    return this.ragClient.listAgentTasks(threadId, this.userId(req));
  }

  @Post('tasks/:id/retry')
  @RequirePermission('admin:qa-ops:write')
  retryAgentTask(@Param('id') id: string, @Req() req: Request) { return this.ragClient.retryAgentTask(id, this.userId(req)); }

  @Post('tasks/delegate')
  @RequirePermission('admin:qa-ops:write')
  delegateAgentTask(@Body() body: Record<string, unknown>, @Req() req: Request) {
    return this.ragClient.delegateAgentTask({ ...body, ownerUserId: this.userId(req) });
  }

  @Get('runtime-events')
  @RequirePermission('admin:qa-ops:read')
  runtimeEvents(@Query('threadId') threadId?: string, @Query('runId') runId?: string) { return this.ragClient.listRuntimeEvents(threadId, runId); }

  @Get('runtime-events/metrics')
  @RequirePermission('admin:qa-ops:read')
  runtimeEventMetrics(@Query('threadId') threadId?: string, @Query('runId') runId?: string) { return this.ragClient.getRuntimeEventMetrics(threadId, runId); }

  @Get('runs/summary')
  @RequirePermission('admin:qa-ops:read')
  agentRunSummary(@Query('limit') limit?: string) { return this.ragClient.getAgentRunSummary(Number(limit) || 500); }

  @Get('rag-quality')
  @ApiOperation({ summary: 'RAG 质量趋势与发布门禁' })
  @RequirePermission('admin:qa-ops:read')
  ragQuality(@Query('limit') limit?: string) { return this.ragClient.getRagQualitySummary(Number(limit) || 500); }

  @Get('intent-routing')
  @ApiOperation({ summary: 'RAG 意图路由质量与最近决策' })
  @RequirePermission('admin:qa-ops:read')
  intentRouting(@Query('limit') limit?: string) { return this.ragClient.getIntentRoutingSummary(Number(limit) || 200); }

  @Get('governance/plugins')
  @RequirePermission('admin:qa-ops:read')
  governancePlugins() { return this.ragClient.listPlatformPlugins(); }

  @Post('governance/plugins')
  @RequirePermission('admin:qa-ops:write')
  registerGovernancePlugin(@Body() body: unknown) { return this.ragClient.registerPlatformPlugin(body); }

  @Post('governance/plugins/:key/:version/status')
  @RequirePermission('admin:qa-ops:write')
  setGovernancePluginStatus(@Param('key') key: string, @Param('version') version: string, @Body('status') status: string) { return this.ragClient.setPlatformPluginStatus(key, version, status); }

  @Post('governance/plugin-compositions/resolve')
  @RequirePermission('admin:qa-ops:read')
  resolveGovernancePluginComposition(@Body() body: unknown) { return this.ragClient.resolvePluginComposition(body); }

  @Get('governance/models')
  @RequirePermission('admin:qa-ops:read')
  governanceModels() { return this.ragClient.listPlatformModels(); }

  @Get('governance/evaluation-cases')
  @RequirePermission('admin:qa-ops:read')
  governanceEvaluationCases(@Query('workspaceId') workspaceId?: string) { return this.ragClient.listEvaluationCases(workspaceId); }

  @Post('governance/evaluation-cases')
  @RequirePermission('admin:qa-ops:write')
  createGovernanceEvaluationCase(@Body() body: unknown) { return this.ragClient.createEvaluationCase(body); }

  @Get('governance/knowledge-base-profiles')
  @RequirePermission('admin:qa-ops:read')
  knowledgeBaseProfiles(@Query('workspaceId') workspaceId?: string) { return this.ragClient.listKnowledgeBaseProfiles(workspaceId); }

  @Post('governance/knowledge-base-profiles')
  @RequirePermission('admin:qa-ops:write')
  registerKnowledgeBaseProfile(@Body() body: unknown) { return this.ragClient.registerKnowledgeBaseProfile(body); }

  @Get('governance/retrieval-debug')
  @RequirePermission('admin:qa-ops:read')
  governanceRetrievalDebug(
    @Query('query') query: string,
    @Req() req: Request,
    @Query('scope') scope?: string,
    @Query('knowledgeBaseKey') knowledgeBaseKey?: string,
  ) {
    return this.ragClient.debugRetrieval(
      query,
      this.userId(req),
      scope,
      knowledgeBaseKey,
    );
  }

  @Get('governance/retrieval-debug/compare')
  @RequirePermission('admin:qa-ops:read')
  compareGovernanceRetrieval(
    @Query('query') query: string,
    @Query('scope') scope: string | undefined,
    @Query('knowledgeBaseKey') knowledgeBaseKey: string,
    @Query('compareKnowledgeBaseKey') compareKnowledgeBaseKey: string,
    @Req() req: Request,
  ) {
    if (!query?.trim()) throw new BadRequestException('query is required');
    if (!knowledgeBaseKey?.trim() || !compareKnowledgeBaseKey?.trim())
      throw new BadRequestException('two knowledge base profiles are required');
    if (knowledgeBaseKey.trim() === compareKnowledgeBaseKey.trim())
      throw new BadRequestException('profiles must be different');
    return this.ragClient.compareRetrievalProfiles(
      query.trim(),
      this.userId(req),
      scope,
      knowledgeBaseKey.trim(),
      compareKnowledgeBaseKey.trim(),
    );
  }

  private userId(req: Request): string {
    const user = (req as Request & { user?: { userId?: string; sub?: string } })
      .user;
    const userId = user?.userId ?? user?.sub;
    if (userId === undefined || userId === null || !String(userId).trim()) {
      throw new UnauthorizedException('authenticated admin is required');
    }
    return String(userId).trim();
  }

  private tenantId(req: Request): string | undefined {
    const tenantId = (
      req as Request & { user?: { tenantId?: string } }
    ).user?.tenantId;
    return typeof tenantId === 'string' && tenantId.length > 0
      ? tenantId
      : undefined;
  }

  private async pipeWorkflowWorkspacePreview(
    threadId: string,
    ticket: string,
    path: string,
    req: Request,
    res: Response,
  ) {
    const segments = path.split('/').filter(Boolean);
    if (
      path.length > 4096 ||
      segments.some(
        (segment) =>
          segment === '.' ||
          segment === '..' ||
          segment.length > 255 ||
          segment.includes('\0'),
      )
    ) {
      throw new BadRequestException('invalid preview path');
    }
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(ticket)) {
      throw new BadRequestException('invalid preview ticket');
    }

    const rawQuery = req.originalUrl.includes('?')
      ? req.originalUrl.slice(req.originalUrl.indexOf('?') + 1)
      : '';
    if (rawQuery.length > 8192) {
      throw new BadRequestException('preview query is too long');
    }
    const headers: Record<string, string> = {};
    for (const name of ['accept', 'if-none-match', 'if-modified-since', 'range']) {
      const value = req.headers[name];
      if (typeof value === 'string') headers[name] = value;
    }

    const abortController = new AbortController();
    const abortWhenDisconnected = () => {
      if (!res.writableEnded) abortController.abort();
    };
    const timeout = setTimeout(
      () => abortController.abort(new Error('Preview proxy timed out.')),
      WORKSPACE_PREVIEW_ABORT_TIMEOUT_MS,
    );
    req.once('aborted', abortWhenDisconnected);
    res.once('close', abortWhenDisconnected);
    try {
      const upstream = await this.ragClient.proxyProductionWorkflowWorkspacePreview(
        ticket,
        threadId,
        {
          method: req.method === 'HEAD' ? 'HEAD' : 'GET',
          path: segments.join('/'),
          query: rawQuery,
          headers,
          signal: abortController.signal,
        },
      );
      const contentLength = Number(upstream.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > 25 * 1024 * 1024) {
        return res.status(502).send('Preview response exceeds the size limit');
      }
      const body = Buffer.from(await upstream.arrayBuffer());
      if (body.byteLength > 25 * 1024 * 1024) {
        return res.status(502).send('Preview response exceeds the size limit');
      }
      res.status(upstream.status);
      this.copyWorkflowWorkspaceHeaders(upstream, res, [
        'accept-ranges',
        'content-range',
        'content-type',
        'etag',
        'last-modified',
        'vary',
      ]);
      const contentType = upstream.headers.get('content-type')?.toLowerCase() ?? '';
      if (isSandboxedPreviewDocument(contentType)) {
        res.setHeader('Content-Security-Policy', 'sandbox allow-scripts');
      }
      res.removeHeader('X-Frame-Options');
      res.removeHeader('Access-Control-Allow-Credentials');
      if (req.headers.origin === 'null') {
        res.setHeader('Access-Control-Allow-Origin', 'null');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD');
        res.removeHeader('Access-Control-Allow-Headers');
        const currentVary = res.getHeader('Vary');
        const varyValues = String(currentVary ?? '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        if (!varyValues.some((value) => value.toLowerCase() === 'origin')) {
          varyValues.push('Origin');
        }
        res.setHeader('Vary', varyValues.join(', '));
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(body);
    } catch {
      if (res.destroyed) return res;
      return res.status(502).send('Preview service is unavailable');
    } finally {
      clearTimeout(timeout);
      req.off('aborted', abortWhenDisconnected);
      res.off('close', abortWhenDisconnected);
    }
  }

  private workflowWorkspacePreviewPath(req: Request): string {
    const params = req.params as Record<string, unknown>;
    const path = params['0'] ?? params.path;
    return Array.isArray(path)
      ? path.map((segment) => String(segment)).join('/')
      : typeof path === 'string'
        ? path
        : '';
  }

  private copyWorkflowWorkspaceHeaders(
    upstream: globalThis.Response,
    res: Response,
    allowlist: string[],
  ) {
    for (const name of allowlist) {
      const value = upstream.headers.get(name);
      if (value && !/[\r\n]/.test(value)) res.setHeader(name, value);
    }
  }

}

function isSandboxedPreviewDocument(contentType: string): boolean {
  const mediaType = contentType.split(';', 1)[0].trim();
  return (
    mediaType === 'text/html' ||
    mediaType === 'application/xhtml+xml' ||
    mediaType === 'image/svg+xml' ||
    mediaType === 'application/xml' ||
    mediaType === 'text/xml' ||
    mediaType.endsWith('+xml')
  );
}
