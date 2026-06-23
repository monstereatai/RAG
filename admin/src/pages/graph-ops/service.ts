import { authRequest } from '@/services/rag-admin/api';

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  properties?: Record<string, any>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  entityTypes: { type: string; count: number }[];
  relationTypes: { type: string; count: number }[];
}

export async function getGraphStats() {
  return authRequest<{ data: GraphStats }>('/api/admin/graph-ops/stats');
}

export async function getGraphSchema() {
  return authRequest<{
    data: {
      nodeLabels: string[];
      edgeTypes: string[];
      properties: Record<string, string[]>;
    };
  }>('/api/admin/graph-ops/schema');
}

export async function getGraphNodes(params?: {
  type?: string;
  keyword?: string;
  limit?: number;
}) {
  return authRequest<{ data: GraphNode[] }>('/api/admin/graph-ops/nodes', {
    params,
  });
}

export async function searchGraph(query: string) {
  return authRequest<{ data: { nodes: GraphNode[]; edges: GraphEdge[] } }>(
    '/api/admin/graph-ops/search',
    { params: { query } },
  );
}
