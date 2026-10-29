import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ObservabilityController } from './observability.controller';
import { LangfuseProvider } from './langfuse.provider';

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [ObservabilityController],
  providers: [LangfuseProvider],
  exports: [LangfuseProvider],
})
export class ObservabilityModule {}
