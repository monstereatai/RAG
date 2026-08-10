import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LangfuseProvider } from './langfuse.provider';

@Controller('observability')
@UseGuards(JwtAuthGuard)
export class ObservabilityController {
  constructor(private readonly langfuseProvider: LangfuseProvider) {}

  @Get('langfuse/status')
  getLangfuseStatus() {
    return this.langfuseProvider.getStatus();
  }

  @Get('langfuse/health')
  getLangfuseHealth() {
    return this.langfuseProvider.getHealth();
  }

  @Post('langfuse/smoke')
  smokeLangfuse() {
    return this.langfuseProvider.smoke();
  }
}
