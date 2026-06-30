import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LangfuseProvider } from './langfuse.provider';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [LangfuseProvider],
  exports: [LangfuseProvider],
})
export class ObservabilityModule {}
