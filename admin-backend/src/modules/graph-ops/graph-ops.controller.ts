import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RagClientService } from '../rag-client/rag-client.service';

@ApiTags('admin-graph-ops')
@ApiBearerAuth()
@Controller('admin/graph-ops')
export class GraphOpsController {
  constructor(private readonly ragClient: RagClientService) {}

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

  @Get('schema')
  @ApiOperation({ summary: '图谱 schema' })
  @RequirePermission('admin:graph-ops:read')
  async getSchema() {
    return this.ragClient.getGraphSchema();
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
