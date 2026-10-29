import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiScopes } from '../../common/decorators/api-scopes.decorator';
import { LangfuseProvider } from './langfuse.provider';
import { DingTalkProvider } from '../notify/dingtalk.provider';

@Controller('observability')
@UseGuards(JwtAuthGuard)
@ApiScopes('rag:observability')
export class ObservabilityController {
  constructor(
    private readonly langfuseProvider: LangfuseProvider,
    private readonly dingTalkProvider: DingTalkProvider,
  ) {}

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

  @Get('dingtalk/status')
  getDingTalkStatus() {
    return this.dingTalkProvider.getStatus();
  }

  @Get('dingtalk/health')
  getDingTalkHealth() {
    return this.dingTalkProvider.getHealth();
  }

  @Post('dingtalk/smoke')
  smokeDingTalk() {
    return this.dingTalkProvider.smoke();
  }
}
