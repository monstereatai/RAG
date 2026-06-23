import { authRequest } from '@/services/rag-admin/api';

export interface RoleItem {
  id: string;
  name: string;
  description?: string;
  permissions: { id: string; code: string; name: string }[];
  userCount: number;
  createdAt: string;
}

export async function getRoles(params?: {
  current?: number;
  pageSize?: number;
  name?: string;
}) {
  return authRequest<{ data: RoleItem[]; total: number }>('/api/admin/roles', {
    params,
  });
}

export async function createRole(data: {
  name: string;
  description?: string;
  permissionIds?: string[];
}) {
  return authRequest('/api/admin/roles', { method: 'POST', data });
}

export async function updateRole(
  id: string,
  data: { name?: string; description?: string; permissionIds?: string[] },
) {
  return authRequest(`/api/admin/roles/${id}`, { method: 'PATCH', data });
}

export async function deleteRole(id: string) {
  return authRequest(`/api/admin/roles/${id}`, { method: 'DELETE' });
}

export async function getPermissions() {
  return authRequest<{ data: { id: string; code: string; name: string }[] }>(
    '/api/admin/permissions',
  );
}
