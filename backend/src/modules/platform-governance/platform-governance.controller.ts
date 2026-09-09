import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ServiceTokenGuard } from '../../common/guards/service-token.guard';
import { PlatformGovernanceService } from './platform-governance.service';

@Controller('platform-governance')
@UseGuards(ServiceTokenGuard)
export class PlatformGovernanceController {
  constructor(private readonly service: PlatformGovernanceService) {}

  @Get('workflows') listWorkflows(@Query('workspaceId') workspaceId?: string) {
    return this.service.listWorkflows(workspaceId);
  }
  @Post('workflows') createWorkflow(@Body() body: any) {
    return this.service.createWorkflow({ ...body, ownerId: 'admin-backend' });
  }
  @Get('workflows/:id') getWorkflow(@Param('id') id: string) {
    return this.service.getWorkflow(id);
  }
  @Post('workflows/:id/publish') publishWorkflow(
    @Param('id') id: string,
    @Body('version') version: number,
  ) {
    return this.service.publishWorkflow(id, Number(version));
  }
  @Post('workflows/:id/clone') cloneWorkflow(
    @Param('id') id: string,
    @Body() body: { key: string; name?: string },
  ) {
    return this.service.cloneWorkflow(id, {
      ...body,
      ownerId: 'admin-backend',
    });
  }
  @Get('plugins') listPlugins() {
    return this.service.listPlugins();
  }
  @Post('plugins') registerPlugin(@Body() body: any) {
    return this.service.registerPlugin(body);
  }
  @Post('plugins/:key/:version/status') setPluginStatus(
    @Param('key') key: string,
    @Param('version') version: string,
    @Body('status') status: 'enabled' | 'disabled' | 'degraded',
  ) {
    return this.service.setPluginStatus(key, version, status);
  }
  @Post('plugin-compositions/resolve') resolvePluginComposition(
    @Body()
    body: {
      pluginKeys?: string[];
      mode?: 'simple' | 'auto' | 'agentic' | 'production';
    },
  ) {
    return this.service.resolvePluginComposition(
      body.pluginKeys,
      body.mode ?? 'production',
    );
  }
  @Get('models') listModels() {
    return this.service.listModels();
  }
  @Post('models') registerModel(@Body() body: any) {
    return this.service.registerModel(body);
  }
  @Get('evaluation-cases') listEvaluationCases(
    @Query('workspaceId') workspaceId?: string,
  ) {
    return this.service.listEvaluationCases(workspaceId);
  }
  @Post('evaluation-cases') createEvaluationCase(@Body() body: any) {
    return this.service.createEvaluationCase({
      ...body,
      createdBy: 'admin-backend',
    });
  }
  @Get('knowledge-base-profiles') listKnowledgeBaseProfiles(
    @Query('workspaceId') workspaceId?: string,
  ) {
    return this.service.listKnowledgeBaseProfiles(workspaceId);
  }
  @Post('knowledge-base-profiles') registerKnowledgeBaseProfile(
    @Body() body: any,
  ) {
    return this.service.registerKnowledgeBaseProfile(body);
  }
  @Get('retrieval-debug') debugRetrieval(
    @Query('query') query: string,
    @Query('vectorSearch') vectorSearch: string,
    @Query('scope') scope: string,
    @Query('knowledgeBaseKey') knowledgeBaseKey?: string,
  ) {
    return this.service.debugRetrieval(query, 'admin-backend', {
      vectorSearch: vectorSearch !== 'false',
      scope,
      profile: knowledgeBaseKey,
    });
  }
}
