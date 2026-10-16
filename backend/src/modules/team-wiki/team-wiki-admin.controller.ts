import {
  BadRequestException,
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
import { ServiceTokenGuard } from '../../common/guards/service-token.guard';
import { TeamWikiService } from './team-wiki.service';
import type { TeamWikiPageInput } from './team-wiki.service';

/** Internal bridge used only by Admin Backend after it validates its own session and permissions. */
@Controller('rag/admin/team-wiki')
@UseGuards(ServiceTokenGuard)
export class TeamWikiAdminController {
  constructor(private readonly teamWiki: TeamWikiService) {}

  @Get('pages')
  async list(
    @Query('ownerUserId') ownerUserId?: string,
    @Query('q') query?: string,
    @Query('limit') limit?: string,
  ) {
    const identity = this.requireOwner(ownerUserId);
    return this.teamWiki.list(
      await this.teamWiki.resolveTenant(identity),
      query,
      Number(limit) || 100,
    );
  }

  @Post('pages')
  async create(
    @Query('ownerUserId') ownerUserId: string,
    @Body() body: TeamWikiPageInput,
  ) {
    const identity = this.requireOwner(ownerUserId);
    return this.teamWiki.create(
      await this.teamWiki.resolveTenant(identity),
      identity,
      body,
    );
  }

  @Get('pages/:pageId/revisions')
  async revisions(
    @Param('pageId') pageId: string,
    @Query('ownerUserId') ownerUserId?: string,
  ) {
    const tenant = await this.teamWiki.resolveTenant(
      this.requireOwner(ownerUserId),
    );
    return this.teamWiki.listRevisions(tenant, pageId);
  }

  @Get('pages/:pageId/compare')
  async compare(
    @Param('pageId') pageId: string,
    @Query('from') fromRevisionId: string,
    @Query('to') toRevisionId: string,
    @Query('ownerUserId') ownerUserId?: string,
  ) {
    const tenant = await this.teamWiki.resolveTenant(
      this.requireOwner(ownerUserId),
    );
    return this.teamWiki.compareRevisions(
      tenant,
      pageId,
      fromRevisionId,
      toRevisionId,
    );
  }

  @Post('pages/:pageId/rollback')
  async rollback(
    @Param('pageId') pageId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Body() body: { revisionId?: string; expectedRevisionNumber?: number },
  ) {
    const identity = this.requireOwner(ownerUserId);
    const tenant = await this.teamWiki.resolveTenant(identity);
    return this.teamWiki.rollback(
      tenant,
      identity,
      pageId,
      String(body.revisionId ?? ''),
      body.expectedRevisionNumber,
    );
  }

  @Post('pages/:pageId/publish')
  async publish(
    @Param('pageId') pageId: string,
    @Query('ownerUserId') ownerUserId: string,
  ) {
    const identity = this.requireOwner(ownerUserId);
    return this.teamWiki.publish(
      await this.teamWiki.resolveTenant(identity),
      identity,
      pageId,
    );
  }

  @Get('pages/:pageId')
  async get(
    @Param('pageId') pageId: string,
    @Query('ownerUserId') ownerUserId?: string,
  ) {
    const tenant = await this.teamWiki.resolveTenant(
      this.requireOwner(ownerUserId),
    );
    return this.teamWiki.get(tenant, pageId);
  }

  @Patch('pages/:pageId')
  async update(
    @Param('pageId') pageId: string,
    @Query('ownerUserId') ownerUserId: string,
    @Body() body: TeamWikiPageInput,
  ) {
    const identity = this.requireOwner(ownerUserId);
    return this.teamWiki.update(
      await this.teamWiki.resolveTenant(identity),
      identity,
      pageId,
      body,
    );
  }

  @Delete('pages/:pageId')
  async delete(
    @Param('pageId') pageId: string,
    @Query('ownerUserId') ownerUserId: string,
  ) {
    const identity = this.requireOwner(ownerUserId);
    return this.teamWiki.delete(
      await this.teamWiki.resolveTenant(identity),
      identity,
      pageId,
    );
  }

  private requireOwner(ownerUserId?: string) {
    if (!ownerUserId?.trim())
      throw new BadRequestException('ownerUserId is required');
    return ownerUserId.trim();
  }
}
