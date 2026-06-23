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
import { RagOpsApiService } from './rag-ops-api.service';
import { RagDocumentQueryDto, RagEvaluationRunDto } from './dto/rag-ops-api.dto';
import { ServiceTokenGuard } from '../../common/guards/service-token.guard';

@Controller('rag/ops-api')
@UseGuards(ServiceTokenGuard)
export class RagOpsApiController {
  private readonly logger = new Logger(RagOpsApiController.name);

  constructor(private readonly ragOpsApiService: RagOpsApiService) {}

  // ─── Capabilities ───────────────────────────────────────────

  @Get('capabilities')
  getCapabilities() {
    return this.ragOpsApiService.getCapabilities();
  }

  // ─── Documents ──────────────────────────────────────────────

  @Get('documents')
  async listDocuments(@Query() query: RagDocumentQueryDto) {
    return this.ragOpsApiService.listDocuments(query);
  }

  @Get('documents/:docId')
  async getDocument(@Param('docId') docId: string) {
    const doc = await this.ragOpsApiService.getDocument(docId);
    if (!doc) {
      throw new NotFoundException(`doc ${docId} not found`);
    }
    return doc;
  }

  @Get('documents/:docId/chunks')
  async getDocumentChunks(@Param('docId') docId: string) {
    const doc = await this.ragOpsApiService.getDocument(docId);
    if (!doc) {
      throw new NotFoundException(`doc ${docId} not found`);
    }
    return this.ragOpsApiService.getDocumentChunks(docId);
  }

  @Get('documents/:docId/status')
  async getDocumentStatus(@Param('docId') docId: string) {
    const doc = await this.ragOpsApiService.getDocument(docId);
    if (!doc) {
      throw new NotFoundException(`doc ${docId} not found`);
    }
    return { docId, status: 'indexed', chunkCount: doc.chunkCount };
  }

  @Get('documents/:docId/download')
  async downloadDocument(@Param('docId') docId: string) {
    const chunks = await this.ragOpsApiService.getDocumentChunks(docId);
    if (!chunks || chunks.length === 0) {
      throw new NotFoundException(`no chunks found for doc ${docId}`);
    }
    const content = chunks.map((c) => c.content).join('\n\n');
    return { docId, content, format: 'text/plain' };
  }

  @Post('documents/:docId/reindex')
  async reindexDocument(@Param('docId') docId: string) {
    const result = await this.ragOpsApiService.reindexDocument(docId);
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
    return this.ragOpsApiService.getVectorIndex();
  }

  // ─── Evaluations ────────────────────────────────────────────

  @Get('evaluations')
  getEvaluations() {
    return this.ragOpsApiService.getEvaluations();
  }

  @Post('evaluations/run')
  runEvaluation(@Body() dto: RagEvaluationRunDto) {
    return this.ragOpsApiService.runEvaluation(dto);
  }

  // ─── Conversations ──────────────────────────────────────────

  @Get('conversations')
  async listConversations() {
    return this.ragOpsApiService.listConversations();
  }

  // ─── Search Operations ──────────────────────────────────────

  @Get('search/queries/popular')
  async getSearchPopularQueries() {
    return this.ragOpsApiService.getSearchPopularQueries();
  }

  @Get('search/queries/no-result')
  async getSearchNoResultQueries() {
    return this.ragOpsApiService.getSearchNoResultQueries();
  }

  @Get('search/recall-issues')
  async getSearchRecallIssues() {
    return this.ragOpsApiService.getSearchRecallIssues();
  }

  // ─── QA Operations ──────────────────────────────────────────

  @Get('qa/negative-feedback')
  async getQaNegativeFeedback() {
    return this.ragOpsApiService.getQaNegativeFeedback();
  }

  @Get('qa/citation-failures')
  async getQaCitationFailures() {
    return this.ragOpsApiService.getQaCitationFailures();
  }

  @Get('qa/cost-summary')
  async getQaCostSummary() {
    return this.ragOpsApiService.getQaCostSummary();
  }

  // ─── Graph Operations ───────────────────────────────────────

  @Get('graph/schema')
  getGraphSchema() {
    return this.ragOpsApiService.getGraphEntities();
  }

  @Get('graph/entities')
  getGraphEntities() {
    return this.ragOpsApiService.getGraphEntities();
  }

  @Get('graph/relationships')
  getGraphRelationships() {
    return this.ragOpsApiService.getGraphRelationships();
  }

  @Get('graph/orphans')
  getGraphOrphans() {
    return this.ragOpsApiService.getGraphOrphans();
  }

  @Get('graph/conflicts')
  getGraphConflicts() {
    return this.ragOpsApiService.getGraphConflicts();
  }
}
