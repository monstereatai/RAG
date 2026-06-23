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
