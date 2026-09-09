import { authRequest } from '@/services/rag-admin/api';

export interface SearchRecord {
  id: string;
  query: string;
  mode: string;
  hitCount: number;
  responseTime: number;
  userId: string;
  createdAt: string;
}

export interface PopularQuery {
  query: string;
  count: number;
  /** 平均命中数（当前查询日志聚合暂未提供，预留字段） */
  avgHitCount?: number;
  /** 平均响应耗时（ms），来自 query_logs 聚合 */
  avgLatencyMs?: number;
}

export type UpdatedRange = 'day' | 'week' | 'month';

/** 文档全文检索高级筛选（仅对「文档全文检索」tab 生效） */
export interface SearchFilters {
  fileType?: string;
  updatedRange?: UpdatedRange;
  documentType?: string;
  role?: string;
}

export interface SearchFacets {
  documentTypes: string[];
  roles: string[];
}

export interface FullTextResult {
  docId: string;
  filename: string;
  title?: string | null;
  summary?: string | null;
  score: number;
  highlightFragments: string[];
  docVersion?: string | null;
  lifecycleStatus?: string;
  sourceAuthority?: string;
}

export interface GraphSearchResult {
  nodes: Array<{ id: string; label: string; type: string; sourceId?: string; confidence?: number }>;
  edges: Array<{ source: string; target: string; label: string; sourceLabel?: string; targetLabel?: string; confidence?: number }>;
}

export async function searchDocuments(query: string, limit = 20, filters?: SearchFilters) {
  const params: Record<string, unknown> = { q: query, limit };
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (value !== undefined && value !== '') params[key] = value;
  }
  return authRequest<{ data: FullTextResult[] }>('/api/admin/search-ops/documents', {
    params,
  });
}

export async function getSearchFacets() {
  return authRequest<SearchFacets>('/api/admin/search-ops/documents/facets');
}

export async function reindexSearchDocuments(limit = 1000) {
  return authRequest<{ data: { indexed: number; skipped: number; total: number } }>(
    '/api/admin/search-ops/documents/reindex',
    { method: 'POST', params: { limit } },
  );
}

export async function searchGraph(query: string, limit = 100) {
  return authRequest<{ data: { data?: GraphSearchResult; nodes?: GraphSearchResult['nodes']; edges?: GraphSearchResult['edges'] } }>(
    '/api/admin/search-ops/graph',
    { params: { query, limit } },
  );
}

export async function getSearchRecords(params?: {
  current?: number;
  pageSize?: number;
  query?: string;
  mode?: string;
}) {
  return authRequest<{ data: SearchRecord[]; total: number }>(
    '/api/admin/search-ops/records',
    { params },
  );
}

export async function getPopularQueries(params?: { limit?: number }) {
  return authRequest<{ data: PopularQuery[] }>(
    '/api/admin/search-ops/popular',
    { params },
  );
}

export async function getSearchStats() {
  return authRequest<{
    data: {
      totalSearches: number;
      avgResponseTime: number;
      avgHitCount: number;
      zeroHitRate: number;
    };
  }>('/api/admin/search-ops/stats');
}

export interface RetrievalCandidate {
  id: string;
  docId: string;
  chunkIndex: number;
  score: number;
  rerankScore?: number;
  retrievalSource?: string;
}

export interface RetrievalEvidenceResult {
  query: string;
  vectorSource?: string;
  rerankApplied?: boolean;
  profile?: { intent?: string; finalTopK?: number };
  diagnostics?: { contextCharacters?: number; stages?: Record<string, number> };
  candidates: Record<string, RetrievalCandidate[]>;
}

export async function inspectRetrieval(query: string, limit = 50) {
  return authRequest<RetrievalEvidenceResult>('/api/admin/search-ops/evidence', {
    params: { q: query, limit },
  });
}
