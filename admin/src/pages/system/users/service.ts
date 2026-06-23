import { authRequest } from '@/services/rag-admin/api';

export interface UserItem {
  id: string;
  username: string;
  email: string;
  phone?: string;
  status: 'active' | 'inactive' | 'locked';
  roles: { id: string; name: string }[];
  createdAt: string;
  lastLoginAt?: string;
}

export async function getUsers(params?: {
  current?: number;
  pageSize?: number;
  username?: string;
  status?: string;
}) {
  return authRequest<{ data: UserItem[]; total: number }>('/api/admin/users', {
    params,
  });
}

export async function createUser(data: {
  username: string;
  password: string;
  email: string;
  phone?: string;
  roleIds?: string[];
}) {
  return authRequest('/api/admin/users', { method: 'POST', data });
}

export async function updateUser(
  id: string,
  data: {
    email?: string;
    phone?: string;
    status?: string;
    roleIds?: string[];
  },
) {
  return authRequest(`/api/admin/users/${id}`, { method: 'PATCH', data });
}

export async function deleteUser(id: string) {
  return authRequest(`/api/admin/users/${id}`, { method: 'DELETE' });
}

export async function resetPassword(id: string, password: string) {
  return authRequest(`/api/admin/users/${id}/reset-password`, {
    method: 'POST',
    data: { password },
  });
}
