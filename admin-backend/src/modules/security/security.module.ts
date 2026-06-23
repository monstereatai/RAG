import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { isDatabaseEnabled } from '../../config/runtime';
import { SecurityService } from './security.service';
import { AuditService } from './audit.service';
import { VaultService } from './vault.service';
import { AuditLog } from '../../database/entities/audit-log.entity';
import { AuditLogInterceptor } from '../../common/interceptors/audit-log.interceptor';
import { SecurityInterceptor } from './interceptors/security.interceptor';
import { CorsMiddleware } from './middlewares/cors.middleware';
import { HelmetMiddleware } from './middlewares/helmet.middleware';
import { RateLimiterMiddleware } from './middlewares/rate-limiter.middleware';
import { CsrfMiddleware } from './middlewares/csrf.middleware';

const databaseEnabled = isDatabaseEnabled();

@Module({
  imports: databaseEnabled ? [TypeOrmModule.forFeature([AuditLog])] : [],
  providers: [
    SecurityService,
    AuditService,
    VaultService,
    {
      provide: APP_INTERCEPTOR,
      useClass: SecurityInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
  ],
  exports: [SecurityService, AuditService, VaultService],
})
export class SecurityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CorsMiddleware, HelmetMiddleware, RateLimiterMiddleware, CsrfMiddleware)
      .forRoutes('*');
  }
}
