import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RagClientService } from '../rag-client/rag-client.service';

@ApiTags('Agent Ops')
@ApiBearerAuth()
@Controller('admin/agent-ops')
export class AgentOpsController {
  constructor(private readonly ragClient: RagClientService) {}

  @Post('workflows')
  @ApiOperation({ summary: '启动产研运工作流' })
  @RequirePermission('admin:qa-ops:write')
  startWorkflow(@Body() body: unknown, @Req() req: Request) {
    return this.ragClient.startProductionWorkflow(this.userId(req), body);
  }

  @Post('workflows/:threadId/resume')
  @ApiOperation({ summary: '审批并恢复产研运工作流' })
  @RequirePermission('admin:qa-ops:write')
  resumeWorkflow(
    @Param('threadId') threadId: string,
    @Body() body: unknown,
    @Req() req: Request
  ) {
    return this.ragClient.resumeProductionWorkflow(
      threadId,
      this.userId(req),
      body
    );
  }

  @Get('workflows/:threadId')
  @RequirePermission('admin:qa-ops:read')
  workflow(@Param('threadId') threadId: string, @Req() req: Request) {
    return this.ragClient.getProductionWorkflow(threadId, this.userId(req));
  }

  @Post('evals')
  @RequirePermission('admin:qa-ops:write')
  evaluate(@Body() body: unknown) {
    return this.ragClient.evaluateAgent(body);
  }

  @Get('bad-cases')
  @RequirePermission('admin:qa-ops:read')
  badCases(@Query('status') status?: string) {
    return this.ragClient.getAgentBadCases(status);
  }

  @Patch('bad-cases/:id')
  @RequirePermission('admin:qa-ops:write')
  reviewBadCase(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request
  ) {
    return this.ragClient.reviewAgentBadCase(id, {
      ...body,
      reviewedBy: this.userId(req),
    });
  }

  @Get('traces')
  @RequirePermission('admin:qa-ops:read')
  traces(@Query('limit') limit?: string) {
    return this.ragClient.getAgentTraces(Number(limit ?? 50));
  }

  private userId(req: Request): string {
    const user = (req as Request & { user?: { userId?: string; sub?: string } })
      .user;
    return String(user?.userId ?? user?.sub ?? 'admin-backend');
  }
}
