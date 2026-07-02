import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
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
    const [entitiesRes, relationshipsRes, orphansRes, conflictsRes] = await Promise.all([
      this.ragClient.getGraphEntities(),
      this.ragClient.getGraphRelationships(),
      this.ragClient.getGraphOrphans(),
      this.ragClient.getGraphConflicts(),
    ]);
    const entities = this.unwrapRagResult(entitiesRes);
    const relationships = this.unwrapRagResult(relationshipsRes);
    const orphans = this.unwrapRagResult(orphansRes);
    const conflicts = this.unwrapRagResult(conflictsRes);
    const entityList = this.asArray((entities as any)?.data);
    const relList = this.asArray((relationships as any)?.data);

    // 上游无数据时 fallback 到 mock
    if (entityList.length === 0 && relList.length === 0) {
      return this.withMeta(this.mockService.getStats(), true);
    }

    return this.withMeta({
      nodeCount: entityList.length,
      edgeCount: relList.length,
      entityTypes: this.countBy(entityList, 'type'),
      relationTypes: this.countBy(relList, 'label'),
      orphanCount: this.asArray((orphans as any)?.data).length,
      conflictCount: this.asArray((conflicts as any)?.data).length,
      popularNodes: entityList
        .slice()
        .sort((a: any, b: any) => Number(b.relationshipCount ?? 0) - Number(a.relationshipCount ?? 0))
        .slice(0, 10),
      orphanNodes: this.asArray((orphans as any)?.data).slice(0, 10),
      conflictRelationships: this.asArray((conflicts as any)?.data).slice(0, 10),
    });
  }

  @Get('schema')
  @ApiOperation({ summary: '图谱 schema' })
  @RequirePermission('admin:graph-ops:read')
  async getSchema() {
    const result = await this.ragClient.getGraphSchema();
    const upstream = this.unwrapRagResult(result);
    const schemaData = (upstream as any)?.data ?? upstream;
    const schema = {
      nodeLabels: (schemaData as any)?.nodeLabels ?? (schemaData as any)?.labels ?? [],
      edgeTypes: (schemaData as any)?.edgeTypes ?? (schemaData as any)?.relationshipTypes ?? [],
      properties: (schemaData as any)?.properties ?? {},
    };

    if (schema.nodeLabels.length === 0 && schema.edgeTypes.length === 0) {
      return this.withMeta(this.mockService.getSchema(), true);
    }

    return this.withMeta(schema);
  }

  @Get('nodes')
  @ApiOperation({ summary: '图谱节点列表（前端 graph-ops 页面）' })
  @RequirePermission('admin:graph-ops:read')
  async getNodes(@Query() query: any) {
    const entities = await this.ragClient.getGraphEntities();
    const upstream = this.unwrapRagResult(entities);
    const items = this.asArray((upstream as any)?.data) as any[];

    // 上游无数据时 fallback 到 mock
    if (items.length === 0) {
      return {
        ...this.withMeta(this.mockService.getNodes(), true),
        total: this.mockService.getNodes().length,
      };
    }

    return {
      data: this.filterNodes(items, query),
      total: items.length,
      meta: this.realMeta(),
    };
  }

  @Get('nodes/:id')
  @ApiOperation({ summary: '图谱节点详情（前端 graph-ops 页面）' })
  @RequirePermission('admin:graph-ops:read')
  async getNodeDetail(@Param('id') id: string) {
    const result = await this.ragClient.getGraphEntityDetail(id);
    const upstream = this.unwrapRagResult(result);
    const item = (upstream as any)?.data;
    if (item) {
      return this.withMeta(item);
    }
    return this.withMeta(this.mockService.getNodeDetail(id), true);
  }

  @Patch('nodes/:id')
  @ApiOperation({ summary: '更新图谱节点（前端 graph-ops 页面）' })
  @RequirePermission('admin:graph-ops:write')
  async updateNode(@Param('id') id: string, @Body() body: any) {
    const result = await this.ragClient.updateGraphEntity(id, {
      type: body?.type,
      aliases: Array.isArray(body?.aliases) ? body.aliases : [],
      sourceId: body?.sourceId,
      properties: body?.properties && typeof body.properties === 'object'
        ? body.properties
        : {},
    });
    if (!result.available) {
      throw new ServiceUnavailableException(
        result.error || 'GraphRAG is disabled or unavailable',
      );
    }
    const upstream = this.unwrapRagResult(result);
    const item = (upstream as any)?.data ?? upstream;
    if (!item) {
      throw new NotFoundException(`graph node ${id} not found`);
    }
    return this.withMeta(item);
  }

  @Get('relations/search')
  @ApiOperation({ summary: '图谱关系检索（前端 graph-ops 页面）' })
  @RequirePermission('admin:graph-ops:read')
  async searchRelations(@Query() query: any) {
    const result = await this.ragClient.searchGraph(query);
    const upstream = this.unwrapRagResult(result);
    const data = (upstream as any)?.data;
    if (data?.nodes?.length || data?.edges?.length) {
      return this.withMeta(data);
    }
    const relations = this.mockService.searchRelations(query.query);
    return this.withMeta(
      {
        nodes: this.mockService.search(query.query).nodes,
        edges: relations,
      },
      true,
    );
  }

  @Get('relations')
  @ApiOperation({ summary: '图谱关系列表（前端 graph-ops 页面）' })
  @RequirePermission('admin:graph-ops:read')
  async getRelations(@Query() query: any) {
    const result = await this.ragClient.searchGraphRelationships(query);
    const upstream = this.unwrapRagResult(result);
    const items = this.asArray((upstream as any)?.data);
    if (items.length > 0) {
      return {
        data: items,
        total: items.length,
        meta: this.realMeta(),
      };
    }
    const fallback = this.mockService.searchRelations(query.query);
    return {
      data: fallback,
      total: fallback.length,
      meta: this.demoMeta(),
    };
  }

  @Get('search')
  @ApiOperation({ summary: '图谱搜索（前端 graph-ops 页面）' })
  @RequirePermission('admin:graph-ops:read')
  async search(@Query('query') query?: string) {
    const result = await this.ragClient.searchGraph({ query, limit: 100 });
    const upstream = this.unwrapRagResult(result);
    const data = (upstream as any)?.data;

    // 上游无数据时 fallback 到 mock
    if (!data?.nodes?.length && !data?.edges?.length) {
      return this.withMeta(this.mockService.search(query), true);
    }

    return this.withMeta(data);
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

  private unwrapRagResult(result: any): unknown {
    const payload = result?.data ?? result;
    if (payload && typeof payload === 'object' && 'code' in payload && 'data' in payload) {
      return (payload as any).data;
    }
    return payload;
  }

  private asArray(value: unknown): any[] {
    return Array.isArray(value) ? value : [];
  }

  private withMeta(data: unknown, demo = false) {
    return {
      data,
      meta: demo ? this.demoMeta() : this.realMeta(),
    };
  }

  private realMeta() {
    return {
      available: true,
      source: 'rag-backend',
      demo: false,
      message: '',
    };
  }

  private demoMeta() {
    return {
      available: true,
      source: 'mock',
      demo: true,
      message: '当前展示的是演示图谱数据，真实 Neo4j 图谱为空或不可用。',
    };
  }

  private countBy(items: any[], key: string) {
    const counts = new Map<string, number>();
    for (const item of items) {
      const value = String(item?.[key] ?? 'unknown');
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([type, count]) => ({ type, count }));
  }

  private filterNodes(items: any[], query: any) {
    const keyword = String(query?.keyword ?? '').toLowerCase();
    const type = query?.type ? String(query.type) : '';
    return items.filter((item) => {
      const matchesType = !type || item.type === type;
      const matchesKeyword =
        !keyword ||
        String(item.label ?? item.id ?? '').toLowerCase().includes(keyword) ||
        String(item.type ?? '').toLowerCase().includes(keyword) ||
        JSON.stringify(item.properties ?? {}).toLowerCase().includes(keyword);
      return matchesType && matchesKeyword;
    });
  }
}
