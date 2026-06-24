import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/interfaces/api-response.interface';
import { WeeklySummaryService } from './weekly-summary.service';

@Controller('api/v1/weekly-summary')
export class WeeklySummaryController {
  constructor(private readonly service: WeeklySummaryService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async list(@CurrentUser() user: JwtPayload, @Query('limit') limit?: string) {
    const summaries = await this.service.getSummaries(
      user.userId,
      Math.min(Number(limit) || 10, 50),
    );
    return { code: 200, data: summaries };
  }

  @Post('generate')
  @UseGuards(JwtAuthGuard)
  async generate(@CurrentUser() user: JwtPayload) {
    const result = await this.service.generateLastWeekSummary(user.userId);
    return { code: 200, data: result };
  }
}
