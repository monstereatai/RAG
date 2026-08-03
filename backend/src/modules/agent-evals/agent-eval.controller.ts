import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AgentEvalDto } from './agent-eval.dto';
import { AgentEvalService } from './agent-eval.service';

@Controller('agent-evals')
@UseGuards(JwtAuthGuard)
export class AgentEvalController {
  constructor(private readonly evalService: AgentEvalService) {}

  @Post('evaluate')
  evaluate(@Body() body: AgentEvalDto) {
    return this.evalService.evaluate(body);
  }
}
