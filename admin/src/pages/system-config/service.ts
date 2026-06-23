import { authRequest } from '@/services/rag-admin/api';

export interface SystemConfig {
  key: string;
  value: string;
  description?: string;
  group: string;
  updatedAt: string;
}

export async function getConfigs(params?: { group?: string }) {
  return authRequest<{ data: SystemConfig[] }>('/api/admin/config', { params });
}

export async function updateConfig(key: string, value: string) {
  return authRequest(`/api/admin/config/${key}`, {
    method: 'PATCH',
    data: { value },
  });
}
