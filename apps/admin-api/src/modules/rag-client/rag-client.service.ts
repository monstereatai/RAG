import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import {
  RagClientResult,
  RagDocumentQueryDto,
  RagEvaluationRunDto,
} from "./dto/rag-admin.dto";
import { resolveRagServiceToken } from "./rag-service-token";

export interface RagAguiStreamQuery {
  query: string;
  mode?: "simple" | "agentic" | "auto";
  model?: "qwen" | "deepseek" | "zhipu";
  userId?: string;
  threadId?: string;
  rolePresetId?: string;
  pluginKeys?: string[];
  attachmentIds?: string[];
}

export interface RagArtifactCreateInput {
  ownerUserId: string;
  threadId?: string;
  title: string;
  kind: "markdown" | "word" | "excel" | "architecture" | "image";
  sourceText: string;
  prompt?: string;
}

const LIST_READ_TIMEOUT_MS = 10_000;
const WORKSPACE_PREVIEW_TIMEOUT_MS = 90_000;

@Injectable()
export class RagClientService {
  /**
   * 管理后台到 RAG Backend 的唯一 HTTP 边界。
   * 浏览器令牌绝不透传到 RAG 服务；本客户端统一附加内部服务令牌、超时和响应可用性标识，
   * 防止管理端代码绕开权限、审计和降级约定直接访问 RAG 内部实现。
   */
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

  /**
   * Admin Backend uses its own numeric user IDs. Derive a namespaced ID within
   * Milvus's 64-character user_id limit so it cannot match a numeric RAG ID.
   * The deterministic mapping keeps ownership stable across RAG features.
   */
  private mapAdminUserId(
    userId: string | number | undefined,
  ): string | undefined {
    const normalized =
      typeof userId === 'number' && Number.isSafeInteger(userId)
        ? String(userId)
        : typeof userId === 'string'
          ? userId.trim()
          : undefined;
    // Admin Backend's user table has numeric IDs. Preserve nonnumeric RAG,
    // integration, and service identities such as "admin-backend".
    if (!normalized || !/^\d+$/.test(normalized)) {
      return typeof userId === 'string' ? userId : undefined;
    }
    const digest = createHash("sha256")
      .update("rag-admin-user\0")
      .update(normalized)
      .digest("hex")
      .slice(0, 58);
    return `admin:${digest}`;
  }

