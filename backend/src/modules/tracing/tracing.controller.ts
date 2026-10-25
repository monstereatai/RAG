import { Controller, Get, Query } from '@nestjs/common';
import { TracingService } from './tracing.service';
import { Public } from '../../common/decorators/public.decorator';
import { DevOnlyGuard } from '../../common/guards/dev-only.guard';
import { UseGuards } from '@nestjs/common';

@Public()
@UseGuards(DevOnlyGuard)
@Controller('traces')
export class TracingController {
  constructor(private readonly tracingService: TracingService) {}

  @Get()
  async recent(@Query('limit') limit?: string) {
    const parsed = limit ? Number(limit) : 20;
    const safeLimit = Number.isInteger(parsed)
      ? Math.min(Math.max(parsed, 1), 100)
      : 20;

    return {
      mode: 'w3c-trace-context',
      exporter: 'database+in-memory-fallback',
      spans: await this.tracingService.recentPersisted(safeLimit),
    };
  }
}
