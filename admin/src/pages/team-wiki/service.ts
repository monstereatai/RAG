import { authRequest } from '@/services/rag-admin/api';

export interface TeamWikiReference {
  docId: string;
  label: string;
  quote?: string;
}

export interface TeamWikiRevision {
  id: string;
  revisionNumber: number;
  title: string;
  content: string;
  references: TeamWikiReference[];
  changeSummary?: string | null;
  createdBy: string;
  createdAt: string;
  publishStatus: 'idle' | 'publishing' | 'published' | 'failed';
  publishedDocumentId?: string | null;
  publishedLifecycleStatus?: string | null;
  publishError?: string | null;
  publishedAt?: string | null;
}

export interface TeamWikiPage {
  id: string;
  title: string;
  excerpt: string;
  revisionNumber: number;
  status: 'draft' | 'published' | 'pending_review';
  publishStatus: TeamWikiRevision['publishStatus'];
  publishedDocumentId?: string | null;
  publishedLifecycleStatus?: string | null;
  publishError?: string | null;
  revisionId: string;
  updatedBy: string;
  updatedAt: string;
  createdAt: string;
  createdBy: string;
  content: string;
  references: TeamWikiReference[];
  lastPublishedRevisionId?: string | null;
  changeSummary?: string | null;
}

export interface TeamWikiDiff {
  from: TeamWikiRevision;
  to: TeamWikiRevision;
  changes: Array<{ type: 'added' | 'removed' | 'unchanged'; value: string }>;
}

export async function getTeamWikiPages(params?: {
  q?: string;
  limit?: number;
}) {
  return authRequest<TeamWikiPage[]>('/api/admin/team-wiki', { params });
}

export async function getTeamWikiPage(pageId: string) {
  return authRequest<TeamWikiPage>(
    `/api/admin/team-wiki/${encodeURIComponent(pageId)}`,
  );
}

export async function createTeamWikiPage(body: {
  title: string;
  content: string;
  references: TeamWikiReference[];
  changeSummary?: string;
}) {
  return authRequest<TeamWikiPage>('/api/admin/team-wiki', {
    method: 'POST',
    data: body,
  });
}

export async function updateTeamWikiPage(
  pageId: string,
  body: {
    title: string;
    content: string;
    references: TeamWikiReference[];
    changeSummary?: string;
    expectedRevisionNumber: number;
  },
) {
  return authRequest<TeamWikiPage>(
    `/api/admin/team-wiki/${encodeURIComponent(pageId)}`,
    { method: 'PATCH', data: body },
  );
}

export async function deleteTeamWikiPage(pageId: string) {
  return authRequest<{ id: string; deleted: boolean }>(
    `/api/admin/team-wiki/${encodeURIComponent(pageId)}`,
    { method: 'DELETE' },
  );
}

export async function getTeamWikiRevisions(pageId: string) {
  return authRequest<TeamWikiRevision[]>(
    `/api/admin/team-wiki/${encodeURIComponent(pageId)}/revisions`,
  );
}

export async function compareTeamWikiRevisions(
  pageId: string,
  from: string,
  to: string,
) {
  return authRequest<TeamWikiDiff>(
    `/api/admin/team-wiki/${encodeURIComponent(pageId)}/compare`,
    { params: { from, to } },
  );
}

export async function rollbackTeamWikiPage(
  pageId: string,
  revisionId: string,
  expectedRevisionNumber: number,
) {
  return authRequest<TeamWikiPage>(
    `/api/admin/team-wiki/${encodeURIComponent(pageId)}/rollback`,
    {
      method: 'POST',
      data: { revisionId, expectedRevisionNumber },
    },
  );
}

export async function publishTeamWikiPage(pageId: string) {
  return authRequest<{
    pageId: string;
    revisionId: string;
    documentId: string;
    lifecycleStatus: string;
    idempotent?: boolean;
  }>(`/api/admin/team-wiki/${encodeURIComponent(pageId)}/publish`, {
    method: 'POST',
  });
}
