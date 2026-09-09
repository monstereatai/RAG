import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsController } from './metrics.controller';
import { MetricsInterceptor } from './metrics.interceptor';
import { MetricsService } from './metrics.service';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { SecurityAuditService } from './security-audit.service';

@Module({
  imports: [DomainEventsModule],
  controllers: [MetricsController],
  providers: [
    MetricsService,
    SecurityAuditService,
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },
  ],
  exports: [MetricsService, SecurityAuditService],
})
export class MetricsModule {}
