import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RagClientService } from '../rag-client/rag-client.service';

@ApiTags('admin-team-wiki')
@ApiBearerAuth()
@Controller('admin/team-wiki')
export class TeamWikiController {
  constructor(private readonly ragClient: RagClientService) {}

  @Get()
  @ApiOperation({ summary: 'List team wiki pages' })
  @RequirePermission('admin:documents:read')
  async list(@Query('q') query: string | undefined, @Query('limit') limit: string | undefined, @Req() req: Request) {
    return this.unwrap(await this.ragClient.listTeamWikiPages(this.getUserId(req), query, Number(limit) || 100));
  }

  @Post()
  @AuditLog('team-wiki', 'create-page')
  @ApiOperation({ summary: 'Create a team wiki page' })
  @RequirePermission('admin:documents:write')
  async create(@Body() body: unknown, @Req() req: Request) {
    return this.unwrap(await this.ragClient.createTeamWikiPage(this.getUserId(req), this.pageInput(body)));
  }

  @Get(':pageId/revisions')
  @RequirePermission('admin:documents:read')
  async revisions(@Param('pageId') pageId: string, @Req() req: Request) {
    return this.unwrap(await this.ragClient.getTeamWikiRevisions(this.getUserId(req), pageId));
  }

  @Get(':pageId/compare')
  @RequirePermission('admin:documents:read')
  async compare(
    @Param('pageId') pageId: string,
    @Query('from') fromRevisionId: string,
    @Query('to') toRevisionId: string,
    @Req() req: Request,
  ) {
    return this.unwrap(await this.ragClient.compareTeamWikiRevisions(this.getUserId(req), pageId, fromRevisionId, toRevisionId));
  }

  @Post(':pageId/rollback')
  @AuditLog('team-wiki', 'rollback-page')
  @RequirePermission('admin:documents:write')
  async rollback(
    @Param('pageId') pageId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.unwrap(await this.ragClient.rollbackTeamWikiPage(this.getUserId(req), pageId, this.rollbackInput(body)));
  }

  @Post(':pageId/publish')
  @AuditLog('team-wiki', 'publish-page')
  @RequirePermission('admin:documents:write')
  async publish(@Param('pageId') pageId: string, @Req() req: Request) {
    return this.unwrap(await this.ragClient.publishTeamWikiPage(this.getUserId(req), pageId));
  }

  @Get(':pageId')
  @RequirePermission('admin:documents:read')
  async get(@Param('pageId') pageId: string, @Req() req: Request) {
    return this.unwrap(await this.ragClient.getTeamWikiPage(this.getUserId(req), pageId));
  }

  @Patch(':pageId')
  @AuditLog('team-wiki', 'update-page')
  @RequirePermission('admin:documents:write')
  async update(@Param('pageId') pageId: string, @Body() body: unknown, @Req() req: Request) {
    return this.unwrap(await this.ragClient.updateTeamWikiPage(this.getUserId(req), pageId, this.pageInput(body)));
  }

  @Delete(':pageId')
  @AuditLog('team-wiki', 'delete-page')
  @RequirePermission('admin:documents:write')
  async delete(@Param('pageId') pageId: string, @Req() req: Request) {
    return this.unwrap(await this.ragClient.deleteTeamWikiPage(this.getUserId(req), pageId));
  }

  private getUserId(req: Request): string {
    const user = req.user as { userId?: string; sub?: string } | undefined;
    const id = user?.userId ?? user?.sub;
    if (!id?.trim()) throw new HttpException('authenticated user is required', 401);
    return id.trim();
  }

  private pageInput(body: unknown) {
    const value = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    return {
      title: value.title,
      content: value.content,
      references: value.references,
      changeSummary: value.changeSummary,
      expectedRevisionNumber: value.expectedRevisionNumber,
    };
  }

  private rollbackInput(body: unknown) {
    const value = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    return {
      revisionId: value.revisionId,
      expectedRevisionNumber: value.expectedRevisionNumber,
    };
  }

  private unwrap<T>(result: { available: boolean; status: number | null; data: T | null; error?: string }): T {
    if (!result.available || result.data === null) {
      throw new HttpException(result.error || 'RAG service request failed', result.status && result.status >= 400 ? result.status : 502);
    }
    return result.data;
  }
}
