import { RagClientContentBase } from './rag-client-content';
import { WORKSPACE_PREVIEW_TIMEOUT_MS } from './rag-client.constants';

export abstract class RagClientWorkflowBase extends RagClientContentBase {
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
}
