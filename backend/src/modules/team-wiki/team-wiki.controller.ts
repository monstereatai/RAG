import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/api-response.interface';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TeamWikiService } from './team-wiki.service';
import type { TeamWikiPageInput } from './team-wiki.service';

@Controller('team-wiki')
@UseGuards(JwtAuthGuard)
export class TeamWikiController {
  constructor(private readonly teamWiki: TeamWikiService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('q') query?: string,
    @Query('limit') limit?: string,
  ) {
    return this.teamWiki.list(this.tenant(user), query, Number(limit) || 100);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() body: TeamWikiPageInput) {
    return this.teamWiki.create(
      this.tenant(user),
      user.userId,
      this.pageInput(body),
    );
  }

  @Get(':pageId/revisions')
  revisions(@CurrentUser() user: JwtPayload, @Param('pageId') pageId: string) {
    return this.teamWiki.listRevisions(this.tenant(user), pageId);
  }

  @Get(':pageId/compare')
  compare(
    @CurrentUser() user: JwtPayload,
    @Param('pageId') pageId: string,
    @Query('from') fromRevisionId: string,
    @Query('to') toRevisionId: string,
  ) {
    return this.teamWiki.compareRevisions(
      this.tenant(user),
      pageId,
      fromRevisionId,
      toRevisionId,
    );
  }

  @Post(':pageId/rollback')
  rollback(
    @CurrentUser() user: JwtPayload,
    @Param('pageId') pageId: string,
    @Body() body: { revisionId?: string; expectedRevisionNumber?: number },
  ) {
    return this.teamWiki.rollback(
      this.tenant(user),
      user.userId,
      pageId,
      String(body.revisionId ?? ''),
      body.expectedRevisionNumber,
    );
  }

  @Post(':pageId/publish')
  publish(@CurrentUser() user: JwtPayload, @Param('pageId') pageId: string) {
    return this.teamWiki.publish(this.tenant(user), user.userId, pageId);
  }

  @Get(':pageId')
  get(@CurrentUser() user: JwtPayload, @Param('pageId') pageId: string) {
    return this.teamWiki.get(this.tenant(user), pageId);
  }

  @Patch(':pageId')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('pageId') pageId: string,
    @Body() body: TeamWikiPageInput,
  ) {
    return this.teamWiki.update(
      this.tenant(user),
      user.userId,
      pageId,
      this.pageInput(body),
    );
  }

  @Delete(':pageId')
  delete(@CurrentUser() user: JwtPayload, @Param('pageId') pageId: string) {
    return this.teamWiki.delete(this.tenant(user), user.userId, pageId);
  }

  private tenant(user: JwtPayload) {
    return user.tenantId?.trim() || 'legacy';
  }

  private pageInput(body: TeamWikiPageInput): TeamWikiPageInput {
    return {
      title: body.title,
      content: body.content,
      references: body.references,
      changeSummary: body.changeSummary,
      expectedRevisionNumber: body.expectedRevisionNumber,
    };
  }
}
