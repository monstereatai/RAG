import { RagDocumentQueryDto, RagEvaluationRunDto } from "./dto/rag-admin.dto";
import { RagClientArtifactsBase } from './rag-client-artifacts';
import { LIST_READ_TIMEOUT_MS } from './rag-client.constants';

export abstract class RagClientDocumentsBase extends RagClientArtifactsBase {
  getDocuments(query: RagDocumentQueryDto) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/documents${this.toQueryString(query)}`,
      LIST_READ_TIMEOUT_MS,
    );
  }

  getDocumentStats() {
    return this.getJson<Record<string, unknown>>(
      '/rag/admin/documents/stats',
      LIST_READ_TIMEOUT_MS,
    );
  }

  getQueryDailyTrend(days = 14) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/queries/trend${this.toQueryString({ days })}`,
    );
  }

  getDocument(docId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/documents/${encodeURIComponent(docId)}`,
      LIST_READ_TIMEOUT_MS,
    );
  }

  getDocumentChunks(docId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/documents/${encodeURIComponent(docId)}/chunks`,
      LIST_READ_TIMEOUT_MS,
    );
  }

  getDocumentVersions(docId: string) {
    return this.getJson<Record<string, unknown>[]>(
      `/rag/admin/documents/${encodeURIComponent(docId)}/versions`
    );
  }

  createDocumentVersion(docId: string, body: unknown) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/documents/${encodeURIComponent(docId)}/versions`,
      body
    );
  }

  incrementalUpdateDocument(docId: string, body: unknown) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/documents/${encodeURIComponent(docId)}/incremental-update`,
      body
    );
  }

  updateDocumentLifecycle(docId: string, lifecycleStatus: string) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/documents/${encodeURIComponent(docId)}/lifecycle`,
      { lifecycleStatus }
    );
  }

  promoteDocumentVersion(docId: string) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/documents/${encodeURIComponent(docId)}/promote`,
      {}
    );
  }

  submitDocumentReview(docId: string, body: unknown) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/documents/${encodeURIComponent(docId)}/review/submit`, this.mapAdminActorField(body, "operatorId"),
    );
  }

  approveDocumentReview(docId: string, body: unknown) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/documents/${encodeURIComponent(docId)}/review/approve`, this.mapAdminActorField(body, "operatorId"),
    );
  }

  rejectDocumentReview(docId: string, body: unknown) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/documents/${encodeURIComponent(docId)}/review/reject`, this.mapAdminActorField(body, "operatorId"),
    );
  }

  getDocumentReviews(docId: string) {
    return this.getJson<Record<string, unknown>[]>(
      `/rag/admin/documents/${encodeURIComponent(docId)}/reviews`,
    );
  }

  getFailedDocumentTasks(limit = 50) {
    return this.getJson<Record<string, unknown>[]>(
      `/rag/admin/documents/tasks/failed${this.toQueryString({ limit })}`,
    );
  }

  retryFailedDocumentTask(taskId: string) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/documents/tasks/${encodeURIComponent(taskId)}/retry`, {},
    );
  }

  rollbackDocumentVersion(docId: string) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/documents/${encodeURIComponent(docId)}/rollback`,
      {}
    );
  }

  getVectorIndex() {
    return this.getJson<Record<string, unknown>>("/rag/admin/vector-index");
  }

  getEvaluations() {
    return this.getJson<Record<string, unknown>>("/rag/admin/evaluations");
  }

  getConversations(userId: string) {
    const mappedUserId = this.mapAdminUserId(userId);
    const params = mappedUserId ? `?userId=${encodeURIComponent(mappedUserId)}` : "";
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/conversations${params}`,
      LIST_READ_TIMEOUT_MS,
    );
  }

  getConversation(threadId: string, userId: string) {
    const mappedUserId = this.mapAdminUserId(userId);
    const params = mappedUserId ? `?userId=${encodeURIComponent(mappedUserId)}` : "";
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/conversations/${encodeURIComponent(threadId)}${params}`
    );
  }

  deleteConversation(threadId: string, userId: string) {
    const mappedUserId = this.mapAdminUserId(userId);
    const params = mappedUserId ? `?userId=${encodeURIComponent(mappedUserId)}` : "";
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/conversations/${encodeURIComponent(
        threadId
      )}/delete${params}`,
      {}
    );
  }

  reindexDocument(docId: string) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/documents/${encodeURIComponent(docId)}/reindex`,
      {}
    );
  }

  deleteDocument(docId: string) {
    return this.deleteJson<Record<string, unknown>>(
      `/rag/admin/documents/${encodeURIComponent(docId)}`
    );
  }

  runEvaluation(dto: RagEvaluationRunDto) {
    return this.postJson<Record<string, unknown>>(
      "/rag/admin/evaluations/run",
      dto
    );
  }

  // ─── Search Operations ──────────────────────────────────────

  getSearchPopularQueries() {
    return this.getJson<Record<string, unknown>>(
      "/rag/admin/search/queries/popular"
    );
  }

  getSearchNoResultQueries() {
    return this.getJson<Record<string, unknown>>(
      "/rag/admin/search/queries/no-result"
    );
  }

  getSearchRecallIssues() {
    return this.getJson<Record<string, unknown>>(
      "/rag/admin/search/recall-issues"
    );
  }

  // ─── QA Operations ──────────────────────────────────────────

  getQaNegativeFeedback() {
    return this.getJson<Record<string, unknown>>(
      "/rag/admin/qa/negative-feedback"
    );
  }

  getQaFeedback(query: Record<string, unknown> = {}) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/qa/feedback${this.toQueryString(query)}`
    );
  }

  submitQaFeedback(ownerUserId: string, body: unknown) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/qa/feedback${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      body
    );
  }

  reviewQaFeedback(id: string, body: Record<string, unknown>) {
    return this.patchJson<Record<string, unknown>>(
      `/rag/admin/qa/feedback/${encodeURIComponent(id)}`,
      body
    );
  }

  getQaCitationFailures() {
    return this.getJson<Record<string, unknown>>(
      "/rag/admin/qa/citation-failures"
    );
  }

  getQaCostSummary() {
    return this.getJson<Record<string, unknown>>("/rag/admin/qa/cost-summary");
  }
}
