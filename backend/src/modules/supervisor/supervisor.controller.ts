import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { SupervisorService } from './supervisor.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { IsString } from 'class-validator';

class SupervisorQueryDto {
  @IsString()
  query!: string;
}

@Controller('supervisor')
@UseGuards(JwtAuthGuard)
export class SupervisorController {
  constructor(private readonly supervisorService: SupervisorService) {}

  /**
   * Supervisor 查询：自动路由到合适领域并执行 Agent 管线
   * POST /api/v1/supervisor/query
   */
  @Post('query')
  async query(@Body() body: SupervisorQueryDto) {
    return this.supervisorService.query(body.query);
  }

  /**
   * 列出可用领域
   * GET /api/v1/supervisor/domains
   */
  @Get('domains')
  listDomains() {
    return this.supervisorService.listDomains();
  }
}
