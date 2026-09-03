import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Body,
  Logger,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { RagAdminService } from './rag-admin.service';
import { RagDocumentQueryDto, RagEvaluationRunDto } from './dto/rag-admin.dto';
import { ServiceTokenGuard } from '../../common/guards/service-token.guard';
import { RagFeedbackService } from '../chat/rag-feedback.service';
import { DomainEventsService } from '../domain-events/domain-events.service';
import {
  DEFAULT_ROLE_PRESET_ID,
  listRolePresets,
} from '../chat/role-presets';

@Controller('rag/admin')
@UseGuards(ServiceTokenGuard)
export class RagAdminController {
  private readonly logger = new Logger(RagAdminController.name);

  constructor(
    private readonly ragAdminService: RagAdminService,
    private readonly ragFeedbackService: RagFeedbackService,
    private readonly domainEvents: DomainEventsService,
  ) {}

  // ─── Capabilities ───────────────────────────────────────────

  @Get('capabilities')
  getCapabilities() {
    return this.ragAdminService.getCapabilities();
  }

  @Get('role-presets')
  getRolePresets() {
    return {
      defaultRolePresetId: DEFAULT_ROLE_PRESET_ID,
      roles: listRolePresets(),
    };
  }

  @Get('domain-events/subscriptions')
  listDomainEventSubscriptions() { return this.domainEvents.listSubscriptions(); }

  @Post('domain-events/subscriptions')
  saveDomainEventSubscription(@Body() body: { id?: string; name: string; eventTypes: string[]; channel: 'enterprise_wechat' | 'webhook'; endpointKey: string; enabled?: boolean }) {
    return this.domainEvents.upsertSubscription(body);
  }

  @Get('domain-events/outbox')
  listDomainEventOutbox(@Query('limit') limit?: string) { return this.domainEvents.listOutbox(Number(limit) || 100); }

  @Post('domain-events/outbox/:id/retry')
  retryDomainEvent(@Param('id') id: string) { return this.domainEvents.retry(id); }

  // ─── Documents ──────────────────────────────────────────────

  @Get('documents')
  async listDocuments(@Query() query: RagDocumentQueryDto) {
    return this.ragAdminService.listDocuments(query);
  }

  @Get('documents/search')
  searchDocuments(@Query('q') query: string, @Query('limit') limit?: string) {
    return this.ragAdminService.searchDocuments(query ?? '', Number(limit) || 20);
  }

  @Post('documents/search/reindex')
  reindexDocumentSearch(@Query('limit') limit?: string) {
    return this.ragAdminService.reindexDocumentSearch(Number(limit) || 1000);
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
      lifecycleStatus?: 'draft' | 'confirmed' | 'effective' | 'deprecated';
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
    @Body('lifecycleStatus') lifecycleStatus:
      | 'draft'
      | 'confirmed'
      | 'effective'
      | 'deprecated',
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
    if (!result) throw new NotFoundException(`doc ${docId} not found or is not ready`);
    return result;
  }

  @Post('documents/:docId/review/submit')
  submitDocumentReview(@Param('docId') docId: string, @Body() body: { operatorId?: string; comment?: string }) {
    return this.ragAdminService.submitDocumentReview(docId, body.operatorId, body.comment);
  }

  @Post('documents/:docId/review/approve')
  approveDocumentReview(@Param('docId') docId: string, @Body() body: { operatorId?: string; comment?: string }) {
    return this.ragAdminService.approveDocumentReview(docId, body.operatorId, body.comment);
  }

  @Post('documents/:docId/review/reject')
  rejectDocumentReview(@Param('docId') docId: string, @Body() body: { operatorId?: string; comment?: string }) {
    return this.ragAdminService.rejectDocumentReview(docId, body.operatorId, body.comment);
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

  @Get('documents/tasks/failed')
  getFailedDocumentTasks(@Query('limit') limit?: string) {
    return this.ragAdminService.getFailedDocumentTasks(Number(limit) || 50);
  }

  @Post('documents/tasks/:taskId/retry')
  retryFailedDocumentTask(@Param('taskId') taskId: string) {
    return this.ragAdminService.retryFailedDocumentTask(taskId);
  }

  @Post('documents/:docId/archive')
  archiveDocument(@Param('docId') docId: string) {
    return {
      docId,
      archived: false,
      blocked: true,
      reason:
        'Archive requires cold storage backend. Currently not implemented.',
    };
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
    },
  ) {
    return this.ragAdminService.updateDocumentPermissions(
      docId,
      body.subjects ?? [],
    );
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
