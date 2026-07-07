export interface ToolRegistryEntry {
  name: string;
  source: 'builtin' | 'mcp' | 'external';
  risk: 'low' | 'medium' | 'high';
  permission: 'read' | 'write' | 'external_read';
  timeoutMs: number;
  audit: boolean;
  fallback: string;
  owner: string;
}

export const toolRegistry: ToolRegistryEntry[] = [
  {
    name: 'bocha_web_search',
    source: 'external',
    risk: 'medium',
    permission: 'external_read',
    timeoutMs: 10000,
    audit: true,
    fallback: '跳过联网搜索，继续使用本地 RAG / BM25 / ES 证据。',
    owner: 'rag-backend',
  },
  {
    name: 'dashscope_rerank',
    source: 'external',
    risk: 'low',
    permission: 'read',
    timeoutMs: 10000,
    audit: true,
    fallback: '使用融合排序结果，不阻断主问答链路。',
    owner: 'rag-backend',
  },
  {
    name: 'graph_search_tool',
    source: 'builtin',
    risk: 'low',
    permission: 'read',
    timeoutMs: 5000,
    audit: true,
    fallback: '图谱不可用时回退到 RAG 文档证据。',
    owner: 'rag-backend',
  },
  {
    name: 'mcp_tools',
    source: 'mcp',
    risk: 'medium',
    permission: 'read',
    timeoutMs: 10000,
    audit: true,
    fallback: 'MCP server 未启用或失败时禁用对应工具，不影响核心 RAG。',
    owner: 'rag-backend',
  }
];

