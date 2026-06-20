import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Neo4jProvider } from '../../providers/neo4j/neo4j.provider';
import { LlmProvider } from '../../providers/llm/llm.provider';
import {
  GraphData,
  GraphExtractorService,
  GraphNode,
  GraphRelationship,
} from '../structured/graph-extractor.service';

export interface GraphImportResult {
  sourceId: string;
  nodeCount: number;
  relationshipCount: number;
  graph: GraphData;
}

export interface GraphQueryResult {
  answer: string;
  entities: string[];
  facts: GraphFact[];
  cypher: string;
}

export interface GraphFact {
  source: string;
  sourceLabel: string;
  relationship: string;
  target: string;
  targetLabel: string;
}

export interface GraphSchemaSummary {
  enabled: boolean;
  nodeCount: number;
  relationshipCount: number;
  labels: string[];
  relationshipTypes: string[];
}

@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name);

  constructor(
    private readonly neo4jProvider: Neo4jProvider,
    private readonly graphExtractor: GraphExtractorService,
    private readonly llmProvider: LlmProvider,
  ) {}

  isEnabled(): boolean {
    return this.neo4jProvider.isEnabled();
  }

  async extract(text: string): Promise<GraphData> {
    return this.graphExtractor.extractFromText(text);
  }

  async importText(
    text: string,
    userId: string,
    sourceId?: string,
  ): Promise<GraphImportResult> {
    this.assertEnabled();
    const activeSourceId = sourceId ?? randomUUID();
    const graph = await this.extract(text);
    await this.writeGraph(graph, userId, activeSourceId);
    return {
      sourceId: activeSourceId,
      nodeCount: graph.nodes.length,
      relationshipCount: graph.relationships.length,
      graph,
    };
  }

  async queryGraph(query: string, userId: string): Promise<GraphQueryResult> {
    this.assertEnabled();
    const entities = await this.extractQueryEntities(query);
    const facts = await this.searchFacts(entities, userId);
    const answer = await this.generateGraphAnswer(query, facts);

    return {
      answer,
      entities,
      facts,
      cypher: this.factSearchCypher(),
    };
  }

  async getSchema(userId: string): Promise<GraphSchemaSummary> {
    if (!this.isEnabled()) {
      return {
        enabled: false,
        nodeCount: 0,
        relationshipCount: 0,
        labels: [],
        relationshipTypes: [],
      };
    }

    const [summary] = await this.neo4jProvider.executeRead<{
      nodeCount: number;
      relationshipCount: number;
      labels: string[];
      relationshipTypes: string[];
    }>(
      `
      MATCH (n:GraphEntity {userId: $userId})
      OPTIONAL MATCH (n)-[r:GRAPH_RELATION {userId: $userId}]->(:GraphEntity {userId: $userId})
      RETURN
        count(DISTINCT n) AS nodeCount,
        count(DISTINCT r) AS relationshipCount,
        collect(DISTINCT n.label) AS labels,
        collect(DISTINCT r.type) AS relationshipTypes
      `,
      { userId },
    );

    return {
      enabled: true,
      nodeCount: Number(summary?.nodeCount ?? 0),
      relationshipCount: Number(summary?.relationshipCount ?? 0),
      labels: (summary?.labels ?? []).filter(Boolean),
      relationshipTypes: (summary?.relationshipTypes ?? []).filter(Boolean),
    };
  }

  private async writeGraph(
    graph: GraphData,
    userId: string,
    sourceId: string,
  ): Promise<void> {
    const nodes = graph.nodes.map((node) =>
      this.toStoredNode(node, userId, sourceId),
    );
    const relationships = graph.relationships.map((relationship) =>
      this.toStoredRelationship(relationship, userId, sourceId),
    );

    await this.neo4jProvider.executeWrite(
      `
      UNWIND $nodes AS node
      MERGE (n:GraphEntity {id: node.id, userId: node.userId})
      SET n.label = node.label,
          n.sourceId = node.sourceId,
          n.properties = node.properties,
          n.updatedAt = datetime()
      `,
      { nodes },
    );

    if (relationships.length === 0) {
      return;
    }

    await this.neo4jProvider.executeWrite(
      `
      UNWIND $relationships AS rel
      MATCH (source:GraphEntity {id: rel.source, userId: rel.userId})
      MATCH (target:GraphEntity {id: rel.target, userId: rel.userId})
      MERGE (source)-[r:GRAPH_RELATION {
        userId: rel.userId,
        source: rel.source,
        target: rel.target,
        type: rel.type
      }]->(target)
      SET r.sourceId = rel.sourceId,
          r.properties = rel.properties,
          r.updatedAt = datetime()
      `,
      { relationships },
    );

    this.logger.log(
      `Imported graph source=${sourceId}, nodes=${nodes.length}, relationships=${relationships.length}`,
    );
  }

  private toStoredNode(
    node: GraphNode,
    userId: string,
    sourceId: string,
  ): Record<string, unknown> {
    return {
      id: node.id,
      label: node.label,
      properties: JSON.stringify(node.properties ?? {}),
      userId,
      sourceId,
    };
  }

  private toStoredRelationship(
    relationship: GraphRelationship,
    userId: string,
    sourceId: string,
  ): Record<string, unknown> {
    return {
      source: relationship.source,
      target: relationship.target,
      type: relationship.type,
      properties: JSON.stringify(relationship.properties ?? {}),
      userId,
      sourceId,
    };
  }

  private async extractQueryEntities(query: string): Promise<string[]> {
    const schema = z.object({
      entities: z
        .array(z.string())
        .max(8)
        .describe('用户问题中需要查询知识图谱的实体名称或关键词'),
    });

    try {
      const structured = this.llmProvider
        .getModel()
        .withStructuredOutput(schema);
      const result = await structured.invoke(
        `从问题中提取适合查询知识图谱的实体名称或关键词，只返回结构化字段 entities。\n问题：${query}`,
      );
      return result.entities.map((item) => item.trim()).filter(Boolean);
    } catch (err) {
      this.logger.warn(
        `Graph query entity extraction failed: ${(err as Error).message}`,
      );
      return query
        .split(/[\s,，。；;:：!?！？、]+/)
        .map((item) => item.trim())
        .filter((item) => item.length > 1)
        .slice(0, 8);
    }
  }

  private async searchFacts(
    entities: string[],
    userId: string,
  ): Promise<GraphFact[]> {
    if (entities.length === 0) {
      return [];
    }

    const rows = await this.neo4jProvider.executeRead<GraphFact>(
      this.factSearchCypher(),
      { entities, userId },
    );
    return rows;
  }

  private factSearchCypher(): string {
    return `
      MATCH (source:GraphEntity {userId: $userId})-[r:GRAPH_RELATION {userId: $userId}]->(target:GraphEntity {userId: $userId})
      WHERE source.id IN $entities
         OR target.id IN $entities
         OR source.label IN $entities
         OR target.label IN $entities
      RETURN
        source.id AS source,
        source.label AS sourceLabel,
        r.type AS relationship,
        target.id AS target,
        target.label AS targetLabel
      LIMIT 50
    `;
  }

  private async generateGraphAnswer(
    query: string,
    facts: GraphFact[],
  ): Promise<string> {
    if (facts.length === 0) {
      return '知识图谱中没有找到可回答该问题的关系事实。';
    }

    const context = facts
      .map(
        (fact, index) =>
          `[事实 ${index + 1}] ${fact.source}(${fact.sourceLabel}) -[${fact.relationship}]-> ${fact.target}(${fact.targetLabel})`,
      )
      .join('\n');

    return this.llmProvider.invoke([
      {
        role: 'system',
        content:
          '你是 GraphRAG 回答器。只能基于给定图谱事实回答，缺失信息要明确说明。',
      },
      {
        role: 'user',
        content: `用户问题：${query}\n\n图谱事实：\n${context}`,
      },
    ]);
  }

  private assertEnabled(): void {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException(
        'GraphRAG is disabled or Neo4j is unavailable',
      );
    }
  }
}
