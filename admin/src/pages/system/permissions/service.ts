import { authRequest } from '@/services/rag-admin/api';

export interface PermissionItem {
  id: string;
  code: string;
  name: string;
  module: string;
  description?: string;
}

export async function getPermissions(params?: {
  current?: number;
  pageSize?: number;
  module?: string;
}) {
  return authRequest<{ data: PermissionItem[]; total: number }>(
    '/api/admin/permissions',
    { params },
  );
}

export async function createPermission(data: {
  code: string;
  name: string;
  module: string;
  description?: string;
}) {
  return authRequest('/api/admin/permissions', { method: 'POST', data });
}

export async function updatePermission(
  id: string,
  data: { name?: string; description?: string },
) {
  return authRequest(`/api/admin/permissions/${id}`, { method: 'PATCH', data });
}

export async function deletePermission(id: string) {
  return authRequest(`/api/admin/permissions/${id}`, { method: 'DELETE' });
}
