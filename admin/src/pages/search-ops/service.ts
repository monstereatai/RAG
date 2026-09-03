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
  avgHitCount: number;
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

export async function searchDocuments(query: string, limit = 20) {
  return authRequest<{ data: FullTextResult[] }>('/api/admin/search-ops/documents', {
    params: { q: query, limit },
  });
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
