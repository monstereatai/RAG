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
}) {
  return authRequest<{ data: DocumentItem[]; total: number }>(
    '/api/admin/documents',
    { params },
  );
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
