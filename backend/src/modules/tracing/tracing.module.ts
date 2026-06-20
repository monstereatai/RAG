import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TracingController } from './tracing.controller';
import { TracingInterceptor } from './tracing.interceptor';
import { TracingService } from './tracing.service';

@Module({
  controllers: [TracingController],
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
