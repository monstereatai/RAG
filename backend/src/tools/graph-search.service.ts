import { Injectable, Logger } from '@nestjs/common';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { Neo4jProvider } from '../providers/neo4j/neo4j.provider';

@Injectable()
export class GraphSearchService {
  private readonly logger = new Logger(GraphSearchService.name);

  constructor(private readonly neo4jProvider: Neo4jProvider) {}

  /**
   * 返回一个 LangChain Tool，供 Agent 调用
   */
  getTool(): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: 'graph_search_tool',
      description: '查询知识图谱（Neo4j）以获取实体关系。输入一个或多个实体名称，返回它们在图谱中的相关节点和关系。',
      schema: z.object({
        entities: z.array(z.string()).describe('要查询的实体名称列表，例如 ["张三", "某某公司"]'),
      }),
      func: async ({ entities }) => {
        try {
          this.logger.log(`Executing graph search for entities: ${entities.join(', ')}`);
          
          if (!entities || entities.length === 0) {
            return "未提供实体名称。";
          }

          // 构建 Cypher 查询，查询与给定实体直接相连的节点
          // 注意：此处仅为简单示例，实际可能需要更复杂的模糊匹配或多跳查询
          const query = `
            MATCH (n)-[r]-(m)
            WHERE n.id IN $entities OR n.label IN $entities
            RETURN n.id AS source, type(r) AS relationship, m.id AS target
            LIMIT 50
          `;

          const results = await this.neo4jProvider.executeRead<any>(query, { entities });

          if (results.length === 0) {
            return `在图谱中未找到与 ${entities.join(', ')} 相关的知识。`;
          }

          const formatted = results.map(
            (r) => `${r.source} -[${r.relationship}]-> ${r.target}`
          ).join('\n');

          return `图谱查询结果:\n${formatted}`;
        } catch (error) {
          this.logger.error(`Graph search failed: ${(error as Error).message}`);
          return `图谱查询失败: ${(error as Error).message}`;
        }
      },
    });
  }
}
