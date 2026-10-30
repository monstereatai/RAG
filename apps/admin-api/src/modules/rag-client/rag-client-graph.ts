import { RagClientQaBase } from './rag-client-qa';

export abstract class RagClientGraphBase extends RagClientQaBase {
  // ─── Graph Operations ───────────────────────────────────────

  getGraphSchema() {
    return this.getJson<Record<string, unknown>>("/rag/admin/graph/schema");
  }

  getGraphEntities() {
    return this.getJson<Record<string, unknown>>("/rag/admin/graph/entities");
  }

  getGraphEntityDetail(id: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/graph/entities/${encodeURIComponent(id)}`
    );
  }

  updateGraphEntity(id: string, body: Record<string, unknown>) {
    return this.patchJson<Record<string, unknown>>(
      `/rag/admin/graph/entities/${encodeURIComponent(id)}`,
      body
    );
  }

  getGraphRelationships() {
    return this.getJson<Record<string, unknown>>(
      "/rag/admin/graph/relationships"
    );
  }

  searchGraphRelationships(query: Record<string, unknown>) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/graph/relationships${this.toQueryString(query)}`
    );
  }

  searchGraph(query: string | Record<string, unknown>, limit = 100) {
    const params = typeof query === 'string' ? { query, limit } : query;
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/graph/search${this.toQueryString(params)}`
    );
  }

  getGraphOrphans() {
    return this.getJson<Record<string, unknown>>("/rag/admin/graph/orphans");
  }

  getGraphConflicts() {
    return this.getJson<Record<string, unknown>>("/rag/admin/graph/conflicts");
  }
}
