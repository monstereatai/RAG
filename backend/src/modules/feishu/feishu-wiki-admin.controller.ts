import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ServiceTokenGuard } from '../../common/guards/service-token.guard';
import { FeishuWikiSyncService } from './feishu-wiki-sync.service';
import { Public } from '../../common/decorators/public.decorator';

/** Internal bridge for Admin Backend; ServiceTokenGuard authenticates the upstream Admin service. */
@Public()
@Controller('rag/admin/integrations/feishu/wiki')
@UseGuards(ServiceTokenGuard)
export class FeishuWikiAdminController {
  constructor(private readonly syncService: FeishuWikiSyncService) {}

  @Post('sync')
  sync(
    @Query('ownerUserId') ownerUserId: string,
    @Body() body: { spaceId?: string; shareWithinTenant?: boolean },
  ) {
    if (typeof body?.spaceId !== 'string') {
      throw new BadRequestException('spaceId is required');
    }
    if (
      body.shareWithinTenant !== undefined &&
      typeof body.shareWithinTenant !== 'boolean'
    ) {
      throw new BadRequestException('shareWithinTenant must be a boolean');
    }
    return this.syncService.syncForAdmin(
      ownerUserId,
      body.spaceId,
      body.shareWithinTenant,
    );
  }

  @Get('status')
  status(
    @Query('ownerUserId') ownerUserId: string,
    @Query('spaceId') spaceId: string,
  ) {
    return this.syncService.statusForAdmin(ownerUserId, spaceId);
  }
}
