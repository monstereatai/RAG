import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RagClientService } from '../rag-client/rag-client.service';

@ApiTags('admin-feishu-wiki')
@ApiBearerAuth()
@Controller('admin/integrations/feishu/wiki')
export class FeishuWikiController {
  constructor(private readonly ragClient: RagClientService) {}

  @Post('sync')
  @ApiOperation({ summary: '同步飞书 Wiki 知识库' })
  @RequirePermission('admin:documents:write')
  @AuditLog('integrations', 'feishu-wiki-sync')
  async sync(
    @Body() body: { spaceId?: string; shareWithinTenant?: boolean },
    @Req() req: Request,
  ) {
    const spaceId = this.requireSpaceId(body?.spaceId);
    const shareWithinTenant = body?.shareWithinTenant;
    if (shareWithinTenant !== undefined && typeof shareWithinTenant !== 'boolean') {
      throw new BadRequestException('shareWithinTenant must be a boolean');
    }
    return this.unwrap(
      await this.ragClient.syncFeishuWiki(this.requireAdminUserId(req), spaceId, shareWithinTenant),
      '飞书 Wiki 同步',
    );
  }

  @Get('status')
  @ApiOperation({ summary: '查询飞书 Wiki 同步状态' })
  @ApiQuery({ name: 'spaceId', required: true })
  @RequirePermission('admin:documents:read')
  async status(@Query('spaceId') rawSpaceId: string | undefined, @Req() req: Request) {
    const spaceId = this.requireSpaceId(rawSpaceId);
    return this.unwrap(
      await this.ragClient.getFeishuWikiStatus(this.requireAdminUserId(req), spaceId),
      '飞书 Wiki 状态查询',
    );
  }

  private requireAdminUserId(req: Request): string {
    const user = (req as Request & { user?: { userId?: string; sub?: string; role?: string } }).user;
    if (user?.role !== 'admin') throw new ForbiddenException('admin role is required');
    const userId = user.userId ?? user.sub;
    if (!userId?.trim()) throw new UnauthorizedException('authenticated user is required');
    return userId.trim();
  }

  private requireSpaceId(value?: string): string {
    const spaceId = value?.trim();
    if (!spaceId) throw new BadRequestException('spaceId is required');
    return spaceId;
  }

  private unwrap(
    result: { available: boolean; status: number | null; data: unknown; error?: string },
    action: string,
  ) {
    if (!result.available) {
      throw new HttpException(
        result.error || `${action}暂不可用${result.status ? `（${result.status}）` : ''}`,
        result.status && result.status >= 400 ? result.status : 502,
      );
    }

    const payload = result.data;
    if (payload && typeof payload === 'object' && 'data' in payload) {
      return (payload as { data: unknown }).data;
    }
    return payload;
  }
}
