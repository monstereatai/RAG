import { Controller, Get, UseGuards } from '@nestjs/common';
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
}
