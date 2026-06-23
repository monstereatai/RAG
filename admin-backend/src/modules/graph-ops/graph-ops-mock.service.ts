import { Injectable } from '@nestjs/common';

/**
 * Mock 图谱数据，用于上游 Neo4j 无数据时展示 UI 效果
 * 生产环境接入真实图谱后可删除
 */

const MOCK_ENTITIES = [
  { id: 'e1', name: 'LangChain', type: 'Framework', properties: { language: 'Python/JS', category: 'LLM框架' } },
  { id: 'e2', name: 'NestJS', type: 'Framework', properties: { language: 'TypeScript', category: '后端框架' } },
  { id: 'e3', name: 'Milvus', type: 'Database', properties: { type: '向量数据库', category: '存储' } },
  { id: 'e4', name: 'PostgreSQL', type: 'Database', properties: { type: '关系型数据库', category: '存储' } },
  { id: 'e5', name: 'Redis', type: 'Database', properties: { type: '缓存', category: '存储' } },
  { id: 'e6', name: 'Elasticsearch', type: 'Database', properties: { type: '搜索引擎', category: '存储' } },
  { id: 'e7', name: '通义千问', type: 'LLM', properties: { provider: '阿里云', model: 'qwen-plus' } },
  { id: 'e8', name: 'OpenAI', type: 'LLM', properties: { provider: 'OpenAI', model: 'gpt-4' } },
  { id: 'e9', name: 'React', type: 'Framework', properties: { language: 'TypeScript', category: '前端框架' } },
  { id: 'e10', name: 'Docker', type: 'Infrastructure', properties: { category: '容器化' } },
  { id: 'e11', name: 'Neo4j', type: 'Database', properties: { type: '图数据库', category: '存储' } },
  { id: 'e12', name: 'RAG', type: 'Concept', properties: { fullName: '检索增强生成', category: '架构模式' } },
  { id: 'e13', name: 'Agentic RAG', type: 'Concept', properties: { category: '架构模式', description: '智能体驱动的RAG' } },
  { id: 'e14', name: 'Mem0', type: 'Service', properties: { category: '长期记忆', description: '对话记忆管理' } },
  { id: 'e15', name: 'DashScope', type: 'Service', properties: { category: 'AI服务', description: '阿里云AI平台' } },
];

const MOCK_RELATIONSHIPS = [
  { id: 'r1', source: 'e1', target: 'e3', type: '使用', label: '使用' },
  { id: 'r2', source: 'e1', target: 'e7', type: '调用', label: '调用' },
  { id: 'r3', source: 'e1', target: 'e8', type: '调用', label: '调用' },
  { id: 'r4', source: 'e2', target: 'e4', type: '使用', label: '使用' },
  { id: 'r5', source: 'e2', target: 'e5', type: '使用', label: '使用' },
  { id: 'r6', source: 'e12', target: 'e3', type: '依赖', label: '依赖' },
  { id: 'r7', source: 'e12', target: 'e6', type: '依赖', label: '依赖' },
  { id: 'r8', source: 'e12', target: 'e7', type: '调用', label: '调用' },
  { id: 'r9', source: 'e13', target: 'e12', type: '扩展', label: '扩展' },
  { id: 'r10', source: 'e13', target: 'e1', type: '使用', label: '使用' },
  { id: 'r11', source: 'e9', target: 'e2', type: '对接', label: '对接' },
  { id: 'r12', source: 'e2', target: 'e1', type: '集成', label: '集成' },
  { id: 'r13', source: 'e14', target: 'e5', type: '使用', label: '使用' },
  { id: 'r14', source: 'e15', target: 'e7', type: '提供', label: '提供' },
  { id: 'r15', source: 'e2', target: 'e10', type: '部署', label: '部署' },
  { id: 'r16', source: 'e11', target: 'e13', type: '支撑', label: '支撑' },
  { id: 'r17', source: 'e6', target: 'e12', type: '支撑', label: '支撑' },
];

const ENTITY_TYPES = [
  { type: 'Framework', count: 3 },
  { type: 'Database', count: 5 },
  { type: 'LLM', count: 2 },
  { type: 'Concept', count: 2 },
  { type: 'Service', count: 2 },
  { type: 'Infrastructure', count: 1 },
];

const RELATION_TYPES = [
  { type: '使用', count: 5 },
  { type: '调用', count: 3 },
  { type: '依赖', count: 2 },
  { type: '扩展', count: 1 },
  { type: '对接', count: 1 },
  { type: '集成', count: 1 },
  { type: '部署', count: 1 },
  { type: '支撑', count: 2 },
  { type: '提供', count: 1 },
];

@Injectable()
export class GraphOpsMockService {
  getStats() {
    return {
      nodeCount: MOCK_ENTITIES.length,
      edgeCount: MOCK_RELATIONSHIPS.length,
      entityTypes: ENTITY_TYPES,
      relationTypes: RELATION_TYPES,
    };
  }

  getNodes() {
    return MOCK_ENTITIES.map((e) => ({
      id: e.id,
      label: e.name,
      type: e.type,
      properties: e.properties,
    }));
  }

  getSchema() {
    return {
      nodeLabels: [...new Set(MOCK_ENTITIES.map((e) => e.type))],
      edgeTypes: [...new Set(MOCK_RELATIONSHIPS.map((r) => r.type))],
      properties: {},
    };
  }

  search(query: string) {
    const q = (query || '').toLowerCase();
    let matchedNodes = MOCK_ENTITIES.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q) ||
        Object.values(e.properties).some((v) => String(v).toLowerCase().includes(q)),
    );
    // 搜索无结果时返回全部数据，用于页面初始化展示
    if (matchedNodes.length === 0) {
      matchedNodes = MOCK_ENTITIES;
    }
    const matchedIds = new Set(matchedNodes.map((n) => n.id));
    const matchedEdges = MOCK_RELATIONSHIPS.filter(
      (r) => matchedIds.has(r.source) || matchedIds.has(r.target),
    );
    return {
      nodes: matchedNodes.map((e) => ({
        id: e.id,
        label: e.name,
        type: e.type,
        properties: e.properties,
      })),
      edges: matchedEdges.map((r) => ({
        id: r.id,
        source: r.source,
        target: r.target,
        label: r.type,
      })),
    };
  }
}
