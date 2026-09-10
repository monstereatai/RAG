import { ConflictException, Controller, Delete, Get, Param, Patch, Body, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SystemConfigService } from './system-config.service';
import { RagClientService } from '../rag-client/rag-client.service';

@ApiTags('admin-system-config')
@ApiBearerAuth()
@Controller('admin/system-config')
export class SystemConfigController {
  constructor(private readonly systemConfigService: SystemConfigService) {}

  @Get()
  @ApiOperation({ summary: '查看后台系统配置状态' })
  @RequirePermission('admin:system:read')
  overview() {
    return this.systemConfigService.getOverview();
  }
}

@ApiTags('admin-config')
@ApiBearerAuth()
@Controller('admin/config')
export class AdminConfigController {
  constructor(
    private readonly systemConfigService: SystemConfigService,
    private readonly ragClient: RagClientService,
  ) {}

  @Get()
  @ApiOperation({ summary: '获取系统配置列表（前端 system-config 页面）' })
  @RequirePermission('admin:system:read')
  list() {
    return this.systemConfigService.getConfigList();
  }

  @Patch(':key')
  @ApiOperation({ summary: '更新配置项' })
  @RequirePermission('admin:system:read')
  update(@Param('key') key: string, @Body() body: { value: string }) {
    const result = this.systemConfigService.updateConfig(key, body.value);
    throw new ConflictException(result);
  }

  @Get('api-tokens')
  @ApiOperation({ summary: '查看长期 MCP/API Key 列表' })
  @RequirePermission('admin:system:read')
  listApiTokens() {
    return this.ragClient.listApiTokens();
  }

  @Post('api-tokens')
  @ApiOperation({ summary: '生成长期 MCP/API Key' })
  @RequirePermission('admin:system:read')
  createApiToken(@Body() body: { name: string; scopes?: string[]; expiresAt?: string }) {
    return this.ragClient.createApiToken(body);
  }

  @Delete('api-tokens/:id')
  @ApiOperation({ summary: '吊销长期 MCP/API Key' })
  @RequirePermission('admin:system:read')
  revokeApiToken(@Param('id') id: string) {
    return this.ragClient.revokeApiToken(id);
  }
}
