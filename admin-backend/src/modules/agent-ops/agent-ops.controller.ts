import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RagClientService } from '../rag-client/rag-client.service';

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

  @Get('workflows/:threadId/coding-context')
  @RequirePermission('admin:qa-ops:read')
  getWorkflowCodingContext(@Param('threadId') threadId: string, @Req() req: Request) {
    return this.ragClient.getProductionWorkflowCodingContext(threadId, this.userId(req));
  }

  @Post('workflows/:threadId/generate-project')
  @RequirePermission('admin:qa-ops:write')
  generateWorkflowProject(@Param('threadId') threadId: string, @Req() req: Request) {
    return this.ragClient.generateProductionWorkflowProject(threadId, this.userId(req));
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
  agentTasks(@Query('threadId') threadId?: string) { return this.ragClient.listAgentTasks(threadId); }

  @Post('tasks/:id/retry')
  @RequirePermission('admin:qa-ops:write')
  retryAgentTask(@Param('id') id: string) { return this.ragClient.retryAgentTask(id); }

  @Post('tasks/delegate')
  @RequirePermission('admin:qa-ops:write')
  delegateAgentTask(@Body() body: unknown) { return this.ragClient.delegateAgentTask(body); }

  @Get('runtime-events')
  @RequirePermission('admin:qa-ops:read')
  runtimeEvents(@Query('threadId') threadId?: string, @Query('runId') runId?: string) { return this.ragClient.listRuntimeEvents(threadId, runId); }

  @Get('runtime-events/metrics')
  @RequirePermission('admin:qa-ops:read')
  runtimeEventMetrics(@Query('threadId') threadId?: string, @Query('runId') runId?: string) { return this.ragClient.getRuntimeEventMetrics(threadId, runId); }

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
  governanceRetrievalDebug(@Query('query') query: string, @Query('scope') scope?: string, @Query('knowledgeBaseKey') knowledgeBaseKey?: string) { return this.ragClient.debugRetrieval(query, scope, knowledgeBaseKey); }

  private userId(req: Request): string {
    const user = (req as Request & { user?: { userId?: string; sub?: string } })
      .user;
    return String(user?.userId ?? user?.sub ?? 'admin-backend');
  }
}
