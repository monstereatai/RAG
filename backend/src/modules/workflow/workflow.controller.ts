import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/interfaces/api-response.interface';
import {
  buildAgenticWorkflowMermaid,
  parseSseEventTypes,
} from './agentic-workflow.mermaid';
import { ProductionWorkflowService } from './production-workflow.service';
import { GraphService } from '../graph/graph.service';
import {
  ResumeProductionWorkflowDto,
  ReviseProductionWorkflowDto,
  StartProductionWorkflowDto,
} from './production-workflow.dto';
import {
  buildPlaywayActivityGraph,
  searchPlaywayActivityTemplates,
  searchPlaywayComponents,
} from './playway-component-registry';

@Controller('workflows')
@UseGuards(JwtAuthGuard)
export class WorkflowController {
  constructor(
    private readonly productionWorkflow: ProductionWorkflowService,
    private readonly graphService: GraphService,
  ) {}

  @Get('agentic/mermaid')
  getAgenticMermaid(@Query('events') events?: string) {
    return buildAgenticWorkflowMermaid(parseSseEventTypes(events));
  }

  @Post('production')
  startProduction(
    @Body() body: StartProductionWorkflowDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productionWorkflow.startAsync(body, user.userId);
  }

  @Get('production')
  listProduction(@CurrentUser() user: JwtPayload) {
    return this.productionWorkflow.list(user.userId);
  }

  @Get('production/component-rules')
  getProductionComponentRules(
    @Query('q') query = '',
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = Number.parseInt(limit ?? '18', 10);
    return {
      items: searchPlaywayComponents(
        query,
        Number.isFinite(parsedLimit)
          ? Math.min(Math.max(parsedLimit, 1), 50)
          : 18,
      ),
      total: searchPlaywayComponents(query, 96).length,
    };
  }

  @Get('production/activity-templates')
  getProductionActivityTemplates(
    @Query('q') query = '',
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = Number.parseInt(limit ?? '4', 10);
    return {
      items: searchPlaywayActivityTemplates(
        query,
        Number.isFinite(parsedLimit)
          ? Math.min(Math.max(parsedLimit, 1), 8)
          : 4,
      ),
      total: searchPlaywayActivityTemplates(query, 8).length,
    };
  }

  @Get('production/activity-graph')
  getProductionActivityGraph(@Query('q') query = '') {
    return buildPlaywayActivityGraph(query);
  }

  @Post('production/playway-graph/import')
  importProductionPlaywayGraph(
    @Body() body: { query?: string; sourceId?: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const graph = buildPlaywayActivityGraph(body.query ?? '');
    return this.graphService.importStructuredGraph(
      {
        nodes: graph.nodes.map((node) => ({
          id: node.id,
          label: node.type,
          properties: { displayName: node.label, domain: 'playway' },
        })),
        relationships: graph.edges.map((edge) => ({
          source: edge.source,
          target: edge.target,
          type: edge.relation.toUpperCase(),
          properties: { domain: 'playway' },
        })),
      },
      user.userId,
      body.sourceId?.trim() || `playway:${body.query?.trim() || 'all'}`,
    );
  }

  @Post('production/:threadId/resume')
  resumeProduction(
    @Param('threadId') threadId: string,
    @Body() body: ResumeProductionWorkflowDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productionWorkflow.resumeAsync(threadId, body, user.userId);
  }

  @Post('production/:threadId/revise')
  reviseProduction(
    @Param('threadId') threadId: string,
    @Body() body: ReviseProductionWorkflowDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productionWorkflow.reviseAsync(threadId, body, user.userId);
  }

  @Get('production/:threadId/coding-context')
  productionCodingContext(
    @Param('threadId') threadId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productionWorkflow.codingContext(threadId, user.userId);
  }

  @Get('production/:threadId/handoff')
  productionHandoff(
    @Param('threadId') threadId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productionWorkflow.handoffManifest(threadId, user.userId);
  }

  @Get('production/:threadId/playway-preview')
  productionPlaywayPreview(
    @Param('threadId') threadId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productionWorkflow.playwayPreview(threadId, user.userId);
  }

  @Get('production/:threadId')
  productionStatus(
    @Param('threadId') threadId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productionWorkflow.status(threadId, user.userId);
  }
}
