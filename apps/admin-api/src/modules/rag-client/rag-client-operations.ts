import { ServiceUnavailableException } from "@nestjs/common";
import { RagClientWorkflowBase } from './rag-client-workflows';

export abstract class RagClientOperationsBase extends RagClientWorkflowBase {
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
}
