import { RagClientGraphBase } from './rag-client-graph';
import { LIST_READ_TIMEOUT_MS } from './rag-client.constants';

export abstract class RagClientSearchBase extends RagClientGraphBase {
  searchDocuments(
    query: string,
    limit = 20,
    filters: {
      fileType?: string;
      updatedRange?: string;
      documentType?: string;
      role?: string;
    } = {},
  ) {
    return this.getJson<Record<string, unknown>[]>(
      `/rag/admin/documents/search${this.toQueryString({ q: query, limit, ...filters })}`
    );
  }

  getDocumentSearchFacets() {
    return this.getJson<Record<string, unknown>>(
      "/rag/admin/documents/search/facets"
    );
  }

  inspectRetrieval(query: string, userId?: string, limit = 50) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/search/evidence${this.toQueryString({ q: query, userId: this.mapAdminUserId(userId), limit })}`,
      LIST_READ_TIMEOUT_MS,
    );
  }

  reindexDocumentSearch(limit = 1000) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/documents/search/reindex${this.toQueryString({ limit })}`,
      {}
    );
  }

  // ─── Document Actions ───────────────────────────────────────

  downloadDocument(docId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/documents/${encodeURIComponent(docId)}/download`
    );
  }

  archiveDocument(docId: string) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/documents/${encodeURIComponent(docId)}/archive`,
      {}
    );
  }

  unarchiveDocument(docId: string) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/documents/${encodeURIComponent(docId)}/unarchive`,
      {}
    );
  }

  updateDocumentPermissions(docId: string, body: unknown) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/documents/${encodeURIComponent(docId)}/permissions`,
      body
    );
  }

  batchDocumentOperation(body: unknown) {
    return this.postJson<Record<string, unknown>>(
      "/rag/admin/documents/batch",
      body
    );
  }

  uploadDocument(file: Express.Multer.File, fields: Record<string, unknown> = {}) {
    const form = new FormData();
    form.append('file', new Blob([file.buffer as unknown as BlobPart], { type: file.mimetype }), file.originalname);
    for (const [key, value] of Object.entries(fields)) {
      const forwardedValue = key === 'ownerUserId' && typeof value === 'string'
        ? this.mapAdminUserId(value)
        : value;
      if (forwardedValue !== undefined && forwardedValue !== null) form.append(key, String(forwardedValue));
    }
    return this.request<Record<string, unknown>>(
      '/rag/admin/documents/upload',
      { method: 'POST', body: form },
      true,
      10 * 60 * 1000,
    );
  }

  getDocumentTask(taskId: string, ownerUserId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/documents/tasks/${encodeURIComponent(taskId)}?ownerUserId=${encodeURIComponent(this.mapAdminUserId(ownerUserId) ?? ownerUserId)}`,
    );
  }
}
