import { Controller, Get } from '@nestjs/common';
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
