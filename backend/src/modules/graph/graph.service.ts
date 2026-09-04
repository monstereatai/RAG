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
  confidence: number;
  sourceId: string;
}

export interface GraphSchemaSummary {
  enabled: boolean;
  nodeCount: number;
  relationshipCount: number;
  labels: string[];
  relationshipTypes: string[];
}

export interface GraphAdminNode {
  id: string;
  label: string;
  type: string;
  aliases: string[];
  sourceId: string;
  relationshipCount: number;
  confidence: number;
  updatedAt: string;
  properties: Record<string, unknown>;
}

export interface GraphAdminRelationship {
  id: string;
  source: string;
  sourceLabel: string;
  sourceType: string;
  target: string;
  targetLabel: string;
  targetType: string;
  label: string;
  confidence: number;
  sourceId: string;
  updatedAt: string;
  properties: Record<string, unknown>;
}

export interface GraphAdminNodeUpdate {
  type?: string;
  aliases?: string[];
  sourceId?: string;
  properties?: Record<string, unknown>;
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
    await this.removeSource(activeSourceId, userId);
    await this.writeGraph(graph, userId, activeSourceId);
    return {
      sourceId: activeSourceId,
      nodeCount: graph.nodes.length,
      relationshipCount: graph.relationships.length,
      graph,
    };
  }

  /** 移除一个来源的归属；共享实体和关系继续保留其余来源。 */
  async removeSource(sourceId: string, userId: string): Promise<void> {
    if (!this.isEnabled()) return;

    await this.neo4jProvider.executeWrite(
      `
      MATCH ()-[r:GRAPH_RELATION {userId: $userId}]->()
      WHERE $sourceId IN coalesce(r.sourceIds, [coalesce(r.sourceId, '')])
      WITH r, [id IN coalesce(r.sourceIds, [coalesce(r.sourceId, '')]) WHERE id <> $sourceId] AS remaining
      WHERE size(remaining) = 0
      DELETE r
      `,
      { sourceId, userId },
    );
    await this.neo4jProvider.executeWrite(
      `
      MATCH ()-[r:GRAPH_RELATION {userId: $userId}]->()
      WHERE $sourceId IN coalesce(r.sourceIds, [coalesce(r.sourceId, '')])
      WITH r, [id IN coalesce(r.sourceIds, [coalesce(r.sourceId, '')]) WHERE id <> $sourceId] AS remaining
      SET r.sourceIds = remaining,
          r.sourceId = coalesce(head(remaining), '')
      `,
      { sourceId, userId },
    );
    await this.neo4jProvider.executeWrite(
      `
      MATCH (n:GraphEntity {userId: $userId})
      WHERE $sourceId IN coalesce(n.sourceIds, [coalesce(n.sourceId, '')])
      WITH n, [id IN coalesce(n.sourceIds, [coalesce(n.sourceId, '')]) WHERE id <> $sourceId] AS remaining
      SET n.sourceIds = remaining,
          n.sourceId = coalesce(head(remaining), '')
      `,
      { sourceId, userId },
    );
    await this.neo4jProvider.executeWrite(
      `
      MATCH (n:GraphEntity {userId: $userId})
      WHERE size(coalesce(n.sourceIds, [])) = 0
        AND NOT (n)-[:GRAPH_RELATION {userId: $userId}]-(:GraphEntity)
      DELETE n
      `,
      { userId },
    );
  }

  async queryGraph(query: string, userId: string): Promise<GraphQueryResult> {
    this.assertEnabled();
    const entities = await this.extractQueryEntities(query);
    if (!this.isGraphQueryCandidate(query, entities)) {
      return {
        answer:
          '该问题未表现出明确的实体关系或多跳查询需求，建议先走普通 RAG 主链路。',
        entities,
        facts: [],
        cypher: this.factSearchCypher(),
      };
    }
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
      nodeCount: this.toNumber(summary?.nodeCount),
      relationshipCount: this.toNumber(summary?.relationshipCount),
      labels: (summary?.labels ?? []).filter(Boolean),
      relationshipTypes: (summary?.relationshipTypes ?? []).filter(Boolean),
    };
  }

  async listEntities(
    userId: string,
    options: { keyword?: string; type?: string; limit?: number } = {},
  ): Promise<GraphAdminNode[]> {
    if (!this.isEnabled()) {
      return [];
    }

    const keyword = options.keyword?.trim();
    const rows = await this.neo4jProvider.executeRead<Record<string, unknown>>(
      `
      MATCH (n:GraphEntity)
      WHERE ($userId = '*' OR n.userId = $userId)
        AND ($type = '' OR n.label = $type)
        AND (
          $keyword = ''
          OR toLower(n.id) CONTAINS toLower($keyword)
          OR toLower(n.label) CONTAINS toLower($keyword)
          OR any(alias IN coalesce(n.aliases, []) WHERE toLower(alias) CONTAINS toLower($keyword))
          OR toLower(coalesce(n.properties, '')) CONTAINS toLower($keyword)
        )
      OPTIONAL MATCH (n)-[r:GRAPH_RELATION]-(:GraphEntity)
      WHERE ($userId = '*' OR (r.userId = $userId AND startNode(r).userId = $userId AND endNode(r).userId = $userId))
      RETURN
        n.id AS id,
        n.label AS label,
        coalesce(n.aliases, []) AS aliases,
        coalesce(n.sourceId, '') AS sourceId,
        coalesce(n.properties, '{}') AS properties,
        coalesce(toString(n.updatedAt), '') AS updatedAt,
        count(DISTINCT r) AS relationshipCount
      ORDER BY relationshipCount DESC, id ASC
      LIMIT toInteger($limit)
      `,
      {
        userId,
        keyword: keyword ?? '',
        type: options.type ?? '',
        limit: this.normalizeLimit(options.limit),
      },
    );

    return rows.map((row) => this.toAdminNode(row));
  }

  async getEntityDetail(
    userId: string,
    id: string,
  ): Promise<
    (GraphAdminNode & { relations: GraphAdminRelationship[] }) | null
  > {
    const [node] = await this.listEntities(userId, { keyword: id, limit: 1 });
    if (!node || node.id !== id) {
      return null;
    }

    const relations = await this.listRelationships(userId, {
      query: id,
      limit: 50,
    });
    return { ...node, relations };
  }

  async updateEntity(
    userId: string,
    id: string,
    input: GraphAdminNodeUpdate,
  ): Promise<(GraphAdminNode & { relations: GraphAdminRelationship[] }) | null> {
    if (!this.isEnabled()) {
      return null;
    }

    const type = input.type?.trim();
    const aliases = Array.isArray(input.aliases)
      ? input.aliases.map(String).map((item) => item.trim()).filter(Boolean)
      : [];
    const sourceId = input.sourceId?.trim() ?? '';
    const properties =
      input.properties && typeof input.properties === 'object' && !Array.isArray(input.properties)
        ? input.properties
        : {};

    const rows = await this.neo4jProvider.executeWrite<Record<string, unknown>>(
      `
      MATCH (n:GraphEntity {id: $id, userId: $userId})
      SET n.label = $type,
          n.aliases = $aliases,
          n.sourceId = $sourceId,
          n.properties = $properties,
          n.updatedAt = datetime()
      RETURN n.id AS id
      `,
      {
        userId,
        id,
        type: type || 'entity',
        aliases,
        sourceId,
        properties: JSON.stringify(properties),
      },
    );

    if (rows.length === 0) {
      return null;
    }

    return this.getEntityDetail(userId, id);
  }

  async listRelationships(
    userId: string,
    options: {
      query?: string;
      relationType?: string;
      conflictOnly?: boolean;
      limit?: number;
    } = {},
  ): Promise<GraphAdminRelationship[]> {
    if (!this.isEnabled()) {
      return [];
    }

    const query = options.query?.trim();
    const rows = await this.neo4jProvider.executeRead<Record<string, unknown>>(
      `
      MATCH (source:GraphEntity)-[r:GRAPH_RELATION]->(target:GraphEntity)
      WHERE ($userId = '*' OR (source.userId = $userId AND target.userId = $userId AND r.userId = $userId))
        AND ($relationType = '' OR r.type = $relationType)
        AND (
          $query = ''
          OR toLower(source.id) CONTAINS toLower($query)
          OR toLower(source.label) CONTAINS toLower($query)
          OR toLower(target.id) CONTAINS toLower($query)
          OR toLower(target.label) CONTAINS toLower($query)
          OR toLower(r.type) CONTAINS toLower($query)
          OR toLower(coalesce(r.properties, '')) CONTAINS toLower($query)
        )
      RETURN
        elementId(r) AS id,
        source.id AS source,
        source.label AS sourceType,
        target.id AS target,
        target.label AS targetType,
        r.type AS label,
        coalesce(r.confidence, 1.0) AS confidence,
        coalesce(r.sourceId, '') AS sourceId,
        coalesce(r.properties, '{}') AS properties,
        coalesce(toString(r.updatedAt), '') AS updatedAt
      ORDER BY updatedAt DESC, source ASC, target ASC
      LIMIT toInteger($limit)
      `,
      {
        userId,
        query: query ?? '',
        relationType: options.relationType ?? '',
        limit: this.normalizeLimit(options.limit),
      },
    );

    return rows.map((row) => this.toAdminRelationship(row));
  }

  async getOrphanEntities(
    userId: string,
    limit = 100,
  ): Promise<GraphAdminNode[]> {
    if (!this.isEnabled()) {
      return [];
    }
    const rows = await this.neo4jProvider.executeRead<Record<string, unknown>>(
      `
      MATCH (n:GraphEntity {userId: $userId})
      WHERE NOT (n)-[:GRAPH_RELATION {userId: $userId}]-(:GraphEntity {userId: $userId})
      RETURN
        n.id AS id,
        n.label AS label,
        coalesce(n.aliases, []) AS aliases,
        coalesce(n.sourceId, '') AS sourceId,
        coalesce(n.properties, '{}') AS properties,
        coalesce(toString(n.updatedAt), '') AS updatedAt,
        0 AS relationshipCount
      ORDER BY id ASC
      LIMIT toInteger($limit)
      `,
      { userId, limit: this.normalizeLimit(limit) },
    );
    return rows.map((row) => this.toAdminNode(row));
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
          n.aliases = node.aliases,
          n.sourceId = node.sourceId,
          n.sourceIds = CASE
            WHEN node.sourceId IN coalesce(n.sourceIds, [coalesce(n.sourceId, '')])
              THEN coalesce(n.sourceIds, [coalesce(n.sourceId, '')])
            ELSE coalesce(n.sourceIds, [coalesce(n.sourceId, '')]) + node.sourceId
          END,
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
          r.sourceIds = CASE
            WHEN rel.sourceId IN coalesce(r.sourceIds, [coalesce(r.sourceId, '')])
              THEN coalesce(r.sourceIds, [coalesce(r.sourceId, '')])
            ELSE coalesce(r.sourceIds, [coalesce(r.sourceId, '')]) + rel.sourceId
          END,
          r.properties = rel.properties,
          r.confidence = rel.confidence,
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
      aliases: this.extractAliases(node),
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
      confidence: this.extractConfidence(relationship),
      userId,
      sourceId,
    };
  }

  private extractAliases(node: GraphNode): string[] {
    const raw = node.properties?.aliases ?? node.properties?.alias;
    if (Array.isArray(raw)) {
      return raw
        .map(String)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (typeof raw === 'string') {
      return raw
        .split(/[,，、/]/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  }

  private extractConfidence(relationship: GraphRelationship): number {
    const raw =
      relationship.properties?.confidence ??
      relationship.properties?.置信度 ??
      relationship.properties?.score;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return 1;
    }
    return Math.min(Math.max(parsed, 0), 1);
  }

  private toAdminNode(row: Record<string, unknown>): GraphAdminNode {
    return {
      id: this.toText(row.id),
      label: this.toText(row.id),
      type: this.toText(row.label, 'entity'),
      aliases: Array.isArray(row.aliases)
        ? row.aliases.map((item) => this.toText(item)).filter(Boolean)
        : [],
      sourceId: this.toText(row.sourceId),
      relationshipCount: this.toNumber(row.relationshipCount),
      confidence: 1,
      updatedAt: this.toText(row.updatedAt),
      properties: this.parseProperties(row.properties),
    };
  }

  private toAdminRelationship(
    row: Record<string, unknown>,
  ): GraphAdminRelationship {
    const source = this.toText(row.source);
    const target = this.toText(row.target);
    const label = this.toText(row.label, 'REL');
    return {
      id: this.toText(row.id, `${source}-${label}-${target}`),
      source,
      sourceLabel: source,
      sourceType: this.toText(row.sourceType, 'entity'),
      target,
      targetLabel: target,
      targetType: this.toText(row.targetType, 'entity'),
      label,
      confidence: this.toNumber(row.confidence, 1),
      sourceId: this.toText(row.sourceId),
      updatedAt: this.toText(row.updatedAt),
      properties: this.parseProperties(row.properties),
    };
  }

  private parseProperties(value: unknown): Record<string, unknown> {
    if (!value) {
      return {};
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    if (typeof value !== 'string') {
      return {};
    }
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private toNumber(value: unknown, fallback = 0): number {
    if (typeof value === 'number') {
      return value;
    }
    if (value && typeof value === 'object' && 'toNumber' in value) {
      return Number((value as { toNumber: () => number }).toNumber());
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private toText(value: unknown, fallback = ''): string {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return fallback;
  }

  private normalizeLimit(value: unknown): number {
    const parsed = Number(value ?? 100);
    if (!Number.isFinite(parsed)) {
      return 100;
    }
    return Math.min(Math.max(Math.trunc(parsed), 1), 500);
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

  private isGraphQueryCandidate(query: string, entities: string[]): boolean {
    const normalized = query.normalize('NFKC').toLowerCase();
    const relationPattern =
      /关系|关联|上下游|依赖|负责|属于|连接|影响|链路|谁|哪些|共同|之间|relation|depend|owner|link|between/;
    return entities.length >= 2 || relationPattern.test(normalized);
  }

  private factSearchCypher(): string {
    return `
      MATCH (source:GraphEntity {userId: $userId})-[r:GRAPH_RELATION {userId: $userId}]->(target:GraphEntity {userId: $userId})
      WHERE source.id IN $entities
         OR target.id IN $entities
         OR source.label IN $entities
         OR target.label IN $entities
         OR any(alias IN coalesce(source.aliases, []) WHERE alias IN $entities)
         OR any(alias IN coalesce(target.aliases, []) WHERE alias IN $entities)
      RETURN
        source.id AS source,
        source.label AS sourceLabel,
        r.type AS relationship,
        target.id AS target,
        target.label AS targetLabel,
        coalesce(r.confidence, 1.0) AS confidence,
        coalesce(r.sourceId, '') AS sourceId
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
          `[事实 ${index + 1}] ${fact.source}(${fact.sourceLabel}) -[${fact.relationship}, confidence=${fact.confidence}]-> ${fact.target}(${fact.targetLabel})`,
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
