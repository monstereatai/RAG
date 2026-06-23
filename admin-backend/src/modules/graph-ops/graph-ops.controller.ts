import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RagClientService } from '../rag-client/rag-client.service';
import { GraphOpsMockService } from './graph-ops-mock.service';

@ApiTags('admin-graph-ops')
@ApiBearerAuth()
@Controller('admin/graph-ops')
export class GraphOpsController {
  constructor(
    private readonly ragClient: RagClientService,
    private readonly mockService: GraphOpsMockService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: '知识图谱运营概览' })
  @RequirePermission('admin:graph-ops:read')
  async overview() {
    const [schema, entities, relationships, orphans, conflicts] =
      await Promise.all([
        this.ragClient.getGraphSchema(),
        this.ragClient.getGraphEntities(),
        this.ragClient.getGraphRelationships(),
        this.ragClient.getGraphOrphans(),
        this.ragClient.getGraphConflicts(),
      ]);

    const allAvailable = [schema, entities, relationships, orphans, conflicts].every(
      (r) => r.available,
    );
    const anyAvailable = [schema, entities, relationships, orphans, conflicts].some(
      (r) => r.available,
    );

    return {
      status: allAvailable
        ? 'available'
        : anyAvailable
          ? 'partial'
          : 'unavailable',
      data: {
        schema: schema.data ?? null,
        entities: entities.data ?? [],
        relationships: relationships.data ?? [],
        orphanNodes: orphans.data ?? [],
        conflictRelationships: conflicts.data ?? [],
      },
      upstream: { schema, entities, relationships, orphans, conflicts },
    };
  }

  @Get('stats')
  @ApiOperation({ summary: '图谱统计（前端 graph-ops 页面）' })
  @RequirePermission('admin:graph-ops:read')
  async getStats() {
    const [entities, relationships] = await Promise.all([
      this.ragClient.getGraphEntities(),
      this.ragClient.getGraphRelationships(),
    ]);
    const entityList = Array.isArray(entities.data) ? entities.data : [];
    const relList = Array.isArray(relationships.data) ? relationships.data : [];

    // 上游无数据时 fallback 到 mock
    if (entityList.length === 0 && relList.length === 0) {
      return { data: this.mockService.getStats() };
    }

    return {
      data: {
        nodeCount: entityList.length,
        edgeCount: relList.length,
        entityTypes: [],
        relationTypes: [],
      },
    };
  }

  @Get('schema')
  @ApiOperation({ summary: '图谱 schema' })
  @RequirePermission('admin:graph-ops:read')
  async getSchema() {
    const result = await this.ragClient.getGraphSchema();
    const schema = {
      nodeLabels: (result.data as any)?.nodeLabels ?? [],
      edgeTypes: (result.data as any)?.edgeTypes ?? [],
      properties: (result.data as any)?.properties ?? {},
    };

    if (schema.nodeLabels.length === 0 && schema.edgeTypes.length === 0) {
      return { data: this.mockService.getSchema() };
    }

    return { data: schema };
  }

  @Get('nodes')
  @ApiOperation({ summary: '图谱节点列表（前端 graph-ops 页面）' })
  @RequirePermission('admin:graph-ops:read')
  async getNodes(@Query() query: any) {
    const entities = await this.ragClient.getGraphEntities();
    const items = (Array.isArray(entities.data) ? entities.data : []) as any[];

    // 上游无数据时 fallback 到 mock
    if (items.length === 0) {
      return { data: this.mockService.getNodes() };
    }

    return {
      data: items.map((item: any, index: number) => ({
        id: item.id ?? String(index + 1),
        label: item.name ?? item.label ?? '',
        type: item.type ?? 'entity',
        properties: item.properties ?? {},
      })),
    };
  }

  @Get('search')
  @ApiOperation({ summary: '图谱搜索（前端 graph-ops 页面）' })
  @RequirePermission('admin:graph-ops:read')
  async search(@Query('query') query?: string) {
    const [entities, relationships] = await Promise.all([
      this.ragClient.getGraphEntities(),
      this.ragClient.getGraphRelationships(),
    ]);
    const entityList = Array.isArray(entities.data) ? entities.data : [];
    const relList = Array.isArray(relationships.data) ? relationships.data : [];

    // 上游无数据时 fallback 到 mock
    if (entityList.length === 0 && relList.length === 0) {
      return { data: this.mockService.search(query) };
    }

    return {
      data: {
        nodes: entityList.map((item: any, index: number) => ({
          id: item.id ?? String(index + 1),
          label: item.name ?? item.label ?? '',
          type: item.type ?? 'entity',
          properties: item.properties ?? {},
        })),
        edges: relList.map((item: any, index: number) => ({
          id: item.id ?? String(index + 1),
          source: item.source ?? item.from ?? '',
          target: item.target ?? item.to ?? '',
          label: item.type ?? item.label ?? '',
        })),
      },
    };
  }

  @Get('entities')
  @ApiOperation({ summary: '实体列表' })
  @RequirePermission('admin:graph-ops:read')
  async getEntities() {
    return this.ragClient.getGraphEntities();
  }

  @Get('relationships')
  @ApiOperation({ summary: '关系列表' })
  @RequirePermission('admin:graph-ops:read')
  async getRelationships() {
    return this.ragClient.getGraphRelationships();
  }

  @Get('orphans')
  @ApiOperation({ summary: '孤立节点' })
  @RequirePermission('admin:graph-ops:read')
  async getOrphans() {
    return this.ragClient.getGraphOrphans();
  }

  @Get('conflicts')
  @ApiOperation({ summary: '冲突关系' })
  @RequirePermission('admin:graph-ops:read')
  async getConflicts() {
    return this.ragClient.getGraphConflicts();
  }
}
