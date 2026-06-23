import { Module } from '@nestjs/common';
import { TracingService } from './tracing.service';
import { TracingInterceptor } from './tracing.interceptor';
import { APP_INTERCEPTOR } from '@nestjs/core';

@Module({
  providers: [
    TracingService,
    {
      provide: APP_INTERCEPTOR,
      useClass: TracingInterceptor,
    },
  ],
  exports: [TracingService],
})
export class TracingModule {}