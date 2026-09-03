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

// ========== 用户直接赋权（角色权限 ∪ 用户直赋权限，见 admin-backend PermissionService） ==========

export interface DirectPermissionItem {
  id: number;
  permissionId: number;
  code: string;
  name: string;
  grantedAt?: string;
}

export interface PermissionOption {
  id: string;
  code: string;
  name: string;
}

/** 查询某用户的直赋权限列表 */
export async function getUserDirectPermissions(id: string | number) {
  return authRequest<{ data: DirectPermissionItem[] }>(
    `/api/admin/users/${id}/permissions`,
  );
}

/** 授予直赋权限（幂等） */
export async function grantUserPermissions(id: string | number, permissionIds: number[]) {
  return authRequest(`/api/admin/users/${id}/permissions`, {
    method: 'POST',
    data: { permissionIds },
  });
}

/** 撤销直赋权限 */
export async function revokeUserPermissions(id: string | number, permissionIds: number[]) {
  return authRequest(
    `/api/admin/users/${id}/permissions?permissionIds=${permissionIds.join(',')}`,
    { method: 'DELETE' },
  );
}

/** 全量权限列表（用于构建权限树） */
export async function getPermissionOptions() {
  return authRequest<{ data: PermissionOption[] }>('/api/admin/permissions', {
    params: { current: 1, pageSize: 500 },
  });
}
