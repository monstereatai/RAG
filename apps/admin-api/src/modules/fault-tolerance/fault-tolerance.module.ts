import { Module } from '@nestjs/common';
import { GlobalExceptionFilter } from './exceptions.filter';

@Module({
  providers: [GlobalExceptionFilter],
})
export class FaultToleranceModule {}
