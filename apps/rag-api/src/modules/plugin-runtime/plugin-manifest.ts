import { toolRegistry } from '../../tools/tool-registry';

export type PluginMode = 'simple' | 'auto' | 'agentic' | 'production';
export type PluginType =
  | 'model'
  | 'tool'
  | 'mcp'
  | 'datasource'
  | 'agent_strategy'
  | 'trigger';

export interface PluginManifest {
  key: string;
  version: string;
  displayName: string;
  description: string;
  type: PluginType;
  capabilities: string[];
  permissions: string[];
  tools: string[];
  modes: PluginMode[];
  requires?: string[];
  conflicts?: string[];
  status: 'enabled' | 'disabled' | 'degraded';
  builtin?: boolean;
}

export const BUILTIN_PLUGIN_MANIFESTS: PluginManifest[] = [
  {
    key: 'workflow.production-base',
    version: '1.0.0',
    displayName: '产研运基础能力包',
    description:
      '为产品、设计、前端、后端、测试、运营岗位提供知识检索与交付物写入能力。',
    type: 'agent_strategy',
    capabilities: ['role-retrieval', 'artifact-delivery'],
    permissions: ['knowledge.read', 'artifact.write'],
    tools: [
      'product_knowledge_search',
      'design_guideline_search',
      'frontend_engineering_search',
      'backend_contract_search',
      'qa_regression_search',
      'operations_playbook_search',
      'artifact_generate',
    ],
    modes: ['production'],
    status: 'enabled',
    builtin: true,
  },
  {
    key: 'rag.hybrid-evidence',
    version: '1.0.0',
    displayName: '混合检索证据包',
    description:
      '启用关键词、向量、重排和图谱证据工具，适用于需要引用支撑的复杂问答。',
    type: 'tool',
    capabilities: ['hybrid-search', 'rerank', 'graph-evidence'],
    permissions: ['knowledge.read'],
    tools: ['dashscope_rerank', 'graph_search_tool'],
    modes: ['auto', 'agentic'],
    status: 'enabled',
    builtin: true,
  },
  {
    key: 'rag.simple-rerank',
    version: '1.0.0',
    displayName: 'Simple 重排能力包',
    description:
      '为 Simple 链路启用已注册的重排能力，保持快速路径不引入 Agent 工具。',
    type: 'tool',
    capabilities: ['rerank'],
    permissions: ['knowledge.read'],
    tools: ['dashscope_rerank'],
    modes: ['simple'],
    status: 'enabled',
    builtin: true,
  },
  {
    key: 'rag.web-research',
    version: '1.0.0',
    displayName: '联网研究能力包',
    description:
      '允许 Simple／Auto／Agentic 链路在本地证据不足时查询公开网络资料。',
    type: 'tool',
    capabilities: ['web-search'],
    permissions: ['network.outbound'],
    tools: ['bocha_web_search'],
    modes: ['simple', 'auto', 'agentic'],
    status: 'enabled',
    builtin: true,
  },
  {
    key: 'coding.mcp-context',
    version: '1.0.0',
    displayName: 'MCP 编码上下文包',
    description: '向编码协作链路提供受权限约束的 RAG 与图谱上下文。',
    type: 'mcp',
    capabilities: ['rag-context', 'coding-context'],
    permissions: ['knowledge.read'],
    tools: ['mcp_tools'],
    modes: ['auto', 'agentic', 'production'],
    status: 'enabled',
    builtin: true,
  },
  {
    key: 'workflow.readonly-review',
    version: '1.0.0',
    displayName: '只读审查能力包',
    description:
      '仅允许岗位检索，不允许写入 Artifact，适用于方案预审和风险核查。',
    type: 'agent_strategy',
    capabilities: ['role-retrieval', 'review-only'],
    permissions: ['knowledge.read'],
    tools: [
      'product_knowledge_search',
      'design_guideline_search',
      'frontend_engineering_search',
      'backend_contract_search',
      'qa_regression_search',
      'operations_playbook_search',
    ],
    modes: ['production'],
    status: 'enabled',
    builtin: true,
  },
];

export const isKnownTool = (name: string) =>
  toolRegistry.some((tool) => tool.name === name);
export const isToolAllowedInMode = (name: string, mode: PluginMode) =>
  toolRegistry.find((tool) => tool.name === name)?.modes.includes(mode) ??
  false;
