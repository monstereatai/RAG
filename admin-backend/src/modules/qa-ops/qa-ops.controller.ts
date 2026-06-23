import { Controller, Get } from '@nestjs/common';
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
