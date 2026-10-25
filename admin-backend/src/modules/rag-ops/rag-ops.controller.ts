import { Body, Controller, Get, Param, Post, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { UserInfo } from '../../common/decorators/user-info.decorator';
import { RagEvaluationRunDto } from '../rag-client/dto/rag-admin.dto';
import { RagClientService } from '../rag-client/rag-client.service';

@ApiTags('admin-rag-ops')
@ApiBearerAuth()
@Controller('admin/rag')
export class RagOpsController {
  constructor(private readonly ragClient: RagClientService) {}

  @Get('capabilities')
  @ApiOperation({ summary: '查看 RAG 服务能力' })
  @RequirePermission('admin:rag:read')
  capabilities() {
    return this.ragClient.getCapabilities();
  }

  @Get('vector-index')
  @ApiOperation({ summary: '查看向量索引状态' })
  @RequirePermission('admin:rag:read')
  vectorIndex() {
    return this.ragClient.getVectorIndex();
  }

  @Get('evaluations')
  @ApiOperation({ summary: '查看 RAG 评测结果' })
  @RequirePermission('admin:rag:read')
  evaluations() {
    return this.ragClient.getEvaluations();
  }

  @Get('conversations')
  @ApiOperation({ summary: '查看 RAG 问答会话记录' })
  @RequirePermission('admin:rag:read')
  conversations(@UserInfo() user: unknown) {
    return this.ragClient.getConversations(resolveAdminUserId(user));
  }

  @Post('documents/:docId/reindex')
  @ApiOperation({ summary: '触发文档重建索引' })
  @ApiParam({ name: 'docId', description: 'RAG 文档 ID' })
  @RequirePermission('admin:rag:write')
  reindex(@Param('docId') docId: string) {
    return this.ragClient.reindexDocument(docId);
  }

  @Post('evaluations/run')
  @ApiOperation({ summary: '触发 RAG 评测' })
  @RequirePermission('admin:rag:write')
  runEvaluation(@Body() dto: RagEvaluationRunDto) {
    return this.ragClient.runEvaluation(dto);
  }
}

/** 前端 /admin/rag-ops 别名路由 */
@ApiTags('admin-rag-ops-alias')
@ApiBearerAuth()
@Controller('admin/rag-ops')
export class RagOpsAliasController {
  constructor(private readonly ragClient: RagClientService) {}

  @Get('capabilities')
  @ApiOperation({ summary: '查看 RAG 服务能力' })
  @RequirePermission('admin:rag:read')
  capabilities() {
    return this.ragClient.getCapabilities();
  }

  @Get('vector-index')
  @ApiOperation({ summary: '查看向量索引状态' })
  @RequirePermission('admin:rag:read')
  vectorIndex() {
    return this.ragClient.getVectorIndex();
  }

  @Get('evaluations')
  @ApiOperation({ summary: '查看 RAG 评测结果' })
  @RequirePermission('admin:rag:read')
  evaluations() {
    return this.ragClient.getEvaluations();
  }

  @Get('conversations')
  @ApiOperation({ summary: '查看 RAG 问答会话记录' })
  @RequirePermission('admin:rag:read')
  conversations(@UserInfo() user: unknown) {
    return this.ragClient.getConversations(resolveAdminUserId(user));
  }

  @Post('documents/:docId/reindex')
  @ApiOperation({ summary: '触发文档重建索引' })
  @ApiParam({ name: 'docId', description: 'RAG 文档 ID' })
  @RequirePermission('admin:rag:write')
  reindex(@Param('docId') docId: string) {
    return this.ragClient.reindexDocument(docId);
  }

  @Post('evaluations/run')
  @ApiOperation({ summary: '触发 RAG 评测' })
  @RequirePermission('admin:rag:write')
  runEvaluation(@Body() dto: RagEvaluationRunDto) {
    return this.ragClient.runEvaluation(dto);
  }
}

function resolveAdminUserId(user: unknown): string {
  const identity = (user && typeof user === 'object' ? user : {}) as Record<string, unknown>;
  const userId = identity.userId ?? identity.id ?? identity.sub;
  if (userId === undefined || userId === null || !String(userId).trim()) {
    throw new UnauthorizedException('authenticated user is required');
  }
  return String(userId).trim();
}
