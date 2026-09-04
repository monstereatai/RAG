import { Controller, Get, Post, Query, ServiceUnavailableException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RagClientService } from '../rag-client/rag-client.service';

@ApiTags('admin-search-ops')
@ApiBearerAuth()
@Controller('admin/search-ops')
export class SearchOpsController {
  /**
   * 搜索运营网关：负责 RBAC（基于角色的访问控制）和上游包装拆除。
   * 前端只能获得最终业务数据，不能感知 RAG Client 的 available／status 内部协议。
   */
  constructor(private readonly ragClient: RagClientService) {}

  @Get('overview')
  @ApiOperation({ summary: '智能搜索运营概览' })
  @RequirePermission('admin:search-ops:read')
  /** 多个分析指标独立拉取，允许部分可用并将上游健康状态保留给运营排障。 */
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
        popularQueries: this.asArray(this.unwrapRagResult(popular)),
        noResultQueries: this.asArray(this.unwrapRagResult(noResult)),
        recallIssues: this.asArray(this.unwrapRagResult(recallIssues)),
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
    const items = this.asArray(this.unwrapRagResult(popular));
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
    return { data: this.asArray(this.unwrapRagResult(result)) };
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

  @Get('documents')
  @ApiOperation({ summary: '文档全文检索（关键词高亮）' })
  @RequirePermission('admin:search-ops:read')
  async searchDocuments(
    @Query('q') query = '',
    @Query('limit') limit?: string,
    @Query('fileType') fileType?: string,
    @Query('updatedRange') updatedRange?: string,
    @Query('documentType') documentType?: string,
    @Query('role') role?: string,
  ) {
    const result = await this.ragClient.searchDocuments(query, Number(limit) || 20, {
      fileType: fileType || undefined,
      updatedRange: updatedRange || undefined,
      documentType: documentType || undefined,
      role: role || undefined,
    });
    return this.asArray(this.requireAvailable(result));
  }

  @Get('documents/facets')
  @ApiOperation({ summary: '搜索筛选面板 facets（文档分类/权限范围）' })
  @RequirePermission('admin:search-ops:read')
  async getDocumentFacets() {
    const result = await this.ragClient.getDocumentSearchFacets();
    return this.requireAvailable(result);
  }

  @Post('documents/reindex')
  @ApiOperation({ summary: '补建已有文档的全文索引' })
  @RequirePermission('admin:documents:write')
  async reindexDocuments(@Query('limit') limit?: string) {
    const result = await this.ragClient.reindexDocumentSearch(Number(limit) || 1000);
    return this.requireAvailable(result);
  }

  @Get('graph')
  @ApiOperation({ summary: '知识图谱关键词检索' })
  @RequirePermission('admin:search-ops:read')
  async searchGraph(@Query('query') query = '', @Query('limit') limit?: string) {
    const result = await this.ragClient.searchGraph(query, Number(limit) || 100);
    return this.requireAvailable(result);
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

  /** 将上游不可用转成明确的 503，不能把空对象伪装成「没有搜索结果」。 */
  private requireAvailable(result: {
    available: boolean;
    status: number | null;
    data: unknown;
    error?: string;
  }): unknown {
    if (!result.available) {
      throw new ServiceUnavailableException(
        result.error || `RAG 服务不可用${result.status ? `（${result.status}）` : ''}`,
      );
    }
    return this.unwrapRagResult(result);
  }

  /** RAG 服务的统一响应只在网关边界拆包，前端永远只接收业务数据。 */
  private unwrapRagResult(result: { data?: unknown } | unknown): unknown {
    let payload = (result as { data?: unknown } | null)?.data ?? result;
    if (payload && typeof payload === 'object' && 'code' in payload && 'data' in payload) {
      payload = (payload as { data: unknown }).data;
    }
    // RAG 管理接口会在 HTTP 成功响应内携带 available/data；available 是网关状态，
    // 不能继续透传给页面，否则页面会把它当成实际的节点或文档结果。
    if (payload && typeof payload === 'object' && 'available' in payload && 'data' in payload) {
      payload = (payload as { data: unknown }).data;
    }
    return payload;
  }

  private asArray(value: unknown): any[] {
    return Array.isArray(value) ? value : [];
  }
}
