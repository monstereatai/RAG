import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LlmProvider } from '../../providers/llm/llm.provider';

export interface GraphNode {
  id: string;
  label: string;
  properties: Record<string, any>;
}

export interface GraphRelationship {
  source: string;
  target: string;
  type: string;
  properties: Record<string, any>;
}

export interface GraphData {
  nodes: GraphNode[];
  relationships: GraphRelationship[];
}

@Injectable()
export class GraphExtractorService {
  private readonly logger = new Logger(GraphExtractorService.name);

  // Zod Schema for graph extraction
  private readonly graphSchema = z.object({
    nodes: z.array(
      z.object({
        id: z.string().describe('唯一标识符，应尽量简短并唯一标识该实体（如人名、公司名等）'),
        label: z.string().describe('实体的类型，如 Person, Company, Concept, Location 等'),
        properties: z.record(z.string(), z.any()).describe('实体的附加属性键值对'),
      })
    ).describe('提取出的实体节点列表'),
    relationships: z.array(
      z.object({
        source: z.string().describe('关系起点的节点 id'),
        target: z.string().describe('关系终点的节点 id'),
        type: z.string().describe('关系类型，应使用大写蛇形命名，如 FOUNDED, WORKS_AT, LOCATED_IN'),
        properties: z.record(z.string(), z.any()).describe('关系的附加属性键值对'),
      })
    ).describe('提取出的实体之间的关系列表'),
  }).describe('包含实体节点和关系的图谱数据');

  constructor(private readonly llmProvider: LlmProvider) {}

  /**
   * 从非结构化文本中提取图数据 (Nodes & Relationships)
   */
  async extractFromText(text: string): Promise<GraphData> {
    const model = this.llmProvider.getModel();
    try {
      const structuredLlm = model.withStructuredOutput(this.graphSchema);
      
      const prompt = `请从以下文本中提取出实体和实体之间的关系，以便构建知识图谱。\n\n文本内容：\n${text}\n\n注意：\n1. 节点 ID 请保持前后一致。\n2. 提取最核心、最清晰的实体和关系。`;
      
      const result = await structuredLlm.invoke(prompt);
      
      return {
        nodes: result.nodes,
        relationships: result.relationships,
      };
    } catch (error) {
      this.logger.error(`Failed to extract graph data: ${(error as Error).message}`);
      throw error;
    }
  }
}
