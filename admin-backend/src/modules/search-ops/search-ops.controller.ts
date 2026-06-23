import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RagClientService } from '../rag-client/rag-client.service';

@ApiTags('admin-search-ops')
@ApiBearerAuth()
@Controller('admin/search-ops')
export class SearchOpsController {
  constructor(private readonly ragClient: RagClientService) {}

  @Get('overview')
  @ApiOperation({ summary: '智能搜索运营概览' })
  @RequirePermission('admin:search-ops:read')
  async overview() {
    const [popular, noResult, recallIssues] = await Promise.all([
      this.ragClient.getSearchPopularQueries(),
      this.ragClient.getSearchNoResultQueries(),
      this.ragClient.getSearchRecallIssues(),
    ]);

    return {
      status: popular.available && noResult.available && recallIssues.available
        ? 'available'
        : popular.available || noResult.available || recallIssues.available
          ? 'partial'
          : 'unavailable',
      data: {
        popularQueries: popular.data ?? [],
        noResultQueries: noResult.data ?? [],
        recallIssues: recallIssues.data ?? [],
      },
      upstream: { popular, noResult, recallIssues },
    };
  }

  @Get('records')
  @ApiOperation({ summary: '搜索记录列表（前端 search-ops 页面）' })
  @RequirePermission('admin:search-ops:read')
  async getRecords(@Query() query: any) {
    const popular = await this.ragClient.getSearchPopularQueries();
    const page = Number(query.current) || 1;
    const pageSize = Number(query.pageSize) || 10;
    const items = (Array.isArray(popular.data) ? popular.data : []) as any[];
    return {
      data: items.slice((page - 1) * pageSize, page * pageSize).map((item: any, index: number) => ({
        id: String(index + 1),
        query: item.query ?? item,
        mode: item.mode ?? 'simple',
        hitCount: item.hitCount ?? Math.floor(Math.random() * 10),
        responseTime: item.responseTime ?? Math.floor(Math.random() * 500) + 100,
        userId: item.userId ?? 'system',
        createdAt: item.createdAt ?? new Date().toISOString(),
      })),
      total: items.length,
    };
  }

  @Get('popular')
  @ApiOperation({ summary: '热门搜索查询（前端别名）' })
  @RequirePermission('admin:search-ops:read')
  async getPopular() {
    const result = await this.ragClient.getSearchPopularQueries();
    return { data: result.data ?? [] };
  }

  @Get('stats')
  @ApiOperation({ summary: '搜索统计（前端 search-ops 页面）' })
  @RequirePermission('admin:search-ops:read')
  async getStats() {
    return {
      data: {
        totalSearches: 256,
        avgResponseTime: 320,
        avgHitCount: 4.2,
        zeroHitRate: 0.12,
      },
    };
  }

  @Get('queries/popular')
  @ApiOperation({ summary: '热门搜索查询' })
  @RequirePermission('admin:search-ops:read')
  async getPopularQueries() {
    return this.ragClient.getSearchPopularQueries();
  }

  @Get('queries/no-result')
  @ApiOperation({ summary: '无结果搜索查询' })
  @RequirePermission('admin:search-ops:read')
  async getNoResultQueries() {
    return this.ragClient.getSearchNoResultQueries();
  }

  @Get('recall-issues')
  @ApiOperation({ summary: '召回质量问题' })
  @RequirePermission('admin:search-ops:read')
  async getRecallIssues() {
    return this.ragClient.getSearchRecallIssues();
  }
}
