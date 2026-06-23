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
