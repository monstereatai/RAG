import { authRequest } from '@/services/rag-admin/api';

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  aliases?: string[];
  sourceId?: string;
  relationshipCount?: number;
  confidence?: number;
  updatedAt?: string;
  properties?: Record<string, any>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  sourceLabel?: string;
  targetLabel?: string;
  confidence?: number;
  sourceId?: string;
  updatedAt?: string;
  properties?: Record<string, any>;
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  entityTypes: { type: string; count: number }[];
  relationTypes: { type: string; count: number }[];
  orphanCount?: number;
  conflictCount?: number;
  recentUpdatedAt?: string;
  popularNodes?: GraphNode[];
  orphanNodes?: GraphNode[];
  conflictRelationships?: GraphEdge[];
}

export interface GraphResponseMeta {
  available?: boolean;
  source?: 'rag-backend' | 'mock' | 'admin-backend';
  demo?: boolean;
  message?: string;
}

export interface GraphListResponse<T> {
  data: T[];
  total?: number;
  meta?: GraphResponseMeta;
}

export interface GraphDataResponse<T> {
  data: T;
  meta?: GraphResponseMeta;
}

export async function getGraphStats() {
  return authRequest<GraphDataResponse<GraphStats>>('/api/admin/graph-ops/stats');
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
  category?: string;
  orphan?: boolean;
  page?: number;
  pageSize?: number;
  limit?: number;
}) {
  return authRequest<GraphListResponse<GraphNode>>('/api/admin/graph-ops/nodes', {
    params,
  });
}

export async function getGraphNodeDetail(id: string) {
  return authRequest<GraphDataResponse<GraphNode & { relations?: GraphEdge[] }>>(
    `/api/admin/graph-ops/nodes/${encodeURIComponent(id)}`,
  );
}

export async function getGraphRelations(params?: {
  query?: string;
  source?: string;
  target?: string;
  relationType?: string;
  nodeType?: string;
  depth?: number;
  conflictOnly?: boolean;
  limit?: number;
}) {
  return authRequest<GraphListResponse<GraphEdge>>('/api/admin/graph-ops/relations', {
    params,
  });
}

export async function searchGraphRelations(params?: {
  query?: string;
  source?: string;
  target?: string;
  relationType?: string;
  nodeType?: string;
  depth?: number;
  conflictOnly?: boolean;
  limit?: number;
}) {
  return authRequest<GraphDataResponse<{ nodes: GraphNode[]; edges: GraphEdge[] }>>(
    '/api/admin/graph-ops/relations/search',
    { params },
  );
}

export async function searchGraph(query: string) {
  return authRequest<GraphDataResponse<{ nodes: GraphNode[]; edges: GraphEdge[] }>>(
    '/api/admin/graph-ops/search',
    { params: { query } },
  );
}
