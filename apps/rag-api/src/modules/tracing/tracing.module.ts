import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TraceSpanEntity } from '../../providers/db/entities/trace-span.entity';
import { TracingController } from './tracing.controller';
import { TracingInterceptor } from './tracing.interceptor';
import { TracingService } from './tracing.service';

@Module({
  imports: [TypeOrmModule.forFeature([TraceSpanEntity])],
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
