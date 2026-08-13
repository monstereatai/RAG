import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  RagClientResult,
  RagDocumentQueryDto,
  RagEvaluationRunDto,
} from "./dto/rag-admin.dto";
import { resolveRagServiceToken } from "./rag-service-token";

export interface RagAguiStreamQuery {
  query: string;
  mode?: "simple" | "agentic" | "auto";
  model?: "qwen" | "deepseek";
  userId?: string;
  threadId?: string;
  rolePresetId?: string;
}

export interface RagArtifactCreateInput {
  ownerUserId: string;
  threadId?: string;
  title: string;
  kind: "markdown" | "word" | "excel" | "architecture" | "image";
  sourceText: string;
  prompt?: string;
}

@Injectable()
export class RagClientService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly serviceToken: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = (
      this.configService.get<string>("RAG_SERVICE_BASE_URL") ||
      process.env.RAG_SERVICE_BASE_URL ||
      "http://localhost:3000/api/v1"
    ).replace(/\/$/, "");
    this.timeoutMs = Number(
      this.configService.get<string>("RAG_SERVICE_TIMEOUT_MS") ||
        process.env.RAG_SERVICE_TIMEOUT_MS ||
        2000
    );
    this.serviceToken = resolveRagServiceToken(this.configService);
  }

  getConfig() {
    return {
      baseUrl: this.baseUrl,
      timeoutMs: this.timeoutMs,
      integration: "http-api-contract",
      sharedPackage: false,
    };
  }

  listApiTokens() {
    return this.getJson<Record<string, unknown>>("/auth/api-tokens");
  }

  createApiToken(body: unknown) {
    return this.postJson<Record<string, unknown>>("/auth/api-tokens", body);
  }

  revokeApiToken(id: string) {
    return this.deleteJson<Record<string, unknown>>(
      `/auth/api-tokens/${encodeURIComponent(id)}`
    );
  }

  getCapabilities() {
    return this.getJson<Record<string, unknown>>("/rag/admin/capabilities");
  }

  getRolePresets() {
    return this.getJson<Record<string, unknown>>("/rag/admin/role-presets");
  }

  startProductionWorkflow(ownerUserId: string, body: unknown) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows${this.toQueryString({ ownerUserId })}`,
      body
    );
  }

  listProductionWorkflows(ownerUserId: string) {
    return this.getJson<Record<string, unknown>[]>(
      `/rag/admin/agent-ops/workflows${this.toQueryString({ ownerUserId })}`
    );
  }

  resumeProductionWorkflow(
    threadId: string,
    ownerUserId: string,
    body: unknown
  ) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/resume${this.toQueryString({ ownerUserId })}`,
      body
    );
  }

  getProductionWorkflow(threadId: string, ownerUserId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}${this.toQueryString({ ownerUserId })}`
    );
  }

  getProductionWorkflowCodingContext(threadId: string, ownerUserId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/coding-context${this.toQueryString({ ownerUserId })}`
    );
  }

  generateProductionWorkflowProject(threadId: string, ownerUserId: string) {
    return this.request<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/generate-project${this.toQueryString({ ownerUserId })}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
      true,
      180_000,
    );
  }

  generateProductionWorkflowProjectZip(threadId: string, ownerUserId: string) {
    return this.requestRaw(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/generate-project-zip${this.toQueryString({ ownerUserId })}`,
      true,
      { 'content-type': 'application/json' },
      'POST',
      '{}',
      180_000,
    );
  }

  evaluateAgent(body: unknown) {
    return this.postJson<Record<string, unknown>>(
      "/rag/admin/agent-ops/evals",
      body
    );
  }

  getAgentBadCases(status?: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/bad-cases${this.toQueryString({ status })}`
    );
  }

  reviewAgentBadCase(id: string, body: unknown) {
    return this.patchJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/bad-cases/${encodeURIComponent(id)}`,
      body
    );
  }

  getAgentTraces(limit = 50) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/traces${this.toQueryString({ limit })}`
    );
  }

  getAgentRunArtifacts(threadId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/runs/${encodeURIComponent(threadId)}/artifacts`
    );
  }

  getAgentRuns(limit = 30) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/runs${this.toQueryString({ limit })}`
    );
  }

  retryAgentRun(threadId: string) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/runs/${encodeURIComponent(threadId)}/retry`,
      {}
    );
  }

  getAgentRunCenter(limit = 50) {
    return this.getJson<Record<string, unknown>>(`/rag/admin/agent-ops/run-center${this.toQueryString({ limit })}`);
  }

  getAgentRunDetail(id: string) {
    return this.getJson<Record<string, unknown>>(`/rag/admin/agent-ops/run-center/${encodeURIComponent(id)}`);
  }

  retryAgentRunRecord(id: string) {
    return this.postJson<Record<string, unknown>>(`/rag/admin/agent-ops/run-center/${encodeURIComponent(id)}/retry`, {});
  }

  listGovernanceWorkflows(workspaceId?: string) {
    return this.getJson<Record<string, unknown>>(`/platform-governance/workflows${this.toQueryString({ workspaceId })}`);
  }

  createGovernanceWorkflow(body: unknown) {
    return this.postJson<Record<string, unknown>>('/platform-governance/workflows', body);
  }

  publishGovernanceWorkflow(id: string, version: number) {
    return this.postJson<Record<string, unknown>>(`/platform-governance/workflows/${encodeURIComponent(id)}/publish`, { version });
  }

  cloneGovernanceWorkflow(id: string, body: { key: string; name?: string }) {
    return this.postJson<Record<string, unknown>>(`/platform-governance/workflows/${encodeURIComponent(id)}/clone`, body);
  }

  listCollaborationSops() { return this.getJson<Record<string, unknown>>('/rag/admin/agent-ops/collaboration/sops'); }
  listCollaborationMessages(threadId?: string) { return this.getJson<Record<string, unknown>>(`/rag/admin/agent-ops/collaboration/messages${this.toQueryString({ threadId })}`); }
  createCollaborationMessage(body: unknown) { return this.postJson<Record<string, unknown>>('/rag/admin/agent-ops/collaboration/messages', body); }
  listArtifactDependencies(threadId?: string) { return this.getJson<Record<string, unknown>>(`/rag/admin/agent-ops/collaboration/dependencies${this.toQueryString({ threadId })}`); }
  listDecisionRecords(threadId?: string) { return this.getJson<Record<string, unknown>>(`/rag/admin/agent-ops/collaboration/decisions${this.toQueryString({ threadId })}`); }
  detectCollaborationConflicts(threadId: string) { return this.getJson<Record<string, unknown>>(`/rag/admin/agent-ops/collaboration/conflicts/${encodeURIComponent(threadId)}`); }
  createDecisionRecord(body: unknown) { return this.postJson<Record<string, unknown>>('/rag/admin/agent-ops/collaboration/decisions', body); }
  getCollaborationReplay(threadId: string) { return this.getJson<Record<string, unknown>>(`/rag/admin/agent-ops/collaboration/replay/${encodeURIComponent(threadId)}`); }
  listAgentTasks(threadId?: string) { return this.getJson<Record<string, unknown>>(`/rag/admin/agent-ops/tasks${this.toQueryString({ threadId })}`); }
  retryAgentTask(id: string) { return this.postJson<Record<string, unknown>>(`/rag/admin/agent-ops/tasks/${encodeURIComponent(id)}/retry`, {}); }
  delegateAgentTask(body: unknown) { return this.postJson<Record<string, unknown>>('/rag/admin/agent-ops/tasks/delegate', body); }
  listRuntimeEvents(threadId?: string, runId?: string) { return this.getJson<Record<string, unknown>>(`/rag/admin/agent-ops/runtime-events${this.toQueryString({ threadId, runId })}`); }
  getRuntimeEventMetrics(threadId?: string) { return this.getJson<Record<string, unknown>>(`/rag/admin/agent-ops/runtime-events/metrics${this.toQueryString({ threadId })}`); }

  listPlatformPlugins() {
    return this.getJson<Record<string, unknown>>('/platform-governance/plugins');
  }

  listPlatformModels() {
    return this.getJson<Record<string, unknown>>('/platform-governance/models');
  }

  listEvaluationCases(workspaceId?: string) {
    return this.getJson<Record<string, unknown>>(`/platform-governance/evaluation-cases${this.toQueryString({ workspaceId })}`);
  }

  createEvaluationCase(body: unknown) {
    return this.postJson<Record<string, unknown>>('/platform-governance/evaluation-cases', body);
  }

  listKnowledgeBaseProfiles(workspaceId?: string) {
    return this.getJson<Record<string, unknown>>(`/platform-governance/knowledge-base-profiles${this.toQueryString({ workspaceId })}`);
  }

  registerKnowledgeBaseProfile(body: unknown) {
    return this.postJson<Record<string, unknown>>('/platform-governance/knowledge-base-profiles', body);
  }

  debugRetrieval(query: string, scope?: string, knowledgeBaseKey?: string) {
    return this.getJson<Record<string, unknown>>(`/platform-governance/retrieval-debug${this.toQueryString({ query, scope, knowledgeBaseKey })}`);
  }

  createArtifact(body: RagArtifactCreateInput) {
    return this.postJson<Record<string, unknown>>("/rag/admin/artifacts", body);
  }

  listArtifacts(ownerUserId: string, threadId?: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/artifacts${this.toQueryString({ ownerUserId, threadId })}`
    );
  }

  getArtifact(id: string, ownerUserId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/artifacts/${encodeURIComponent(id)}${this.toQueryString({ ownerUserId })}`
    );
  }

  downloadArtifact(id: string, ownerUserId: string) {
    return this.requestRaw(
      `/rag/admin/artifacts/${encodeURIComponent(id)}/download${this.toQueryString({ ownerUserId })}`,
      true
    );
  }

  createArtifactShare(id: string, ownerUserId: string, body: unknown) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/artifacts/${encodeURIComponent(id)}/shares${this.toQueryString({ ownerUserId })}`,
      body
    );
  }

  listArtifactShares(id: string, ownerUserId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/artifacts/${encodeURIComponent(id)}/shares${this.toQueryString({ ownerUserId })}`
    );
  }

  revokeArtifactShare(id: string, shareId: string, ownerUserId: string) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/artifacts/${encodeURIComponent(id)}/shares/${encodeURIComponent(shareId)}/revoke${this.toQueryString({ ownerUserId })}`,
      {}
    );
  }

  getInternalArtifactShare(token: string, actorUserId: string) {
    return this.request<Record<string, unknown>>(
      `/rag/admin/artifacts/shared/${encodeURIComponent(token)}/internal`,
      { method: "GET", headers: { "x-actor-user-id": actorUserId } }
    );
  }

  downloadInternalArtifactShare(token: string, actorUserId: string) {
    return this.requestRaw(
      `/rag/admin/artifacts/shared/${encodeURIComponent(token)}/internal/download`,
      true,
      { "x-actor-user-id": actorUserId }
    );
  }

  getExternalArtifactShare(token: string) {
    return this.request<Record<string, unknown>>(
      `/artifacts/shared/${encodeURIComponent(token)}`,
      { method: "GET" },
      false
    );
  }

  downloadExternalArtifactShare(token: string) {
    return this.requestRaw(
      `/artifacts/shared/${encodeURIComponent(token)}/download`,
      false
    );
  }

  previewExternalArtifactShare(token: string) {
    return this.requestRaw(
      `/artifacts/shared/${encodeURIComponent(token)}/preview`,
      false
    );
  }

  getDocuments(query: RagDocumentQueryDto) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/documents${this.toQueryString(query)}`
    );
  }

  getDocument(docId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/documents/${encodeURIComponent(docId)}`
    );
  }

  getDocumentChunks(docId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/documents/${encodeURIComponent(docId)}/chunks`
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

  updateDocumentLifecycle(docId: string, lifecycleStatus: string) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/documents/${encodeURIComponent(docId)}/lifecycle`,
      { lifecycleStatus }
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

  getConversations(userId?: string) {
    const params = userId ? `?userId=${encodeURIComponent(userId)}` : "";
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/conversations${params}`
    );
  }

  getConversation(threadId: string, userId?: string) {
    const params = userId ? `?userId=${encodeURIComponent(userId)}` : "";
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/conversations/${encodeURIComponent(threadId)}${params}`
    );
  }

  deleteConversation(threadId: string, userId?: string) {
    const params = userId ? `?userId=${encodeURIComponent(userId)}` : "";
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
      `/rag/admin/qa/feedback${this.toQueryString({ ownerUserId })}`,
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

  streamAgui(query: RagAguiStreamQuery, signal: AbortSignal) {
    const params = new URLSearchParams({
      query: query.query,
      mode: query.mode ?? "agentic",
      model: query.model ?? "qwen",
      userId: query.userId || "admin-backend",
    });
    if (query.threadId) {
      params.set("threadId", query.threadId);
    }
    if (query.rolePresetId) {
      params.set("rolePresetId", query.rolePresetId);
    }
    const headers: Record<string, string> = {};
    if (this.serviceToken) {
      headers.Authorization = `Bearer ${this.serviceToken}`;
    }
    return fetch(`${this.baseUrl}/agui/admin/stream?${params.toString()}`, {
      headers,
      signal,
    });
  }

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

  searchGraph(query: Record<string, unknown>) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/graph/search${this.toQueryString(query)}`
    );
  }

  getGraphOrphans() {
    return this.getJson<Record<string, unknown>>("/rag/admin/graph/orphans");
  }

  getGraphConflicts() {
    return this.getJson<Record<string, unknown>>("/rag/admin/graph/conflicts");
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

  uploadDocument() {
    return this.postJson<Record<string, unknown>>(
      "/rag/admin/documents/upload",
      {}
    );
  }

  async getJson<T>(path: string): Promise<RagClientResult<T>> {
    return this.request<T>(path, { method: "GET" });
  }

  private async postJson<T>(
    path: string,
    body: unknown
  ): Promise<RagClientResult<T>> {
    return this.request<T>(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async patchJson<T>(
    path: string,
    body: unknown
  ): Promise<RagClientResult<T>> {
    return this.request<T>(path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async deleteJson<T>(path: string): Promise<RagClientResult<T>> {
    return this.request<T>(path, { method: "DELETE" });
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    authenticated = true,
    timeoutMs = this.timeoutMs,
  ): Promise<RagClientResult<T>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> | undefined),
    };
    if (authenticated && this.serviceToken) {
      headers["Authorization"] = `Bearer ${this.serviceToken}`;
    }

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;

      return {
        available: response.ok,
        status: response.status,
        data: response.ok ? data : null,
        error: response.ok
          ? undefined
          : this.extractError(data, response.status),
      };
    } catch (error) {
      return {
        available: false,
        status: null,
        data: null,
        error:
          error instanceof Error ? error.message : "rag service request failed",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async requestRaw(
    path: string,
    authenticated: boolean,
    extraHeaders: Record<string, string> = {},
    method = 'GET',
    body?: string,
    timeoutMs = this.timeoutMs,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const headers = { ...extraHeaders };
    if (authenticated && this.serviceToken) {
      headers["Authorization"] = `Bearer ${this.serviceToken}`;
    }
    try {
      return await fetch(`${this.baseUrl}${path}`, { method, headers, body, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private toQueryString(query: object): string {
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(
      query as Record<string, unknown>
    )) {
      if (
        value !== undefined &&
        value !== null &&
        value !== "" &&
        key !== "current"
      ) {
        params.set(key, String(value));
      }
    }

    const text = params.toString();
    return text ? `?${text}` : "";
  }

  private extractError(data: unknown, status: number): string {
    if (data && typeof data === "object" && "message" in data) {
      return String((data as { message: unknown }).message);
    }

    return `rag service returned ${status}`;
  }
}
