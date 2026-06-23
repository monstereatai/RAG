import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { RagDocumentQueryDto } from '../rag-client/dto/rag-admin.dto';
import { RagClientService } from '../rag-client/rag-client.service';

@ApiTags('admin-documents')
@ApiBearerAuth()
@Controller('admin/documents')
export class AdminDocumentsController {
  constructor(private readonly ragClient: RagClientService) {}

  @Get()
  @ApiOperation({ summary: '后台文档治理列表' })
  @RequirePermission('admin:documents:read')
  list(@Query() query: RagDocumentQueryDto) {
    return this.ragClient.getDocuments(query);
  }

  @Get(':docId')
  @ApiOperation({ summary: '后台查看文档元数据' })
  @ApiParam({ name: 'docId', description: 'RAG 文档 ID' })
  @RequirePermission('admin:documents:read')
  detail(@Param('docId') docId: string) {
    return this.ragClient.getDocument(docId);
  }

  @Get(':docId/chunks')
  @ApiOperation({ summary: '后台查看文档 chunk 列表' })
  @ApiParam({ name: 'docId', description: 'RAG 文档 ID' })
  @RequirePermission('admin:documents:read')
  chunks(@Param('docId') docId: string) {
    return this.ragClient.getDocumentChunks(docId);
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

  @Post('upload')
  @AuditLog('documents', 'upload')
  @ApiOperation({ summary: '后台文档上传（代理至 rag-backend）' })
  @RequirePermission('admin:documents:write')
  upload() {
    return this.ragClient.uploadDocument();
  }

  @Post(':docId/archive')
  @AuditLog('documents', 'archive')
  @ApiOperation({ summary: '后台文档归档（代理至 rag-backend）' })
  @ApiParam({ name: 'docId', description: 'RAG 文档 ID' })
  @RequirePermission('admin:documents:write')
  archive(@Param('docId') docId: string) {
    return this.ragClient.archiveDocument(docId);
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
}
