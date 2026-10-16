import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiScopes } from '../../common/decorators/api-scopes.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { JwtPayload } from '../../common/interfaces/api-response.interface';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FeishuWikiSyncService } from './feishu-wiki-sync.service';

@Controller('integrations/feishu/wiki')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@ApiScopes('rag:documents')
export class FeishuWikiSyncController {
  constructor(private readonly syncService: FeishuWikiSyncService) {}

  @Post('sync')
  sync(
    @Body() body: { spaceId?: string; shareWithinTenant?: boolean },
    @CurrentUser() user: JwtPayload,
  ) {
    if (typeof body?.spaceId !== 'string') {
      throw new BadRequestException('spaceId is required');
    }
    return this.syncService.sync(body.spaceId, user, body.shareWithinTenant);
  }

  @Get('status')
  status(@Query('spaceId') spaceId: string, @CurrentUser() user: JwtPayload) {
    return this.syncService.status(spaceId, user);
  }
}
