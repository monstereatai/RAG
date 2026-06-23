import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
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
}
