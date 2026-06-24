import { authRequest } from '@/services/rag-admin/api';

export interface MenuItem {
  id: string;
  name: string;
  path: string;
  icon?: string;
  parentId?: string;
  sort: number;
  visible: boolean;
  children?: MenuItem[];
}

export async function getMenuTree() {
  return authRequest<{ data: MenuItem[] }>('/api/admin/menus/tree');
}

export async function createMenu(data: {
  name: string;
  path: string;
  icon?: string;
  parentId?: string;
  sort?: number;
  visible?: boolean;
}) {
  return authRequest('/api/admin/menus', { method: 'POST', data });
}

export async function updateMenu(
  id: string,
  data: {
    name?: string;
    path?: string;
    icon?: string;
    sort?: number;
    visible?: boolean;
  },
) {
  return authRequest(`/api/admin/menus/${id}`, { method: 'PATCH', data });
}

export async function deleteMenu(id: string) {
  return authRequest(`/api/admin/menus/${id}`, { method: 'DELETE' });
}
