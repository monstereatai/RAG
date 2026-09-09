import { authRequest } from '@/services/rag-admin/api';

export interface DocumentItem {
  id: string;
  filename: string;
  fileType: string;
  fileSize: number;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  chunkCount: number;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
  metadata?: {
    title?: string;
    author?: string;
    summary?: string;
    keywords?: string[];
    language?: string;
    category?: string;
  };
  obsidianPath?: string | null;
  obsidianStatus?: 'linked' | 'missing';
  docVersion?: string | null;
  lifecycleStatus?: string | null;
  reviewStatus?: 'draft' | 'pending_review' | 'approved' | 'rejected';
  graphIndexStatus?: 'pending' | 'indexed' | 'failed' | 'skipped';
  graphIndexedAt?: string | null;
  graphIndexError?: string | null;
  supersedesDocId?: string | null;
  effectiveAt?: string | null;
  expiredAt?: string | null;
  permissions?: Array<{
    subjectType: 'user' | 'role' | 'department' | 'public';
    subjectId: string;
  }>;
  indexPipeline?: {
    rag: PipelineStatus;
    es: PipelineStatus;
    graph: PipelineStatus;
  };
}

export interface PipelineStatus {
  status: 'pending' | 'indexed' | 'failed' | 'skipped';
  chunkCount: number | null;
  durationMs: number | null;
  completedAt: string | null;
  error: string | null;
}

export interface DocumentVersionItem {
  docId: string;
  filename: string;
  docVersion: string;
  lifecycleStatus: string;
  reviewStatus?: string;
  supersedesDocId?: string | null;
  effectiveAt?: string | null;
  expiredAt?: string | null;
  createdAt: string;
  chunkCount: number;
}

export interface DocumentPermissionInput {
  subjectType: 'user' | 'role' | 'department' | 'public';
  subjectId?: string;
  scope?: 'read';
}

export async function getDocuments(params?: {
  current?: number;
  pageSize?: number;
  filename?: string;
  status?: string;
  fileType?: string;
  scope?: 'public' | 'department';
  departmentId?: string;
  lifecycleStatus?: string;
}) {
  return authRequest<{ data: DocumentItem[]; total: number }>(
    '/api/admin/documents',
    { params, headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } },
  );
}

export async function uploadDocument(file: File) {
  if (file.size > 1024 * 1024 * 1024) {
    throw new Error('文档超过 1GB 上传上限');
  }
  const data = new FormData();
  data.append('file', file);
  return authRequest<Record<string, unknown>>('/api/admin/documents/upload', {
    method: 'POST',
    data,
  });
}

export async function getUsers() {
  return authRequest<any>('/api/admin/users');
}

export async function getRoles() {
  return authRequest<any>('/api/admin/roles');
}

export async function getOrganizations() {
  return authRequest<any>('/api/admin/organizations');
}

export async function deleteDocument(id: string) {
  return authRequest(`/api/admin/documents/${id}`, { method: 'DELETE' });
}

export async function reprocessDocument(id: string) {
  return authRequest(`/api/admin/documents/${id}/reprocess`, {
    method: 'POST',
  });
}

export async function getDocumentDetail(id: string) {
  return authRequest<{ data: DocumentItem }>(`/api/admin/documents/${id}`);
}

export interface ChunkItem {
  id: string;
  index: number;
  content: string;
  headingPath: string;
  tokenCount: number;
  startOffset: number;
  endOffset: number;
}

export async function getDocumentChunks(
  id: string,
  params?: { current?: number; pageSize?: number },
) {
  return authRequest<{ data: ChunkItem[]; total: number }>(
    `/api/admin/documents/${id}/chunks`,
    { params },
  );
}

export async function updateDocumentPermissions(
  id: string,
  permissions: DocumentPermissionInput[],
) {
  return authRequest(`/api/admin/documents/${id}/permissions`, {
    method: 'POST',
    data: { permissions },
  });
}

export async function getDocumentVersions(id: string) {
  return authRequest<DocumentVersionItem[]>(`/api/admin/documents/${id}/versions`);
}

export async function createDocumentVersion(id: string, body: {
  content: string;
  filename?: string;
  docVersion?: string;
  effectiveAt?: string;
  expiredAt?: string;
  lifecycleStatus?: string;
}) {
  return authRequest(`/api/admin/documents/${id}/versions`, { method: 'POST', data: body });
}

export async function updateDocumentLifecycle(id: string, lifecycleStatus: string) {
  return authRequest(`/api/admin/documents/${id}/lifecycle`, {
    method: 'POST',
    data: { lifecycleStatus },
  });
}

export async function promoteDocumentVersion(id: string) {
  return authRequest(`/api/admin/documents/${id}/promote`, { method: 'POST' });
}

export async function submitDocumentReview(id: string, comment?: string) {
  return authRequest(`/api/admin/documents/${id}/review/submit`, { method: 'POST', data: { comment } });
}

export async function approveDocumentReview(id: string, comment?: string) {
  return authRequest(`/api/admin/documents/${id}/review/approve`, { method: 'POST', data: { comment } });
}

export async function rejectDocumentReview(id: string, comment?: string) {
  return authRequest(`/api/admin/documents/${id}/review/reject`, { method: 'POST', data: { comment } });
}

export async function getFailedDocumentTasks() {
  return authRequest<any[]>('/api/admin/documents/tasks/failed');
}

export async function retryFailedDocumentTask(taskId: string) {
  return authRequest(`/api/admin/documents/tasks/${taskId}/retry`, { method: 'POST' });
}

export async function rollbackDocumentVersion(id: string) {
  return authRequest(`/api/admin/documents/${id}/rollback`, { method: 'POST' });
}

export async function archiveDocument(id: string) {
  return authRequest(`/api/admin/documents/${id}/archive`, { method: 'POST' });
}

export async function unarchiveDocument(id: string) {
  return authRequest(`/api/admin/documents/${id}/unarchive`, { method: 'POST' });
}
