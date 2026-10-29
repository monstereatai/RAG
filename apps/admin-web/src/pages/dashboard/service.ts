import { authRequest } from '@/services/rag-admin/api';

export interface DashboardStats {
  documentCount: number;
  qaCount: number;
  searchCount: number;
  userCount: number;
  todaySearchCount: number;
  todayQaCount: number;
  avgResponseTime: number;
  hitRate: number;
}

export interface TrendItem {
  date: string;
  searchCount: number;
  qaCount: number;
  documentCount: number;
}

export async function getDashboardStats() {
  return authRequest<{ data: DashboardStats }>('/api/admin/dashboard/overview');
}

export async function getTrendData(params?: { days?: number }) {
  return authRequest<{ data: TrendItem[] }>('/api/admin/dashboard/trend', {
    params,
  });
}

/** 首页大盘二级菜单使用的现有后台数据源。 */
export async function getDashboardDocuments() {
  return authRequest<{ data: unknown[]; total: number }>(
    '/api/admin/documents',
    {
      params: { current: 1, pageSize: 100 },
    },
  );
}

export async function getDashboardUsers() {
  return authRequest<{ data: unknown[]; total: number }>('/api/admin/users', {
    params: { current: 1, pageSize: 100 },
  });
}

export async function getDashboardPopularQueries() {
  return authRequest<{ data: unknown[] }>('/api/admin/search-ops/popular');
}

export async function getDashboardNotices() {
  return authRequest<{ data: unknown[]; total: number; unread: number }>(
    '/api/admin/notifications',
    {
      params: { current: 1, pageSize: 20 },
    },
  );
}
