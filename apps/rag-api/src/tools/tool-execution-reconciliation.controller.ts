import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { ServiceTokenGuard } from '../common/guards/service-token.guard';
import { ToolExecutionReconciliationService } from './tool-execution-reconciliation.service';

/**
 * Internal-only bridge. The Admin API must enforce admin:qa-ops:write, derive
 * tenantId from the persisted run scope, and inject operatorId from its
 * authenticated user before forwarding this request.
 */
@Public()
@Controller('rag/admin/tool-execution')
@UseGuards(ServiceTokenGuard)
export class ToolExecutionReconciliationController {
  constructor(
    private readonly reconciliation: ToolExecutionReconciliationService,
  ) {}

  @Post('unknown/:callId/reconcile')
  @HttpCode(HttpStatus.OK)
  reconcile(@Param('callId') callId: string, @Body() body: unknown) {
    return this.reconciliation.reconcile(callId, body);
  }
}
