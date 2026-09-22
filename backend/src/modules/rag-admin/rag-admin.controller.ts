import {
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Body,
  Logger,
  BadRequestException,
  NotFoundException,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Optional,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RagAdminService } from './rag-admin.service';
import { RagDocumentQueryDto, RagEvaluationRunDto } from './dto/rag-admin.dto';
import { ServiceTokenGuard } from '../../common/guards/service-token.guard';
import { RagFeedbackService } from '../chat/rag-feedback.service';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { MemoryService } from '../memory/memory.service';
import { DEFAULT_ROLE_PRESET_ID, listRolePresets } from '../chat/role-presets';
import { listSafetyPolicies } from '../../rag/prompts/prompt-injection.guard';
import { IndexReconcilerService } from './index-reconciler.service';

@Controller('rag/admin')
@UseGuards(ServiceTokenGuard)
export class RagAdminController {
  /**
   * RAG 的内部管理 API。它只接受 Admin Backend 持有的服务令牌，浏览器不得直接调用；
   * ownerUserId 必须由 Admin Backend 的已验证登录态派生，用于保持用户数据隔离。
   */
  private readonly logger = new Logger(RagAdminController.name);

  constructor(
    private readonly ragAdminService: RagAdminService,
    private readonly ragFeedbackService: RagFeedbackService,
    private readonly domainEvents: DomainEventsService,
    private readonly memoryService: MemoryService,
    @Optional() private readonly indexReconciler?: IndexReconcilerService,
  ) {}

  // ─── Capabilities ───────────────────────────────────────────

  @Get('capabilities')
  getCapabilities() {
    return this.ragAdminService.getCapabilities();
  }

  @Get('documents/index-compensation')
  getIndexCompensationStatus() {
    return this.ragAdminService.getIndexCompensationStatus();
  }

  @Get('documents/index-reconciler/status')
  getIndexReconcilerStatus() {
    return (
      this.indexReconciler?.getStatus() ?? {
        enabled: false,
        configured: false,
        queueEnabled: false,
        running: false,
        reason: 'reconciler is not registered',
      }
    );
  }

  @Post('documents/index-reconciler/run')
  runIndexReconciler() {
    return (
      this.indexReconciler?.runOnce('manual') ??
      Promise.resolve({ available: false, reason: 'reconciler is not registered' })
    );
  }

  @Get('role-presets')
  getRolePresets() {
    return {
      defaultRolePresetId: DEFAULT_ROLE_PRESET_ID,
      roles: listRolePresets(),
    };
  }

  @Get('security/policies')
  listSecurityPolicies() {
    return {
      available: true,
      version: '2026-09-09',
      policies: listSafetyPolicies(),
      note: '策略在问答、流式问答和 Agent 执行前统一生效；安全讨论类问题会保留。',
    };
  }

  @Get('security/audit')
  listSecurityAudit(@Query('limit') limit?: string) {
    return this.ragAdminService.listSecurityAudit(Number(limit) || 100);
  }

  @Get('domain-events/subscriptions')
  listDomainEventSubscriptions() {
    return this.domainEvents.listSubscriptions();
  }

  @Post('domain-events/subscriptions')
  saveDomainEventSubscription(
    @Body()
    body: {
      id?: string;
      name: string;
      eventTypes: string[];
      channel: 'enterprise_wechat' | 'webhook';
      endpointKey: string;
      enabled?: boolean;
    },
  ) {
    return this.domainEvents.upsertSubscription(body);
  }

  @Get('domain-events/outbox')
  listDomainEventOutbox(@Query('limit') limit?: string) {
    return this.domainEvents.listOutbox(Number(limit) || 100);
  }

  @Post('domain-events/outbox/:id/retry')
  retryDomainEvent(@Param('id') id: string) {
    return this.domainEvents.retry(id);
  }

  /** 长期记忆的内部读取入口，供 Admin Backend 代用户访问，避免两套 JWT 直接互认。 */
  @Get('memories')
  async listMemories(@Query('ownerUserId') ownerUserId?: string) {
    const userId = this.requireOwnerUserId(ownerUserId);
    if (!this.memoryService.isEnabled())
      return { enabled: false, memories: [] };
    return {
      enabled: true,
      memories: await this.memoryService.listMemories(userId),
    };
  }

