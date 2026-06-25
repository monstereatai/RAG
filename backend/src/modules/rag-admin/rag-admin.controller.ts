import {
  Controller,
  Get,
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

@Controller('rag/admin')
@UseGuards(ServiceTokenGuard)
export class RagAdminController {
  private readonly logger = new Logger(RagAdminController.name);

  constructor(private readonly ragAdminService: RagAdminService) {}

  // ─── Capabilities ───────────────────────────────────────────

  @Get('capabilities')
  getCapabilities() {
    return this.ragAdminService.getCapabilities();
  }

  // ─── Documents ──────────────────────────────────────────────

  @Get('documents')
  async listDocuments(@Query() query: RagDocumentQueryDto) {
    return this.ragAdminService.listDocuments(query);
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
  updateDocumentPermissions(@Param('docId') docId: string) {
    return {
      docId,
      updated: false,
      blocked: true,
      reason:
        'Document-level permission requires ACL schema. Currently not implemented.',
    };
  }

  @Post('documents/batch')
  batchDocumentOperation() {
    return {
      processed: 0,
      blocked: true,
      reason:
        'Batch operations require async job queue. Currently not implemented.',
    };
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
