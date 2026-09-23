import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FactConflictEntity } from '../../providers/db/entities/fact-conflict.entity';
import { GraphService } from '../graph/graph.service';

@Injectable()
export class RagAdminGraphService {
  constructor(
    private readonly graphService: GraphService,
    @InjectRepository(FactConflictEntity)
    private readonly factConflictRepo: Repository<FactConflictEntity>,
  ) {}

  async getGraphSchema() {
    if (!this.graphService.isEnabled()) {
      return {
        available: false,
        data: {
          enabled: false,
          nodeCount: 0,
          relationshipCount: 0,
          labels: [],
          relationshipTypes: [],
        },
        error: 'GraphRAG is disabled',
      };
    }
    const schema = await this.graphService.getSchema('admin');
    return { available: true, data: schema };
  }

  async getGraphEntities(
    query: { keyword?: string; type?: string; limit?: number } = {},
  ) {
    if (!this.graphService.isEnabled()) {
      return {
        available: false,
        data: [],
        total: 0,
        error: 'GraphRAG is disabled',
      };
    }
    const items = await this.graphService.listEntities('admin', query);
    return { available: true, data: items, total: items.length };
  }

  async getGraphEntityDetail(id: string) {
    if (!this.graphService.isEnabled()) {
      return { available: false, data: null, error: 'GraphRAG is disabled' };
    }
    const data = await this.graphService.getEntityDetail('admin', id);
    return { available: true, data };
  }

  async updateGraphEntity(
    id: string,
    input: {
      type?: string;
      aliases?: string[];
      sourceId?: string;
      properties?: Record<string, unknown>;
    },
  ) {
    if (!this.graphService.isEnabled()) {
      return { available: false, data: null, error: 'GraphRAG is disabled' };
    }
    const data = await this.graphService.updateEntity('admin', id, input);
    if (!data) throw new NotFoundException(`graph entity ${id} not found`);
    return { available: true, data };
  }

  async getGraphRelationships(
    query: {
      query?: string;
      relationType?: string;
      conflictOnly?: boolean;
      limit?: number;
    } = {},
  ) {
    if (!this.graphService.isEnabled()) {
      return {
        available: false,
        data: [],
        total: 0,
        error: 'GraphRAG is disabled',
      };
    }
    const items = await this.graphService.listRelationships('admin', query);
    return { available: true, data: items, total: items.length };
  }

  async searchGraph(
    query: {
      query?: string;
      relationType?: string;
      conflictOnly?: boolean;
      limit?: number;
    } = {},
  ) {
    if (!this.graphService.isEnabled()) {
      return {
        available: false,
        data: { nodes: [], edges: [] },
        error: 'GraphRAG is disabled',
      };
    }

    const [nodes, edges] = await Promise.all([
      // 后台使用服务令牌查询当前租户可见的完整图谱，不绑定普通用户会话。
      this.graphService.listEntities('*', {
        keyword: query.query,
        limit: query.limit ?? 100,
      }),
      this.graphService.listRelationships('*', query),
    ]);

    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    for (const edge of edges) {
      if (!nodeMap.has(edge.source)) {
        nodeMap.set(edge.source, {
          id: edge.source,
          label: edge.sourceLabel,
          type: edge.sourceType,
          aliases: [],
          sourceId: edge.sourceId,
          relationshipCount: 1,
          confidence: edge.confidence,
          updatedAt: edge.updatedAt,
          properties: {},
        });
      }
      if (!nodeMap.has(edge.target)) {
        nodeMap.set(edge.target, {
          id: edge.target,
          label: edge.targetLabel,
          type: edge.targetType,
          aliases: [],
          sourceId: edge.sourceId,
          relationshipCount: 1,
          confidence: edge.confidence,
          updatedAt: edge.updatedAt,
          properties: {},
        });
      }
    }

    return {
      available: true,
      data: { nodes: Array.from(nodeMap.values()), edges },
    };
  }

  async getGraphOrphans() {
    if (!this.graphService.isEnabled()) {
      return {
        available: false,
        data: [],
        total: 0,
        error: 'GraphRAG is disabled',
      };
    }
    const items = await this.graphService.getOrphanEntities('admin');
    return { available: true, data: items, total: items.length };
  }

  async getGraphConflicts() {
    const conflicts = await this.factConflictRepo.find({
      order: { createdAt: 'DESC' },
      take: 100,
    });

    return {
      available: true,
      total: conflicts.length,
      data: conflicts.map((conflict) => ({
        id: conflict.id,
        source: conflict.subject,
        sourceLabel: conflict.subject,
        target: conflict.conflictingValue,
        targetLabel: conflict.conflictingValue,
        label: conflict.predicate,
        confidence: 1,
        docId: conflict.docId,
        subject: conflict.subject,
        predicate: conflict.predicate,
        currentValue: conflict.currentValue,
        conflictingValue: conflict.conflictingValue,
        currentVersion: conflict.currentVersion,
        conflictingVersion: conflict.conflictingVersion,
        status: conflict.status,
        sourceAuthority: conflict.sourceAuthority,
        createdAt: conflict.createdAt.toISOString(),
      })),
    };
  }
}