  /** 清空是跨服务的不可逆操作；先校验 ownerUserId，再交给 MemoryService 执行。 */
  @Delete('memories')
  async clearMemories(@Query('ownerUserId') ownerUserId?: string) {
    const userId = this.requireOwnerUserId(ownerUserId);
    if (!this.memoryService.isEnabled())
      return { enabled: false, memories: [] };
    await this.memoryService.clearMemories(userId);
    return { enabled: true, memories: [] };
  }

  // ─── Documents ──────────────────────────────────────────────

  @Get('documents')
  async listDocuments(@Query() query: RagDocumentQueryDto) {
    return this.ragAdminService.listDocuments(query);
  }

  @Post('documents/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: Number(
          process.env.DOCUMENT_UPLOAD_MAX_BYTES ?? 200 * 1024 * 1024,
        ),
      },
    }),
  )
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Record<string, unknown>,
  ) {
    if (!file) throw new BadRequestException('file is required');
    const ownerUserId = String(body?.ownerUserId ?? 'admin');
    return this.ragAdminService.uploadDocumentAsync(file, ownerUserId, body);
  }

  @Get('documents/search')
  searchDocuments(
    @Query('q') query: string,
    @Query('limit') limit?: string,
    @Query('fileType') fileType?: string,
    @Query('updatedRange') updatedRange?: string,
    @Query('documentType') documentType?: string,
    @Query('role') role?: string,
  ) {
    return this.ragAdminService.searchDocuments(
      query ?? '',
      Number(limit) || 20,
      {
        fileType: fileType || undefined,
        updatedRange:
          updatedRange === 'day' ||
          updatedRange === 'week' ||
          updatedRange === 'month'
            ? updatedRange
            : undefined,
        documentType: documentType || undefined,
        role: role || undefined,
      },
    );
  }

  @Get('documents/search/facets')
  getDocumentSearchFacets() {
    return this.ragAdminService.getDocumentSearchFacets();
  }

  @Get('search/evidence')
  inspectRetrieval(
    @Query('q') query: string,
    @Query('userId') userId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ragAdminService.inspectRetrieval(
      query,
      userId,
      Number(limit) || 50,
    );
  }

  @Post('documents/search/reindex')
  reindexDocumentSearch(@Query('limit') limit?: string) {
    return this.ragAdminService.reindexDocumentSearch(Number(limit) || 1000);
  }

  // ─── Image Search（文搜图）──────────────────────────────────

  @Get('images/search')
  searchImages(
    @Query('q') query: string,
    @Query('limit') limit?: string,
    @Query('userId') userId?: string,
  ) {
    return this.ragAdminService.searchImages(
      query ?? '',
      Number(limit) || 20,
      userId || undefined,
    );
  }

  @Get('documents/stats')
  getDocumentStats() {
    return this.ragAdminService.getDocumentStats();
  }

  // 具体文档参数路由之前必须先注册这些固定路径，避免被 :docId 吞掉。
  @Get('documents/tasks/failed')
  getFailedDocumentTasks(@Query('limit') limit?: string) {
    return this.ragAdminService.getFailedDocumentTasks(Number(limit) || 50);
  }

  @Get('documents/tasks/:taskId')
  async getDocumentTask(
    @Param('taskId') taskId: string,
    @Query('ownerUserId') ownerUserId?: string,
  ) {
    const task = await this.ragAdminService.getDocumentTask(
      taskId,
      ownerUserId ?? 'admin',
    );
    if (!task) throw new NotFoundException(`task ${taskId} not found`);
    return task;
  }

  @Get('documents/index-audit')
  auditDocumentIndexes(@Query('limit') limit?: string) {
    return this.ragAdminService.auditDocumentIndexes(Number(limit) || 200);
  }

  @Post('documents/index-audit/repair')
  repairDocumentIndexes(@Body() body: { docIds?: string[]; limit?: number }) {
    return this.ragAdminService.repairDocumentIndexes(body ?? {});
  }

  @Get('documents/index-repair/status')
  getIndexRepairQueueStatus() {
    return this.ragAdminService.getIndexRepairQueueStatus();
  }

  @Get('documents/index-repair/failed')
  getFailedIndexRepairs(@Query('limit') limit?: string) {
    return this.ragAdminService.getFailedIndexRepairs(Number(limit) || 50);
  }

  @Post('documents/index-repair/:jobId/retry')
  retryIndexRepair(@Param('jobId') jobId: string) {
    return this.ragAdminService.retryIndexRepair(jobId);
  }

  @Get('documents/:docId')
  async getDocument(@Param('docId') docId: string) {
    const doc = await this.ragAdminService.getDocument(docId);
    if (!doc) {
      throw new NotFoundException(`doc ${docId} not found`);
    }
    return doc;
  }

  @Get('documents/:docId/chunks')
  async getDocumentChunks(@Param('docId') docId: string) {
    const doc = await this.ragAdminService.getDocument(docId);
    if (!doc) {
      throw new NotFoundException(`doc ${docId} not found`);
    }
    return this.ragAdminService.getDocumentChunks(docId);
  }

  @Get('documents/:docId/versions')
  async listDocumentVersions(@Param('docId') docId: string) {
    const versions = await this.ragAdminService.listDocumentVersions(docId);
    if (!versions) throw new NotFoundException(`doc ${docId} not found`);
    return versions;
  }

  @Post('documents/:docId/versions')
  async createDocumentVersion(
    @Param('docId') docId: string,
    @Body()
    body: {
      content?: string;
      filename?: string;
      docVersion?: string;
      effectiveAt?: string;
      expiredAt?: string;
      lifecycleStatus?:
        | 'draft'
        | 'confirmed'
        | 'effective'
        | 'deprecated'
        | 'archived';
      documentType?: string;
    },
  ) {
    const result = await this.ragAdminService.createDocumentVersion(docId, {
      ...body,
      documentType: body.documentType as never,
    });
    if (!result) throw new NotFoundException(`doc ${docId} not found`);
    return result;
  }

  @Post('documents/:docId/lifecycle')
  async updateDocumentLifecycle(
    @Param('docId') docId: string,
    @Body('lifecycleStatus')
    lifecycleStatus:
      | 'draft'
      | 'confirmed'
      | 'effective'
      | 'deprecated'
      | 'archived',
  ) {
    const result = await this.ragAdminService.updateDocumentLifecycle(
      docId,
      lifecycleStatus,
    );
    if (!result) throw new NotFoundException(`doc ${docId} not found`);
    return result;
  }

  @Post('documents/:docId/promote')
  async promoteDocumentVersion(@Param('docId') docId: string) {
    const result = await this.ragAdminService.promoteDocumentVersion(docId);
    if (!result)
      throw new NotFoundException(`doc ${docId} not found or is not ready`);
    return result;
  }

  @Post('documents/:docId/review/submit')
  submitDocumentReview(
    @Param('docId') docId: string,
    @Body() body: { operatorId?: string; comment?: string },
  ) {
    return this.ragAdminService.submitDocumentReview(
      docId,
      body.operatorId,
      body.comment,
    );
  }

  @Post('documents/:docId/review/approve')
  approveDocumentReview(
    @Param('docId') docId: string,
    @Body() body: { operatorId?: string; comment?: string },
  ) {
    return this.ragAdminService.approveDocumentReview(
      docId,
      body.operatorId,
      body.comment,
    );
  }

  @Post('documents/:docId/review/reject')
  rejectDocumentReview(
    @Param('docId') docId: string,
    @Body() body: { operatorId?: string; comment?: string },
  ) {
    return this.ragAdminService.rejectDocumentReview(
      docId,
      body.operatorId,
      body.comment,
    );
  }

  @Get('documents/:docId/reviews')
  listDocumentReviews(@Param('docId') docId: string) {
    return this.ragAdminService.listDocumentReviews(docId);
  }

  @Post('documents/:docId/rollback')
  async rollbackDocumentVersion(@Param('docId') docId: string) {
    const result = await this.ragAdminService.rollbackDocumentVersion(docId);
    if (!result) throw new NotFoundException(`doc ${docId} not found`);
    return result;
  }

  @Get('documents/:docId/status')
  async getDocumentStatus(@Param('docId') docId: string) {
    const doc = await this.ragAdminService.getDocument(docId);
    if (!doc) {
      throw new NotFoundException(`doc ${docId} not found`);
    }
    return { docId, status: 'indexed', chunkCount: doc.chunkCount };
  }

  @Get('documents/:docId/download')
  async downloadDocument(@Param('docId') docId: string) {
    const chunks = await this.ragAdminService.getDocumentChunks(docId);
    if (!chunks || chunks.length === 0) {
      throw new NotFoundException(`no chunks found for doc ${docId}`);
    }
    const content = chunks.map((c) => c.content).join('\n\n');
    return { docId, content, format: 'text/plain' };
  }

  @Post('documents/:docId/reindex')
  async reindexDocument(@Param('docId') docId: string) {
    const result = await this.ragAdminService.reindexDocument(docId);
    if (!result) {
      throw new NotFoundException(`doc ${docId} not found`);
    }
    return result;
  }

  @Get('quality/summary')
  getQualitySummary(@Query('limit') limit?: string) {
    return this.ragAdminService.getQualitySummary(Number(limit) || 500);
  }

  @Get('quality/intent-routing')
  getIntentRoutingSummary(@Query('limit') limit?: string) {
    return this.ragAdminService.getIntentRoutingSummary(Number(limit) || 200);
  }

  @Post('documents/tasks/:taskId/retry')
  retryFailedDocumentTask(@Param('taskId') taskId: string) {
    return this.ragAdminService.retryFailedDocumentTask(taskId);
  }

  @Post('documents/:docId/archive')
  async archiveDocument(@Param('docId') docId: string) {
    const result = await this.ragAdminService.archiveDocument(docId);
    if (!result) {
      throw new NotFoundException(`doc ${docId} not found`);
    }
    return result;
  }

  @Post('documents/:docId/unarchive')
  async unarchiveDocument(@Param('docId') docId: string) {
    const result = await this.ragAdminService.unarchiveDocument(docId);
    if (!result) {
      throw new NotFoundException(`doc ${docId} not found`);
    }
    return result;
  }

  @Post('documents/:docId/permissions')
  updateDocumentPermissions(
    @Param('docId') docId: string,
    @Body()
    body: {
      subjects?: Array<{
        type: 'user' | 'role' | 'department' | 'public';
        id: string;
      }>;
      permissions?: Array<{
        subjectType: 'user' | 'role' | 'department' | 'public';
        subjectId: string;
        scope?: string;
      }>;
    },
  ) {
    return this.ragAdminService.updateDocumentPermissions(
      docId,
      this.normalizePermissionSubjects(body),
    );
  }

  /**
   * 归一化两种权限保存契约（历史 bug：admin 前端发 permissions 字段被当成空权限清空）：
   * - { subjects: [{ type, id }] }（旧格式）
   * - { permissions: [{ subjectType, subjectId, scope? }] }（admin 前端格式，scope 忽略）
   * 两个 key 都缺失抛 400；存在但是空数组维持清空语义。
   * 非法主体类型、user/role/department 缺 subjectId 的项直接过滤；
   * public 的 subjectId 统一为 'public'（与前端发送的数据一致）。
   */
  private normalizePermissionSubjects(body: {
    subjects?: Array<{ type?: string; id?: string }>;
    permissions?: Array<{ subjectType?: string; subjectId?: string }>;
  }): Array<{ type: 'user' | 'role' | 'department' | 'public'; id: string }> {
    if (body.subjects === undefined && body.permissions === undefined) {
      throw new BadRequestException('permissions or subjects required');
    }
    const rawItems =
      body.subjects !== undefined
        ? body.subjects.map((item) => ({ type: item.type, id: item.id }))
        : body.permissions!.map((item) => ({
            type: item.subjectType,
            id: item.subjectId,
          }));
    const validTypes = new Set(['user', 'role', 'department', 'public']);
    const normalized: Array<{
      type: 'user' | 'role' | 'department' | 'public';
      id: string;
    }> = [];
    for (const item of rawItems) {
      if (!item.type || !validTypes.has(item.type)) continue;
      const type = item.type as 'user' | 'role' | 'department' | 'public';
      if (type === 'public') {
        normalized.push({ type: 'public', id: 'public' });
        continue;
      }
      if (!item.id) continue;
      normalized.push({ type, id: item.id });
    }
    return normalized;
  }

  private requireOwnerUserId(ownerUserId?: string): string {
    if (!ownerUserId?.trim())
      throw new BadRequestException('ownerUserId required');
    return ownerUserId;
  }

  @Post('documents/batch')
  batchDocumentOperation(
    @Body()
    body: {
      action?: 'reindex' | 'delete' | 'status';
      docIds?: string[];
      userId?: string;
    },
  ) {
    return this.ragAdminService.batchDocumentOperation(body);
  }

  // ─── Vector Index ───────────────────────────────────────────

  @Get('vector-index')
  async getVectorIndex() {
    return this.ragAdminService.getVectorIndex();
  }

  // ─── Evaluations ────────────────────────────────────────────

  @Get('evaluations')
  getEvaluations() {
    return this.ragAdminService.getEvaluations();
  }

  @Post('evaluations/run')
  runEvaluation(@Body() dto: RagEvaluationRunDto) {
    return this.ragAdminService.runEvaluation(dto);
  }

  // ─── Conversations ──────────────────────────────────────────

  @Get('conversations')
  async listConversations(@Query('userId') userId?: string) {
    return this.ragAdminService.listConversations(userId || undefined);
  }

  @Get('conversations/:threadId')
  async getConversation(
    @Param('threadId') threadId: string,
    @Query('userId') userId?: string,
  ) {
    const conv = await this.ragAdminService.getConversation(
      threadId,
      userId || undefined,
    );
    if (!conv) {
      throw new NotFoundException(`conversation ${threadId} not found`);
    }
    return conv;
  }

  @Post('conversations/:threadId/delete')
  async deleteConversation(
    @Param('threadId') threadId: string,
    @Query('userId') userId?: string,
  ) {
    const deleted = await this.ragAdminService.deleteConversation(
      threadId,
      userId || undefined,
    );
    if (!deleted) {
      throw new NotFoundException(`conversation ${threadId} not found`);
    }
    return { success: true };
  }

  // ─── Search Operations ──────────────────────────────────────

  @Get('queries/trend')
  async getQueryDailyTrend(@Query('days') days?: string) {
    return this.ragAdminService.getQueryDailyTrend(Number(days) || 14);
  }

  @Get('search/queries/popular')
  async getSearchPopularQueries() {
    return this.ragAdminService.getSearchPopularQueries();
  }

  @Get('search/queries/no-result')
  async getSearchNoResultQueries() {
    return this.ragAdminService.getSearchNoResultQueries();
  }

  @Get('search/recall-issues')
  async getSearchRecallIssues() {
    return this.ragAdminService.getSearchRecallIssues();
  }

  // ─── QA Operations ──────────────────────────────────────────

  @Get('qa/negative-feedback')
  async getQaNegativeFeedback() {
    return this.ragAdminService.getQaNegativeFeedback();
  }

  @Get('qa/feedback')
  getQaFeedback(
    @Query('status') status?: 'pending' | 'reviewed' | 'resolved' | 'ignored',
    @Query('feedback') feedback?: 'positive' | 'negative',
    @Query('limit') limit?: string,
  ) {
    return this.ragFeedbackService.list({
      status,
      feedback,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('qa/feedback')
  submitQaFeedback(
    @Body() body: import('../chat/chat-feedback.dto').ChatFeedbackDto,
    @Query('ownerUserId') ownerUserId: string,
  ) {
    return this.ragFeedbackService.create(body, ownerUserId, {
      allowCrossUserThread: true,
    });
  }

  @Patch('qa/feedback/:id')
  reviewQaFeedback(
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
    return this.ragFeedbackService.review(id, body);
  }

  @Get('qa/citation-failures')
  async getQaCitationFailures() {
    return this.ragAdminService.getQaCitationFailures();
  }

  @Get('qa/cost-summary')
  async getQaCostSummary() {
    return this.ragAdminService.getQaCostSummary();
  }

  // ─── Graph Operations ───────────────────────────────────────

  @Get('graph/schema')
  getGraphSchema() {
    return this.ragAdminService.getGraphSchema();
  }

  @Get('graph/entities')
  getGraphEntities(
    @Query() query: { keyword?: string; type?: string; limit?: number },
  ) {
    return this.ragAdminService.getGraphEntities(query);
  }

  @Get('graph/entities/:id')
  getGraphEntityDetail(@Param('id') id: string) {
    return this.ragAdminService.getGraphEntityDetail(id);
  }

  @Patch('graph/entities/:id')
  updateGraphEntity(
    @Param('id') id: string,
    @Body()
    body: {
      type?: string;
      aliases?: string[];
      sourceId?: string;
      properties?: Record<string, unknown>;
    },
  ) {
    return this.ragAdminService.updateGraphEntity(id, body);
  }

  @Get('graph/relationships')
  getGraphRelationships(
    @Query()
    query: {
      query?: string;
      relationType?: string;
      conflictOnly?: boolean;
      limit?: number;
    },
  ) {
    return this.ragAdminService.getGraphRelationships(query);
  }

  @Get('graph/search')
  searchGraph(
    @Query()
    query: {
      query?: string;
      relationType?: string;
      conflictOnly?: boolean;
      limit?: number;
    },
  ) {
    return this.ragAdminService.searchGraph(query);
  }

  @Get('graph/orphans')
  getGraphOrphans() {
    return this.ragAdminService.getGraphOrphans();
  }

  @Get('graph/conflicts')
  getGraphConflicts() {
    return this.ragAdminService.getGraphConflicts();
  }
}
