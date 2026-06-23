import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AuditLogsService } from './audit-logs.service';

@ApiTags('admin-audit-logs')
@ApiBearerAuth()
@Controller('admin/audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @ApiOperation({ summary: '查看后台审计日志' })
  @RequirePermission('admin:audit:read')
  list(
    @Query('limit') limit?: string,
    @Query('action') action?: string,
    @Query('actor') actor?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.auditLogsService.list({
      limit: Number(limit) || 20,
      action,
      actor,
      keyword,
    });
  }
}
