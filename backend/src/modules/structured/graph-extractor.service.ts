import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LlmProvider } from '../../providers/llm/llm.provider';

export interface GraphNode {
  id: string;
  label: string;
  properties: Record<string, unknown>;
}

export interface GraphRelationship {
  source: string;
  target: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface GraphData {
  nodes: GraphNode[];
  relationships: GraphRelationship[];
}

type ParsedGraphNode = {
  id: string;
  label: string;
  properties?: ParsedProperty[];
};

type ParsedGraphRelationship = {
  source: string;
  target: string;
  type: string;
  properties?: ParsedProperty[];
};

type ParsedProperty = {
  key: string;
  value: string;
};

@Injectable()
export class GraphExtractorService {
  private readonly logger = new Logger(GraphExtractorService.name);

  private readonly propertySchema = z.object({
    key: z.string().describe('属性名'),
    value: z.string().describe('属性值，统一转成字符串'),
  });

  private readonly graphSchema = z
    .object({
      nodes: z
        .array(
          z.object({
            id: z
              .string()
              .min(1)
              .describe('唯一标识符，应尽量简短并唯一标识该实体'),
            label: z
              .string()
              .min(1)
              .describe('实体类型，如 Person, Company, Concept, Location'),
            properties: z
              .array(this.propertySchema)
              .default([])
              .describe('实体的附加属性键值对数组'),
          }),
        )
        .max(50)
        .describe('提取出的实体节点列表'),
      relationships: z
        .array(
          z.object({
            source: z.string().min(1).describe('关系起点的节点 id'),
            target: z.string().min(1).describe('关系终点的节点 id'),
            type: z
              .string()
              .min(1)
              .describe('关系类型，使用大写蛇形命名，如 FOUNDED'),
            properties: z
              .array(this.propertySchema)
              .default([])
              .describe('关系的附加属性键值对数组'),
          }),
        )
        .max(80)
        .describe('提取出的实体之间的关系列表'),
    })
    .describe('包含实体节点和关系的图谱数据');

  constructor(private readonly llmProvider: LlmProvider) {}

  /**
   * 从非结构化文本中提取图数据 (Nodes & Relationships)
   */
  async extractFromText(text: string): Promise<GraphData> {
    const model = this.llmProvider.getModel();
    try {
      const structuredLlm = model.withStructuredOutput(this.graphSchema);

      const prompt = `请从以下文本中提取实体和实体之间的关系，用于构建知识图谱。

文本内容：
${text.slice(0, 12000)}

要求：
1. 节点 id 保持前后一致，优先使用实体原名。
2. label 使用简短英文类型，例如 Person、Company、Product、Concept、Location。
3. relationship.type 使用大写蛇形命名，例如 FOUNDED、WORKS_AT、DEPENDS_ON。
4. 只提取文本直接支持的事实，不要编造。`;

      const result = await structuredLlm.invoke(prompt);

      return {
        nodes: this.dedupeNodes(result.nodes),
        relationships: this.filterRelationships(
          result.relationships,
          result.nodes,
        ),
      };
    } catch (error) {
      this.logger.error(
        `Failed to extract graph data: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  private dedupeNodes(nodes: ParsedGraphNode[]): GraphNode[] {
    const seen = new Map<string, GraphNode>();
    for (const node of nodes) {
      const id = node.id.trim();
      if (!id || seen.has(id)) continue;
      seen.set(id, {
        id,
        label: node.label.trim() || 'Concept',
        properties: this.propertiesArrayToObject(node.properties),
      });
    }
    return Array.from(seen.values());
  }

  private filterRelationships(
    relationships: ParsedGraphRelationship[],
    nodes: ParsedGraphNode[],
  ): GraphRelationship[] {
    const nodeIds = new Set(nodes.map((node) => node.id));
    const seen = new Set<string>();
    const out: GraphRelationship[] = [];

    for (const relationship of relationships) {
      const source = relationship.source.trim();
      const target = relationship.target.trim();
      const type = relationship.type.trim().toUpperCase();
      const key = `${source}|${type}|${target}`;
      if (
        !source ||
        !target ||
        !type ||
        !nodeIds.has(source) ||
        !nodeIds.has(target) ||
        seen.has(key)
      ) {
        continue;
      }
      seen.add(key);
      out.push({
        source,
        target,
        type,
        properties: this.propertiesArrayToObject(relationship.properties),
      });
    }

    return out;
  }

  private propertiesArrayToObject(
    properties: ParsedProperty[] | undefined,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const property of properties ?? []) {
      const key = property.key.trim();
      if (!key) continue;
      out[key] = property.value;
    }
    return out;
  }
}
