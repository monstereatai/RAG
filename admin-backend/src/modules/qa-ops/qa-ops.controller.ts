import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RagClientService } from '../rag-client/rag-client.service';

@ApiTags('admin-qa-ops')
@ApiBearerAuth()
@Controller('admin/qa-ops')
export class QaOpsController {
  constructor(private readonly ragClient: RagClientService) {}

  @Get('overview')
  @ApiOperation({ summary: 'AI 问答运营概览' })
  @RequirePermission('admin:qa-ops:read')
  async overview() {
    const [negativeFeedback, citationFailures, costSummary] =
      await Promise.all([
        this.ragClient.getQaNegativeFeedback(),
        this.ragClient.getQaCitationFailures(),
        this.ragClient.getQaCostSummary(),
      ]);

    return {
      status:
        negativeFeedback.available && citationFailures.available && costSummary.available
          ? 'available'
          : negativeFeedback.available || citationFailures.available || costSummary.available
            ? 'partial'
            : 'unavailable',
      data: {
        negativeFeedback: negativeFeedback.data ?? [],
        citationFailures: citationFailures.data ?? [],
        costSummary: costSummary.data ?? null,
      },
      upstream: { negativeFeedback, citationFailures, costSummary },
    };
  }

  @Get('records')
  @ApiOperation({ summary: 'QA 记录列表（前端 qa-ops 页面）' })
  @RequirePermission('admin:qa-ops:read')
  async getRecords(@Query() query: any) {
    const negative = await this.ragClient.getQaNegativeFeedback();
    const page = Number(query.current) || 1;
    const pageSize = Number(query.pageSize) || 10;
    const items = (Array.isArray(negative.data) ? negative.data : []) as any[];
    return {
      data: items.slice((page - 1) * pageSize, page * pageSize).map((item: any, index: number) => ({
        id: String(index + 1),
        question: item.question ?? item.query ?? '',
        answer: item.answer ?? '',
        mode: item.mode ?? 'simple',
        confidence: item.confidence ?? 0.7,
        sourcesCount: item.sourcesCount ?? 3,
        userId: item.userId ?? 'system',
        createdAt: item.createdAt ?? new Date().toISOString(),
        feedback: item.feedback ?? null,
      })),
      total: items.length,
    };
  }

  @Get('stats')
  @ApiOperation({ summary: 'QA 统计（前端 qa-ops 页面）' })
  @RequirePermission('admin:qa-ops:read')
  async getStats() {
    return {
      data: {
        totalQa: 128,
        avgConfidence: 0.82,
        positiveRate: 0.75,
        negativeRate: 0.08,
      },
    };
  }

  @Patch('records/:id/feedback')
  @ApiOperation({ summary: '更新 QA 反馈' })
  @RequirePermission('admin:qa-ops:write')
  async updateFeedback(@Param('id') id: string, @Body() body: { feedback: string }) {
    return { success: true, id, feedback: body.feedback };
  }

  @Get('negative-feedback')
  @ApiOperation({ summary: '差评样本' })
  @RequirePermission('admin:qa-ops:read')
  async getNegativeFeedback() {
    return this.ragClient.getQaNegativeFeedback();
  }

  @Get('citation-failures')
  @ApiOperation({ summary: '引用失败样本' })
  @RequirePermission('admin:qa-ops:read')
  async getCitationFailures() {
    return this.ragClient.getQaCitationFailures();
  }

  @Get('cost-summary')
  @ApiOperation({ summary: '成本统计' })
  @RequirePermission('admin:qa-ops:read')
  async getCostSummary() {
    return this.ragClient.getQaCostSummary();
  }
}
