import { authRequest } from '@/services/rag-admin/api';

export interface AuditLog {
  id: string;
  userId: string;
  username: string;
  action: string;
  resource: string;
  detail?: string;
  ip: string;
  createdAt: string;
}

export async function getAuditLogs(params?: {
  current?: number;
  pageSize?: number;
  userId?: string;
  action?: string;
  resource?: string;
}) {
  return authRequest<{ data: AuditLog[]; total: number }>(
    '/api/admin/audit-logs',
    { params },
  );
}
