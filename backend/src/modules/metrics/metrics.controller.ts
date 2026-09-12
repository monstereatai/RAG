import { Controller, Get, Header } from '@nestjs/common';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @SkipTransform()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  metrics(): Promise<string> {
    return this.metricsService.metrics();
  }
}