  private mapAdminActorField(body: unknown, field: string): unknown {
    if (!body || typeof body !== "object" || Array.isArray(body)) return body;
    const payload = body as Record<string, unknown>;
    const value = payload[field];
    if (
      (typeof value !== "string" || !value.trim()) &&
      !(typeof value === "number" && Number.isSafeInteger(value))
    ) {
      return body;
    }
    return { ...payload, [field]: this.mapAdminUserId(value) };
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

  issueSpeechTicket(ownerUserId: string, ownerRole: 'admin' | 'user') {
    return this.postJson<Record<string, unknown>>('/auth/internal/speech-ticket', {
      ownerUserId: this.mapAdminUserId(ownerUserId),
      ownerRole,
    });
  }

  getCapabilities() {
    return this.getJson<Record<string, unknown>>("/rag/admin/capabilities");
  }

  searchImages(userId: string, tenantId: string | undefined, role: string | undefined, query: string, limit = 20) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/images/search${this.toQueryString({ userId: this.mapAdminUserId(userId), tenantId, role, q: query, limit })}`,
    );
  }

  searchImagesByImage(
    userId: string,
    tenantId: string | undefined,
    role: string | undefined,
    file: Express.Multer.File,
    limit = 20,
  ) {
    const formData = new FormData();
    const imageBytes = new Uint8Array(file.buffer.byteLength);
    imageBytes.set(file.buffer);
    formData.append(
      'file',
      new Blob([imageBytes.buffer], { type: file.mimetype }),
      file.originalname,
    );
    formData.append('userId', this.mapAdminUserId(userId) ?? userId);
    if (tenantId) formData.append('tenantId', tenantId);
    if (role) formData.append('role', role);
    formData.append('limit', String(limit));
    return this.request<Record<string, unknown>>(
      '/rag/admin/images/search',
      { method: 'POST', body: formData },
      true,
      60_000,
    );
  }

  getImageAsset(
    userId: string,
    tenantId: string | undefined,
    role: string | undefined,
    docId: string,
    key: string,
  ) {
    return this.requestRaw(
      `/rag/admin/images/asset${this.toQueryString({ userId: this.mapAdminUserId(userId), tenantId, role, docId, key })}`,
      true,
    );
  }

  listTeamWikiPages(ownerUserId: string, query?: string, limit = 100) {
    return this.getJson<Record<string, unknown>[]>(
      `/rag/admin/team-wiki/pages${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId), q: query, limit })}`,
    );
  }

  getTeamWikiPage(ownerUserId: string, pageId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/team-wiki/pages/${encodeURIComponent(pageId)}${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
    );
  }

  createTeamWikiPage(ownerUserId: string, body: unknown) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/team-wiki/pages${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      body,
    );
  }

  updateTeamWikiPage(ownerUserId: string, pageId: string, body: unknown) {
    return this.patchJson<Record<string, unknown>>(
      `/rag/admin/team-wiki/pages/${encodeURIComponent(pageId)}${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      body,
    );
  }

  deleteTeamWikiPage(ownerUserId: string, pageId: string) {
    return this.deleteJson<Record<string, unknown>>(
      `/rag/admin/team-wiki/pages/${encodeURIComponent(pageId)}${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
    );
  }

  getTeamWikiRevisions(ownerUserId: string, pageId: string) {
    return this.getJson<Record<string, unknown>[]>(
      `/rag/admin/team-wiki/pages/${encodeURIComponent(pageId)}/revisions${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
    );
  }

  compareTeamWikiRevisions(
    ownerUserId: string,
    pageId: string,
    fromRevisionId: string,
    toRevisionId: string,
  ) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/team-wiki/pages/${encodeURIComponent(pageId)}/compare${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId), from: fromRevisionId, to: toRevisionId })}`,
    );
  }

  rollbackTeamWikiPage(ownerUserId: string, pageId: string, body: unknown) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/team-wiki/pages/${encodeURIComponent(pageId)}/rollback${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      body,
    );
  }

  publishTeamWikiPage(ownerUserId: string, pageId: string) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/team-wiki/pages/${encodeURIComponent(pageId)}/publish${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      {},
    );
  }

  syncFeishuWiki(ownerUserId: string, spaceId: string, shareWithinTenant?: boolean) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/integrations/feishu/wiki/sync${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      { spaceId, shareWithinTenant },
    );
  }

  getFeishuWikiStatus(ownerUserId: string, spaceId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/integrations/feishu/wiki/status${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId), spaceId })}`,
    );
  }

  getRolePresets() {
    return this.getJson<Record<string, unknown>>("/rag/admin/role-presets");
  }

  /** 以服务身份查询指定已登录用户的长期记忆；ownerUserId 由网关从 JWT 解析，不信任浏览器传值。 */
  getUserMemories(ownerUserId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/memories${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
    );
  }

  /** 清空操作与读取走同一服务边界，避免 Admin JWT 与 RAG JWT 密钥不一致导致 401。 */
  clearUserMemories(ownerUserId: string) {
    return this.deleteJson<Record<string, unknown>>(
      `/rag/admin/memories${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
    );
  }

  startProductionWorkflow(ownerUserId: string, body: unknown) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      body
    );
  }

  listProductionWorkflows(ownerUserId: string) {
    return this.getJson<Record<string, unknown>[]>(
      `/rag/admin/agent-ops/workflows${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`
    );
  }

  listProductionComponentRules(query = '', limit = 18) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/component-rules${this.toQueryString({ q: query, limit })}`
    );
  }

  listProductionActivityTemplates(query = '', limit = 4) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/activity-templates${this.toQueryString({ q: query, limit })}`
    );
  }

  getProductionActivityGraph(query = '') {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/activity-graph${this.toQueryString({ q: query })}`
    );
  }

  importProductionPlaywayGraph(ownerUserId: string, body: unknown) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/production/playway-graph/import${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      body,
    );
  }

  resumeProductionWorkflow(
    threadId: string,
    ownerUserId: string,
    body: unknown
  ) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/resume${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      body
    );
  }

  reviseProductionWorkflow(threadId: string, ownerUserId: string, body: unknown) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/revise${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      body
    );
  }

  cancelProductionWorkflow(threadId: string, ownerUserId: string, body: unknown) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/cancel${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      body,
    );
  }

  getProductionWorkflow(threadId: string, ownerUserId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`
    );
  }

  getProductionWorkflowCodingContext(threadId: string, ownerUserId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/coding-context${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`
    );
  }

  getProductionWorkflowArtifacts(threadId: string, ownerUserId: string) {
    return this.getJson<Record<string, unknown>[]>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/artifacts${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
    );
  }

  generateProductionWorkflowArtifacts(
    threadId: string,
    ownerUserId: string,
    body: unknown,
  ) {
    return this.request<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/artifacts/generate${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      true,
      180_000,
    );
  }

  proposeProductionWorkflowArtifactEdit(
    threadId: string,
    ownerUserId: string,
    body: unknown,
  ) {
    return this.request<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/artifacts/edit${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      true,
      120_000,
    );
  }

  proposeProductionWorkflowCodeEdit(
    threadId: string,
    ownerUserId: string,
    body: unknown,
  ) {
    return this.request<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/artifacts/code-edit${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      true,
      120_000,
    );
  }

  applyProductionWorkflowCodeEdit(
    threadId: string,
    ownerUserId: string,
    body: unknown,
  ) {
    return this.request<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/artifacts/code-edit/apply${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      true,
      180_000,
    );
  }

  applyProductionWorkflowArtifactEdit(
    threadId: string,
    ownerUserId: string,
    body: unknown,
  ) {
    return this.request<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/artifacts/apply${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      true,
      180_000,
    );
  }

  restoreProductionWorkflowArtifactVersion(
    threadId: string,
    ownerUserId: string,
    body: unknown,
  ) {
    return this.request<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/artifacts/restore${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      true,
      180_000,
    );
  }

  simulateProductionWorkflowArtifactSync(
    threadId: string,
    ownerUserId: string,
    artifactId: string,
  ) {
    return this.request<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/artifacts/${encodeURIComponent(artifactId)}/simulated-sync${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      { method: 'POST' },
      true,
      30_000,
    );
  }

  previewProductionWorkflowArtifact(
    threadId: string,
    ownerUserId: string,
    artifactId: string,
  ) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/artifacts/${encodeURIComponent(artifactId)}/preview${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      30_000,
    );
  }

  sourceProductionWorkflowArtifact(
    threadId: string,
    ownerUserId: string,
    artifactId: string,
  ) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/artifacts/${encodeURIComponent(artifactId)}/source${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      30_000,
    );
  }

  downloadProductionWorkflowArtifact(
    threadId: string,
    ownerUserId: string,
    artifactId: string,
  ) {
    return this.requestRaw(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/artifacts/${encodeURIComponent(artifactId)}/download${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      true,
      {},
      'GET',
      undefined,
      30_000,
    );
  }

  getProductionWorkflowWorkspace(
    threadId: string,
    ownerUserId: string,
    tenantId: string | undefined,
  ) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/workspace${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId), tenantId })}`,
      30_000,
    );
  }

  startProductionWorkflowWorkspace(
    threadId: string,
    ownerUserId: string,
    tenantId: string | undefined,
    body: unknown,
  ) {
    return this.request<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/workspace/start${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId), tenantId })}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      true,
      180_000,
    );
  }

  runProductionWorkflowWorkspaceAgent(
    threadId: string,
    ownerUserId: string,
    tenantId: string | undefined,
    body: unknown,
  ) {
    return this.request<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/workspace/agent${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId), tenantId })}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      true,
      530_000,
    );
  }

  runProductionWorkflowWorkspaceCommand(
    threadId: string,
    ownerUserId: string,
    tenantId: string | undefined,
    body: unknown,
  ) {
    return this.request<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/workspace/command${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId), tenantId })}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      true,
      270_000,
    );
  }

  startProductionWorkflowWorkspaceDevServer(
    threadId: string,
    ownerUserId: string,
    tenantId: string | undefined,
    body: unknown,
  ) {
    return this.request<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/workspace/dev-server/start${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId), tenantId })}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      true,
      60_000,
    );
  }

  stopProductionWorkflowWorkspaceDevServer(
    threadId: string,
    ownerUserId: string,
    tenantId: string | undefined,
  ) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/workspace/dev-server/stop${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId), tenantId })}`,
      {},
    );
  }

  createProductionWorkflowWorkspacePreviewTicket(
    threadId: string,
    ownerUserId: string,
    tenantId: string | undefined,
    body: unknown,
  ) {
    return this.request<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/workspace/preview-ticket${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId), tenantId })}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      true,
      30_000,
    );
  }

  proxyProductionWorkflowWorkspacePreview(
    ticket: string,
    threadId: string,
    request: {
      method: 'GET' | 'HEAD';
      path: string;
      query: string;
      headers: Record<string, string>;
      signal?: AbortSignal;
    },
  ) {
    const encodedPath = request.path
      .split('/')
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const requestPath = `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/workspace/preview/${encodeURIComponent(ticket)}${encodedPath ? `/${encodedPath}` : ''}${request.query ? `?${request.query}` : ''}`;
    if (request.signal) {
      return this.requestRaw(
        requestPath,
        true,
        request.headers,
        request.method,
        undefined,
        WORKSPACE_PREVIEW_TIMEOUT_MS,
        request.signal,
      );
    }
    return this.requestRaw(
      requestPath,
      true,
      request.headers,
      request.method,
      undefined,
      WORKSPACE_PREVIEW_TIMEOUT_MS,
    );
  }

  exportProductionWorkflowWorkspace(
    threadId: string,
    ownerUserId: string,
    tenantId: string | undefined,
  ) {
    return this.request<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/workspace/export${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId), tenantId })}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
      true,
      180_000,
    );
  }

  deleteProductionWorkflowWorkspace(
    threadId: string,
    ownerUserId: string,
    tenantId: string | undefined,
    body: { confirmDiscard: true },
  ) {
    return this.request<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/workspace${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId), tenantId })}`,
      {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      true,
    );
  }

  getProductionPlaywayPreview(threadId: string, ownerUserId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/playway-preview${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`
    );
  }

  generateProductionWorkflowProject(threadId: string, ownerUserId: string) {
    return this.request<Record<string, unknown>>(
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/generate-project${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
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
      `/rag/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/generate-project-zip${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
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
      this.mapAdminActorField(body, "reviewedBy")
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

  getAgentRunDetailArtifacts(id: string) {
    return this.getJson<Record<string, unknown>>(`/rag/admin/agent-ops/run-center/${encodeURIComponent(id)}/artifacts`);
  }

  getAgentRuntimeCapabilities() {
    return this.getJson<Record<string, unknown>>('/agent-runtime/capabilities');
  }

  createAgentRuntimePlan(body: unknown) {
    return this.postJson<Record<string, unknown>>('/agent-runtime/plans', body);
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
  listAgentTasks(threadId: string | undefined, ownerUserId: string) { return this.getJson<Record<string, unknown>[]>(`/rag/admin/agent-ops/tasks${this.toQueryString({ threadId, ownerUserId: this.mapAdminUserId(ownerUserId) })}`); }
  retryAgentTask(id: string, ownerUserId: string) { return this.postJson<Record<string, unknown>>(`/rag/admin/agent-ops/tasks/${encodeURIComponent(id)}/retry${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`, {}); }
  delegateAgentTask(body: unknown) { return this.postJson<Record<string, unknown>>('/rag/admin/agent-ops/tasks/delegate', this.mapAdminActorField(body, "ownerUserId")); }
  listRuntimeEvents(threadId?: string, runId?: string) { return this.getJson<Record<string, unknown>>(`/rag/admin/agent-ops/runtime-events${this.toQueryString({ threadId, runId })}`); }
  getRuntimeEventMetrics(threadId?: string, runId?: string) { return this.getJson<Record<string, unknown>>(`/rag/admin/agent-ops/runtime-events/metrics${this.toQueryString({ threadId, runId })}`); }
  getAgentRunSummary(limit = 500) { return this.getJson<Record<string, unknown>>(`/rag/admin/agent-ops/runs/summary${this.toQueryString({ limit })}`); }

  listScheduledAnalysisJobs() {
    return this.getJson<Record<string, unknown>[]>('/rag/admin/agent-ops/schedules');
  }

  listSecurityPolicies() {
    return this.getJson<Record<string, unknown>>('/rag/admin/security/policies');
  }

  listSecurityAudit(limit = 100) {
    return this.getJson<Record<string, unknown>>(`/rag/admin/security/audit${this.toQueryString({ limit })}`);
  }

  getRagQualitySummary(limit = 500) {
    return this.getJson<Record<string, unknown>>(`/rag/admin/quality/summary${this.toQueryString({ limit })}`);
  }

  getIntentRoutingSummary(limit = 200) {
    return this.getJson<Record<string, unknown>>(`/rag/admin/quality/intent-routing${this.toQueryString({ limit })}`);
  }

  auditDocumentIndexes(limit = 200) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/documents/index-audit?limit=${encodeURIComponent(String(limit))}`,
    );
  }

  repairDocumentIndexes(body: { docIds?: string[]; limit?: number }) {
    return this.postJson<Record<string, unknown>>('/rag/admin/documents/index-audit/repair', body);
  }

  getDocumentQueueStatus() {
    return this.getJson<Record<string, unknown>>('/rag/admin/documents/queue/status');
  }

  getPendingDocumentTasks(limit = 50) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/documents/tasks/pending${this.toQueryString({ limit })}`,
    );
  }

  cancelQueuedDocumentTask(taskId: string) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/documents/tasks/${encodeURIComponent(taskId)}/cancel`,
      {},
    );
  }

  getIndexRepairQueueStatus() {
    return this.getJson<Record<string, unknown>>('/rag/admin/documents/index-repair/status');
  }

  getFailedIndexRepairs(limit = 50) {
    return this.getJson<Record<string, unknown>[]>(
      `/rag/admin/documents/index-repair/failed${this.toQueryString({ limit })}`,
    );
  }

  retryIndexRepair(jobId: string) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/documents/index-repair/${encodeURIComponent(jobId)}/retry`,
      {},
    );
  }

  getIndexReconcilerStatus() {
    return this.getJson<Record<string, unknown>>('/rag/admin/documents/index-reconciler/status');
  }

  runIndexReconciler() {
    return this.postJson<Record<string, unknown>>('/rag/admin/documents/index-reconciler/run', {});
  }

  parseScheduledAnalysisJob(body: unknown) {
    return this.postJson<Record<string, unknown>>('/rag/admin/agent-ops/schedules/parse', body);
  }

  createScheduledAnalysisJob(ownerUserId: string, body: unknown) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/agent-ops/schedules${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      body,
    );
  }

  runScheduledAnalysisJob(id: string) {
    return this.request<Record<string, unknown>>(
      `/rag/admin/agent-ops/schedules/${encodeURIComponent(id)}/run`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      },
      true,
      130_000,
    );
  }

  startScheduledAnalysisJob(id: string) {
    return this.patchJson<Record<string, unknown>>(`/rag/admin/agent-ops/schedules/${encodeURIComponent(id)}/start`, {});
  }

  stopScheduledAnalysisJob(id: string) {
    return this.patchJson<Record<string, unknown>>(`/rag/admin/agent-ops/schedules/${encodeURIComponent(id)}/stop`, {});
  }

  listScheduledAnalysisExecutions(id: string) {
    return this.getJson<Record<string, unknown>[]>(`/rag/admin/agent-ops/schedules/${encodeURIComponent(id)}/executions`);
  }

  copyScheduledAnalysisJob(id: string) {
    return this.postJson<Record<string, unknown>>(`/rag/admin/agent-ops/schedules/${encodeURIComponent(id)}/copy`, {});
  }

  listScheduledAnalysisVersions(id: string) {
    return this.getJson<Record<string, unknown>[]>(`/rag/admin/agent-ops/schedules/${encodeURIComponent(id)}/versions`);
  }

  listPlatformPlugins() {
    return this.getJson<Record<string, unknown>>('/platform-governance/plugins');
  }

  registerPlatformPlugin(body: unknown) {
    return this.postJson<Record<string, unknown>>('/platform-governance/plugins', body);
  }

  setPlatformPluginStatus(key: string, version: string, status: string) {
    return this.postJson<Record<string, unknown>>(`/platform-governance/plugins/${encodeURIComponent(key)}/${encodeURIComponent(version)}/status`, { status });
  }

  resolvePluginComposition(body: unknown) {
    return this.postJson<Record<string, unknown>>('/platform-governance/plugin-compositions/resolve', body);
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

  debugRetrieval(
    query: string,
    userId: string,
    scope?: string,
    knowledgeBaseKey?: string,
  ) {
    return this.getJson<Record<string, unknown>>(
      `/platform-governance/retrieval-debug${this.toQueryString({ query, userId: this.mapAdminUserId(userId), scope, knowledgeBaseKey })}`,
    );
  }

  async compareRetrievalProfiles(
    query: string,
    userId: string,
    scope: string | undefined,
    knowledgeBaseKey: string,
    compareKnowledgeBaseKey: string,
  ) {
    const [baseline, comparison] = await Promise.all([
      this.debugRetrieval(query, userId, scope, knowledgeBaseKey),
      this.debugRetrieval(query, userId, scope, compareKnowledgeBaseKey),
    ]);
    if (!baseline.available || !comparison.available)
      throw new ServiceUnavailableException(
        'retrieval comparison could not complete for both profiles',
      );
    return {
      query,
      generatedAt: new Date().toISOString(),
      variants: [
        { key: knowledgeBaseKey, result: baseline },
        { key: compareKnowledgeBaseKey, result: comparison },
      ],
    };
  }

  createArtifact(body: RagArtifactCreateInput) {
    return this.postJson<Record<string, unknown>>("/rag/admin/artifacts", {
      ...body,
      ownerUserId: this.mapAdminUserId(body.ownerUserId),
    });
  }

  listArtifacts(ownerUserId: string, threadId?: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/artifacts${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId), threadId })}`
    );
  }

  getArtifact(id: string, ownerUserId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/artifacts/${encodeURIComponent(id)}${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`
    );
  }

  downloadArtifact(id: string, ownerUserId: string) {
    return this.requestRaw(
      `/rag/admin/artifacts/${encodeURIComponent(id)}/download${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      true
    );
  }

  createArtifactShare(id: string, ownerUserId: string, body: unknown) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/artifacts/${encodeURIComponent(id)}/shares${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      this.mapAdminActorField(body, "createdBy")
    );
  }

  listArtifactShares(id: string, ownerUserId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/artifacts/${encodeURIComponent(id)}/shares${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`
    );
  }

  revokeArtifactShare(id: string, shareId: string, ownerUserId: string) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/artifacts/${encodeURIComponent(id)}/shares/${encodeURIComponent(shareId)}/revoke${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      {}
    );
  }

  getInternalArtifactShare(token: string, actorUserId: string) {
    return this.request<Record<string, unknown>>(
      `/rag/admin/artifacts/shared/${encodeURIComponent(token)}/internal`,
      { method: "GET", headers: { "x-actor-user-id": this.mapAdminUserId(actorUserId) ?? actorUserId } }
    );
  }

  downloadInternalArtifactShare(token: string, actorUserId: string) {
    return this.requestRaw(
      `/rag/admin/artifacts/shared/${encodeURIComponent(token)}/internal/download`,
      true,
      { "x-actor-user-id": this.mapAdminUserId(actorUserId) ?? actorUserId }
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

  streamAgui(query: RagAguiStreamQuery, signal: AbortSignal) {
    const params = new URLSearchParams({
      query: query.query,
      mode: query.mode ?? "agentic",
      model: query.model ?? "qwen",
      userId: this.mapAdminUserId(query.userId) || "",
    });
    if (query.threadId) {
      params.set("threadId", query.threadId);
    }
    if (query.rolePresetId) {
      params.set("rolePresetId", query.rolePresetId);
    }
    if (query.pluginKeys?.length) {
      params.set("pluginKeys", query.pluginKeys.join(","));
    }
    if (query.attachmentIds?.length) {
      params.set("attachmentIds", query.attachmentIds.join(","));
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

  uploadQaConversationAttachment(
    file: Express.Multer.File,
    userId: string,
    threadId: string,
  ) {
    const formData = new FormData();
    const fileBytes = new Uint8Array(file.buffer.byteLength);
    fileBytes.set(file.buffer);
    formData.append(
      "file",
      new Blob([fileBytes.buffer], { type: file.mimetype }),
      file.originalname,
    );
    formData.append("userId", this.mapAdminUserId(userId) ?? userId);
    formData.append("threadId", threadId);
    return this.request<Record<string, unknown>>(
      "/agui/admin/attachments",
      { method: "POST", body: formData },
      true,
      120_000,
    );
  }

  listQaConversationAttachments(userId: string, threadId: string) {
    return this.getJson<Record<string, unknown>[]>(
      `/agui/admin/attachments${this.toQueryString({ userId: this.mapAdminUserId(userId), threadId })}`,
    );
  }

  deleteQaConversationAttachment(
    attachmentId: string,
    userId: string,
    threadId: string,
  ) {
    return this.deleteJson<Record<string, unknown>>(
      `/agui/admin/attachments/${encodeURIComponent(attachmentId)}${this.toQueryString({ userId: this.mapAdminUserId(userId), threadId })}`,
    );
  }

  deleteQaConversationAttachments(userId: string, threadId: string) {
    return this.deleteJson<Record<string, unknown>>(
      `/agui/admin/attachments${this.toQueryString({ userId: this.mapAdminUserId(userId), threadId })}`,
    );
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

  async getJson<T>(
    path: string,
    timeoutMs = this.timeoutMs,
  ): Promise<RagClientResult<T>> {
    return this.request<T>(path, { method: "GET" }, true, timeoutMs);
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
    signal?: AbortSignal,
  ): Promise<Response> {
    const controller = signal ? undefined : new AbortController();
    const timeout = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;
    const headers = { ...extraHeaders };
    if (authenticated && this.serviceToken) {
      headers["Authorization"] = `Bearer ${this.serviceToken}`;
    }
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body,
        signal: signal ?? controller?.signal,
      });
    } finally {
      if (timeout) clearTimeout(timeout);
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
