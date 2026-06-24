import { authRequest } from '@/services/rag-admin/api';

export interface Notification {
  id: string;
  title: string;
  content: string;
  type: 'system' | 'alert' | 'info';
  read: boolean;
  createdAt: string;
}

export async function getNotifications(params?: {
  current?: number;
  pageSize?: number;
  type?: string;
  read?: boolean;
}) {
  return authRequest<{ data: Notification[]; total: number }>(
    '/api/admin/notifications',
    { params },
  );
}

export async function markAsRead(id: string) {
  return authRequest(`/api/admin/notifications/${id}/read`, {
    method: 'PATCH',
  });
}

export async function markAllAsRead() {
  return authRequest('/api/admin/notifications/read-all', { method: 'PATCH' });
}

export async function deleteNotification(id: string) {
  return authRequest(`/api/admin/notifications/${id}`, { method: 'DELETE' });
}
