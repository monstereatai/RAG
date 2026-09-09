import { BadRequestException, Body, Controller, Delete, Get, HttpException, Param, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { RagDocumentQueryDto } from '../rag-client/dto/rag-admin.dto';
import { RagClientService } from '../rag-client/rag-client.service';
import { unwrapRagResponse } from '../rag-client/rag-response.adapter';

const MAX_DOCUMENT_UPLOAD_BYTES = 1024 * 1024 * 1024;

@ApiTags('admin-documents')
@ApiBearerAuth()
@Controller('admin/documents')
export class AdminDocumentsController {
  constructor(private readonly ragClient: RagClientService) {}

  @Get()
  @ApiOperation({ summary: '后台文档治理列表' })
  @RequirePermission('admin:documents:read')
  async list(@Query() query: RagDocumentQueryDto) {
    // 前端 ProTable 传 current，转换为 rag-backend 的 page
    if (query.current && !query.page) {
      query.page = query.current;
    }
    const result = await this.ragClient.getDocuments(query);
    this.requireAvailable(result);
    return result.data;
  }

  @Get('index-audit')
  @ApiOperation({ summary: '文档索引一致性巡检' })
  @RequirePermission('admin:documents:read')
  auditIndexes(@Query('limit') limit?: string) {
    return this.ragClient.auditDocumentIndexes(Number(limit) || 200);
  }

  @Post('index-audit/repair')
  @RequirePermission('admin:documents:write')
  repairIndexes(@Body() body: { docIds?: string[]; limit?: number }) {
    return this.ragClient.repairDocumentIndexes(body ?? {});
  }

  @Get(':docId')
  @ApiOperation({ summary: '后台查看文档元数据' })
  @ApiParam({ name: 'docId', description: 'RAG 文档 ID' })
  @RequirePermission('admin:documents:read')
  async detail(@Param('docId') docId: string) {
    const result = await this.ragClient.getDocument(docId);
    this.requireAvailable(result);
    return unwrapRagResponse(result.data);
  }

  @Get(':docId/chunks')
  @ApiOperation({ summary: '后台查看文档 chunk 列表' })
  @ApiParam({ name: 'docId', description: 'RAG 文档 ID' })
  @RequirePermission('admin:documents:read')
  async chunks(@Param('docId') docId: string) {
    const result = await this.ragClient.getDocumentChunks(docId);
    this.requireAvailable(result);
    return unwrapRagResponse(result.data);
  }

  @Get(':docId/versions')
  @ApiOperation({ summary: '查看文档版本链' })
  @RequirePermission('admin:documents:read')
  versions(@Param('docId') docId: string) {
    return this.ragClient.getDocumentVersions(docId);
  }

  @Post(':docId/versions')
  @AuditLog('documents', 'create-version')
  @ApiOperation({ summary: '创建文档新版本并替代旧版本' })
  @RequirePermission('admin:documents:write')
  createVersion(@Param('docId') docId: string, @Body() body: unknown) {
    return this.ragClient.createDocumentVersion(docId, body);
  }

  @Post(':docId/lifecycle')
  @AuditLog('documents', 'lifecycle')
  @ApiOperation({ summary: '修改文档生命周期状态' })
  @RequirePermission('admin:documents:write')
  lifecycle(@Param('docId') docId: string, @Body() body: unknown) {
    const lifecycleStatus = (body as { lifecycleStatus?: string })?.lifecycleStatus;
    return this.ragClient.updateDocumentLifecycle(docId, lifecycleStatus ?? 'deprecated');
  }

  @Post(':docId/promote')
  @AuditLog('documents', 'promote-version')
  @ApiOperation({ summary: '将已索引的文档版本设为生效' })
  @RequirePermission('admin:documents:write')
  promote(@Param('docId') docId: string) {
    return this.ragClient.promoteDocumentVersion(docId);
  }

  @Post(':docId/review/submit')
  @AuditLog('documents', 'review-submit')
  @RequirePermission('admin:documents:write')
  submitReview(@Param('docId') docId: string, @Body() body: unknown, @Req() req: { user?: { userId?: string; sub?: string } }) {
    return this.ragClient.submitDocumentReview(docId, this.withOperator(body, req));
  }

  @Post(':docId/review/approve')
  @AuditLog('documents', 'review-approve')
  @RequirePermission('admin:documents:write')
  approveReview(@Param('docId') docId: string, @Body() body: unknown, @Req() req: { user?: { userId?: string; sub?: string } }) {
    return this.ragClient.approveDocumentReview(docId, this.withOperator(body, req));
  }

  @Post(':docId/review/reject')
  @AuditLog('documents', 'review-reject')
  @RequirePermission('admin:documents:write')
  rejectReview(@Param('docId') docId: string, @Body() body: unknown, @Req() req: { user?: { userId?: string; sub?: string } }) {
    return this.ragClient.rejectDocumentReview(docId, this.withOperator(body, req));
  }

  @Get(':docId/reviews')
  @RequirePermission('admin:documents:read')
  reviews(@Param('docId') docId: string) {
    return this.ragClient.getDocumentReviews(docId);
  }

  @Get('tasks/failed')
  @RequirePermission('admin:documents:read')
  failedTasks() {
    return this.ragClient.getFailedDocumentTasks();
  }

  @Post('tasks/:taskId/retry')
  @AuditLog('documents', 'retry-failed-task')
  @RequirePermission('admin:documents:write')
  retryFailedTask(@Param('taskId') taskId: string) {
    return this.ragClient.retryFailedDocumentTask(taskId);
  }

  @Post(':docId/rollback')
  @AuditLog('documents', 'rollback')
  @ApiOperation({ summary: '回滚到指定文档版本' })
  @RequirePermission('admin:documents:write')
  rollback(@Param('docId') docId: string) {
    return this.ragClient.rollbackDocumentVersion(docId);
  }

  @Get(':docId/status')
  @ApiOperation({ summary: '后台查看文档解析状态' })
  @ApiParam({ name: 'docId', description: 'RAG 文档 ID' })
  @RequirePermission('admin:documents:read')
  status(@Param('docId') docId: string) {
    return this.ragClient.getDocument(docId);
  }

  @Get(':docId/download')
  @ApiOperation({ summary: '后台文档下载' })
  @ApiParam({ name: 'docId', description: 'RAG 文档 ID' })
  @RequirePermission('admin:documents:read')
  download(@Param('docId') docId: string) {
    return this.ragClient.downloadDocument(docId);
  }

  @Post(':docId/reindex')
  @AuditLog('documents', 'reindex')
  @ApiOperation({ summary: '后台触发文档重建索引' })
  @ApiParam({ name: 'docId', description: 'RAG 文档 ID' })
  @RequirePermission('admin:documents:write')
  reindex(@Param('docId') docId: string) {
    return this.ragClient.reindexDocument(docId);
  }

  @Post(':docId/reprocess')
  @AuditLog('documents', 'reprocess')
  @ApiOperation({ summary: '后台触发文档重新处理' })
  @ApiParam({ name: 'docId', description: 'RAG 文档 ID' })
  @RequirePermission('admin:documents:write')
  reprocess(@Param('docId') docId: string) {
    return this.ragClient.reindexDocument(docId);
  }

  @Delete(':docId')
  @AuditLog('documents', 'delete')
  @ApiOperation({ summary: '后台删除文档' })
  @ApiParam({ name: 'docId', description: 'RAG 文档 ID' })
  @RequirePermission('admin:documents:write')
  delete(@Param('docId') docId: string) {
    return this.ragClient.deleteDocument(docId);
  }

  @Post('upload')
  @AuditLog('documents', 'upload')
  @ApiOperation({ summary: '后台文档上传（代理至 rag-backend）' })
  @RequirePermission('admin:documents:write')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_DOCUMENT_UPLOAD_BYTES },
    }),
  )
  upload(@UploadedFile() file: Express.Multer.File, @Body() body: Record<string, unknown>, @Req() req: { user?: { userId?: string; sub?: string } }) {
    if (!file) throw new BadRequestException('file is required');
    const ownerUserId = req.user?.userId ?? req.user?.sub ?? 'admin';
    return this.ragClient.uploadDocument(file, { ...body, ownerUserId });
  }

  @Post(':docId/archive')
  @AuditLog('documents', 'archive')
  @ApiOperation({ summary: '后台文档归档（代理至 rag-backend）' })
  @ApiParam({ name: 'docId', description: 'RAG 文档 ID' })
  @RequirePermission('admin:documents:write')
  archive(@Param('docId') docId: string) {
    return this.ragClient.archiveDocument(docId);
  }

  @Post(':docId/unarchive')
  @AuditLog('documents', 'unarchive')
  @ApiOperation({ summary: '后台文档归档恢复（代理至 rag-backend）' })
  @ApiParam({ name: 'docId', description: 'RAG 文档 ID' })
  @RequirePermission('admin:documents:write')
  unarchive(@Param('docId') docId: string) {
    return this.ragClient.unarchiveDocument(docId);
  }

  @Post(':docId/permissions')
  @AuditLog('documents', 'permissions')
  @ApiOperation({ summary: '后台文档权限范围（代理至 rag-backend）' })
  @ApiParam({ name: 'docId', description: 'RAG 文档 ID' })
  @RequirePermission('admin:documents:write')
  updatePermissions(@Param('docId') docId: string, @Body() body: unknown) {
    return this.ragClient.updateDocumentPermissions(docId, body);
  }

  @Post('batch')
  @AuditLog('documents', 'batch')
  @ApiOperation({ summary: '后台文档批量操作（代理至 rag-backend）' })
  @RequirePermission('admin:documents:write')
  batch(@Body() body: unknown) {
    return this.ragClient.batchDocumentOperation(body);
  }

  private requireAvailable(result: {
    available: boolean;
    status: number | null;
    error?: string;
  }) {
    if (!result.available) {
      throw new HttpException(
        result.error || 'RAG service request failed',
        result.status && result.status >= 400 ? result.status : 502,
      );
    }
  }

  private withOperator(body: unknown, req: { user?: { userId?: string; sub?: string } }) {
    const payload = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    return { ...payload, operatorId: req.user?.userId ?? req.user?.sub ?? 'admin-system' };
  }
}
