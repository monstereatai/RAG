import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { RequireLogin } from '../../common/decorators/require-login.decorator';
import { ApiExcludeController } from '@nestjs/swagger';

@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @RequireLogin(false)
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  getMetrics() {
    return this.metricsService.getMetrics();
  }
}
