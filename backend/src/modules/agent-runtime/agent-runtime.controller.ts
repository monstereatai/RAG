import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AgentRuntimeService } from './agent-runtime.service';
import type { AgentRuntimeMode } from './agent-runtime.types';

@Controller('agent-runtime')
@UseGuards(JwtAuthGuard)
export class AgentRuntimeController {
  constructor(private readonly runtime: AgentRuntimeService) {}

  @Get('capabilities')
  capabilities() { return this.runtime.capabilities(); }

  @Post('plans')
  plan(@Body() body: { objective: string; mode?: AgentRuntimeMode; skillLimit?: number }) {
    return this.runtime.createPlan({ objective: body.objective, mode: body.mode ?? 'agentic', skillLimit: body.skillLimit });
  }
}
