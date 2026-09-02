import { authRequest } from "@/services/rag-admin/api";

export type ProductionRole =
  | "product"
  | "design"
  | "frontend"
  | "backend"
  | "qa"
  | "operations";

export interface ProductionStageResult {
  role: ProductionRole;
  revision: number;
  reviewStatus: "pending" | "approved" | "rejected" | "stale";
  summary: string;
  deliverables: Array<{ type: string; title: string; markdown: string }>;
  claims: Array<{
    statement: string;
    evidenceIds: string[];
    status: "supported" | "pending_confirmation";
  }>;
  evidence: Array<{
    id: string;
    docId: string;
    chunkIndex: number;
    excerpt: string;
    totalScore: number;
  }>;
  evidenceCoverage: number;
  issues: string[];
  downstreamRisks: string[];
  riskLevel: "low" | "medium" | "high";
  toolExecutions: Array<{
    tool: string;
    status: "success" | "degraded" | "failed";
    durationMs: number;
    evidenceCount: number;
    fallback?: string;
    error?: string;
  }>;
  generatedArtifact?: {
    id: string;
    title: string;
    kind: string;
    status: string;
  };
  readyForApproval: boolean;
  completedAt: string;
}

export interface ProductionWorkflow {
  threadId: string;
  projectId: string;
  pluginKeys?: string[];
  pluginTools?: string[];
  currentRole: ProductionRole;
  selectedRoles: ProductionRole[];
  executionBatches: ProductionRole[][];
  batchIndex: number;
  currentBatch: ProductionRole[];
  completedRoles: ProductionRole[];
  stageIndex: number;
  stepCount: number;
  maxSteps: number;
  approvalMode: "auto" | "required" | "risk_based";
  approvalRoles: ProductionRole[];
  riskApprovalThreshold: "medium" | "high";
  pendingApprovalRoles: ProductionRole[];
  status: "running" | "pending_approval" | "revision_required" | "completed" | "failed";
  rerunRoles: ProductionRole[];
  staleRoles: ProductionRole[];
  revisionNumber: number;
  revisionHistory: Array<{
    revision: number;
    rejectedAt: string;
    feedback: string;
    rejectedRoles: ProductionRole[];
    staleRoles: ProductionRole[];
    supplementalMaterials?: string;
    revisedAt?: string;
    rerunRoles?: ProductionRole[];
    results: Partial<Record<ProductionRole, ProductionStageResult>>;
  }>;
  feedback: string;
  supplementalMaterials?: string;
  results: Partial<Record<ProductionRole, ProductionStageResult>>;
  error: string;
  requiresApproval: boolean;
  requiresRevision: boolean;
}

export interface AgentEvalResult {
  passed: boolean;
  metrics: Record<string, number>;
  assertions: {
    unsupportedClaims: string[];
    missingRequirements: string[];
    missingTestCaseSections: string[];
  };
}

export interface AgentBadCase {
  id: string;
  query?: string;
  answer?: string;
  feedback: "negative";
  errorType?: string | null;
  comment?: string | null;
  correctedAnswer?: string | null;
  status: "pending" | "reviewed" | "resolved" | "ignored";
  includeInRegression: boolean;
  knowledgeLayer: "correction" | "formal" | "inactive";
  promotionStatus: "not_requested" | "pending" | "promoted" | "rejected";
  promotionSource?: string | null;
  promotedDocId?: string | null;
  promotedAt?: string | null;
  createdAt: string;
  indexing?: {
    indexed?: boolean;
    removed?: boolean;
    reason?: string;
  };
}

export interface TraceSnapshot {
  traceId: string;
  spanId: string;
  method: string;
  route: string;
  status: number;
  durationMs: number;
  startedAt: string;
}

export interface ScheduledAnalysisConfig {
  window: "today" | "week" | "month";
  dataScopes: Array<"rules" | "complaints" | "qa" | "workflow">;
  roles: string[];
  departments: string[];
}

export interface ScheduledAnalysisJob {
  id: string;
  name?: string | null;
  type: "cron" | "every" | "at";
  taskKind: "analysis";
  sourceType: "natural_language" | "markdown";
  instruction: string;
  analysisConfig: string;
  enabled: boolean;
  running: boolean;
  cron?: string | null;
  everyMs?: number | null;
  at?: string | null;
  lastRun?: string | null;
  lastResult?: string | null;
  lastError?: string | null;
  lastDurationMs?: number | null;
  nextRunAt?: string | null;
  createdAt: string;
  versionGroupId?: string | null;
  version?: number;
  isCurrent?: boolean;
  copiedFromId?: string | null;
}

export interface ScheduledAnalysisExecution {
  id: string;
  jobId: string;
  status: "running" | "completed" | "failed";
  result?: string | null;
  errorMessage?: string | null;
  durationMs?: number | null;
  startedAt: string;
}

export interface ParsedScheduledAnalysis {
  name: string;
  type: "cron" | "every" | "at";
  cron?: string;
  everyMs?: number;
  at?: string;
  sourceType: "natural_language" | "markdown";
  instruction: string;
  analysisConfig: ScheduledAnalysisConfig;
}

export interface AgenticArtifact {
  id: string;
  type:
    | "subquestion_plan"
    | "evidence_bundle"
    | "answer_contract"
    | "requirement_brief"
    | "assumption_register"
    | "claim_evidence_matrix"
    | "solution_brief"
    | "api_contract"
    | "event_tracking_plan"
    | "test_plan"
    | "acceptance_checklist"
    | "risk_register"
    | "rollout_plan"
    | "code_context_pack";
  version: number;
  producer: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface AgenticRunSnapshot {
  available: boolean;
  threadId: string;
  checkpointId: string | null;
  updatedAt: string | null;
  route: "simple" | "agentic" | null;
  subQuestions: Array<Record<string, unknown>>;
  artifacts: AgenticArtifact[];
  retrievalSufficient: boolean | null;
  retrievalReason: string | null;
  retryCount: number | null;
  passed: boolean | null;
}

export interface AgenticRunOption {
  threadId: string;
  title: string;
  mode: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  checkpointAvailable: boolean;
  route: "simple" | "agentic" | null;
  retrievalSufficient: boolean | null;
}

export const startProductionWorkflow = (body: {
  projectId: string;
  brief: string;
  maxSteps?: number;
  approvalMode?: "auto" | "required" | "risk_based";
  roles?: ProductionRole[];
  approvalRoles?: ProductionRole[];
  riskApprovalThreshold?: "medium" | "high";
}) =>
  authRequest<unknown>("/api/admin/agent-ops/workflows", {
    method: "POST",
    data: body,
  });

export const resumeProductionWorkflow = (
  threadId: string,
  body: {
    approval: "approved" | "rejected";
    feedback?: string;
    rerunRoles?: ProductionRole[];
  },
) =>
  authRequest<unknown>(
    `/api/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/resume`,
    { method: "POST", data: body },
  );

export const reviseProductionWorkflow = (
  threadId: string,
  body: { rerunRoles?: ProductionRole[]; supplementalMaterials?: string },
) =>
  authRequest<unknown>(
    `/api/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/revise`,
    { method: "POST", data: body },
  );

export const getProductionWorkflow = (threadId: string) =>
  authRequest<unknown>(
    `/api/admin/agent-ops/workflows/${encodeURIComponent(threadId)}`,
  );

export const getProductionWorkflowCodingContext = (threadId: string) =>
  authRequest<unknown>(
    `/api/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/coding-context`,
  );

export const generateProductionWorkflowProject = (threadId: string) =>
  authRequest<unknown>(
    `/api/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/generate-project`,
    { method: "POST", data: {} },
  );

export const downloadProductionWorkflowProjectZip = (threadId: string) =>
  fetch(`/api/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/generate-project-zip`, {
    method: "POST",
    headers: { Authorization: `Bearer ${localStorage.getItem("access_token") ?? ""}` },
  });

export const getProductionWorkflows = () =>
  authRequest<unknown[]>('/api/admin/agent-ops/workflows');

export const evaluateAgent = (body: Record<string, unknown>) =>
  authRequest<unknown>("/api/admin/agent-ops/evals", {
    method: "POST",
    data: body,
  });

export const getAgentBadCases = (status?: string) =>
  authRequest<unknown>("/api/admin/agent-ops/bad-cases", {
    params: status ? { status } : undefined,
  });

export const reviewAgentBadCase = (id: string, body: Record<string, unknown>) =>
  authRequest<unknown>(
    `/api/admin/agent-ops/bad-cases/${encodeURIComponent(id)}`,
    { method: "PATCH", data: body },
  );

export const getAgentTraces = () =>
  authRequest<unknown>("/api/admin/agent-ops/traces", {
    params: { limit: 50 },
  });

export const getRuntimeEvents = (threadId?: string, runId?: string) =>
  authRequest<unknown>("/api/admin/agent-ops/runtime-events", { params: { threadId, runId } });

export const getRuntimeEventMetrics = (threadId?: string, runId?: string) =>
  authRequest<unknown>("/api/admin/agent-ops/runtime-events/metrics", { params: { threadId, runId } });

export const getScheduledAnalysisJobs = () =>
  authRequest<unknown>("/api/admin/agent-ops/schedules");

export const parseScheduledAnalysisJob = (body: {
  sourceText: string;
  sourceType: "natural_language" | "markdown";
}) => authRequest<unknown>("/api/admin/agent-ops/schedules/parse", { method: "POST", data: body });

export const createScheduledAnalysisJob = (body: Record<string, unknown>) =>
  authRequest<unknown>("/api/admin/agent-ops/schedules", { method: "POST", data: body });

export const runScheduledAnalysisJob = (id: string) =>
  authRequest<unknown>(`/api/admin/agent-ops/schedules/${encodeURIComponent(id)}/run`, { method: "POST", data: {} });

export const startScheduledAnalysisJob = (id: string) =>
  authRequest<unknown>(`/api/admin/agent-ops/schedules/${encodeURIComponent(id)}/start`, { method: "PATCH", data: {} });

export const stopScheduledAnalysisJob = (id: string) =>
  authRequest<unknown>(`/api/admin/agent-ops/schedules/${encodeURIComponent(id)}/stop`, { method: "PATCH", data: {} });

export const getScheduledAnalysisExecutions = (id: string) =>
  authRequest<unknown>(`/api/admin/agent-ops/schedules/${encodeURIComponent(id)}/executions`);
export const copyScheduledAnalysisJob = (id: string) =>
  authRequest<unknown>(`/api/admin/agent-ops/schedules/${encodeURIComponent(id)}/copy`, { method: "POST", data: {} });
export const getScheduledAnalysisVersions = (id: string) =>
  authRequest<unknown>(`/api/admin/agent-ops/schedules/${encodeURIComponent(id)}/versions`);

export const delegateAgentTask = (body: Record<string, unknown>) =>
  authRequest<unknown>("/api/admin/agent-ops/tasks/delegate", { method: "POST", data: body });

export const getAgentRunArtifacts = (threadId: string) =>
  authRequest<unknown>(
    `/api/admin/agent-ops/runs/${encodeURIComponent(threadId)}/artifacts`,
  );

export const getAgentRuns = () =>
  authRequest<unknown>("/api/admin/agent-ops/runs", {
    params: { limit: 30 },
  });

export const retryAgentRun = (threadId: string) =>
  authRequest<unknown>(
    `/api/admin/agent-ops/runs/${encodeURIComponent(threadId)}/retry`,
    { method: "POST", data: {} },
  );

export const getAgentRunCenter = () =>
  authRequest<unknown>("/api/admin/agent-ops/run-center", { params: { limit: 50 } });

export const getAgentRunDetail = (id: string) =>
  authRequest<unknown>(`/api/admin/agent-ops/run-center/${encodeURIComponent(id)}`);

export const getAgentRunDetailArtifacts = (id: string) =>
  authRequest<unknown>(`/api/admin/agent-ops/run-center/${encodeURIComponent(id)}/artifacts`);

export const getAgentRuntimeCapabilities = () =>
  authRequest<unknown>('/api/admin/agent-ops/runtime/capabilities');

export const createAgentRuntimePlan = (body: Record<string, unknown>) =>
  authRequest<unknown>('/api/admin/agent-ops/runtime/plans', { method: 'POST', data: body });

export const retryAgentRunRecord = (id: string) =>
  authRequest<unknown>(`/api/admin/agent-ops/run-center/${encodeURIComponent(id)}/retry`, { method: "POST", data: {} });

export const cloneGovernanceWorkflow = (id: string, body: { key: string; name?: string }) =>
  authRequest<unknown>(`/api/admin/agent-ops/governance/workflows/${encodeURIComponent(id)}/clone`, { method: "POST", data: body });

export const getCollaborationSops = () => authRequest<unknown>("/api/admin/agent-ops/collaboration/sops");
export const getCollaborationMessages = (threadId?: string) => authRequest<unknown>("/api/admin/agent-ops/collaboration/messages", { params: threadId ? { threadId } : undefined });
export const getArtifactDependencies = (threadId?: string) => authRequest<unknown>("/api/admin/agent-ops/collaboration/dependencies", { params: threadId ? { threadId } : undefined });
export const getDecisionRecords = (threadId?: string) => authRequest<unknown>("/api/admin/agent-ops/collaboration/decisions", { params: threadId ? { threadId } : undefined });
export const getCollaborationConflicts = (threadId: string) => authRequest<unknown>(`/api/admin/agent-ops/collaboration/conflicts/${encodeURIComponent(threadId)}`);
export const createDecisionRecord = (body: unknown) => authRequest<unknown>("/api/admin/agent-ops/collaboration/decisions", { method: "POST", data: body });
export const getCollaborationReplay = (threadId: string) => authRequest<unknown>(`/api/admin/agent-ops/collaboration/replay/${encodeURIComponent(threadId)}`);
export const getAgentTasks = (threadId?: string) => authRequest<unknown>("/api/admin/agent-ops/tasks", { params: threadId ? { threadId } : undefined });
export const retryAgentTask = (id: string) => authRequest<unknown>(`/api/admin/agent-ops/tasks/${encodeURIComponent(id)}/retry`, { method: "POST", data: {} });

export const getGovernanceWorkflows = (workspaceId?: string) =>
  authRequest<unknown>("/api/admin/agent-ops/governance/workflows", {
    params: workspaceId ? { workspaceId } : undefined,
  });

export const getGovernancePlugins = () =>
  authRequest<unknown>("/api/admin/agent-ops/governance/plugins");

export const registerGovernancePlugin = (body: Record<string, unknown>) =>
  authRequest<unknown>("/api/admin/agent-ops/governance/plugins", { method: "POST", data: body });

export const setGovernancePluginStatus = (key: string, version: string, status: string) =>
  authRequest<unknown>(`/api/admin/agent-ops/governance/plugins/${encodeURIComponent(key)}/${encodeURIComponent(version)}/status`, { method: "POST", data: { status } });

export const resolveGovernancePluginComposition = (pluginKeys: string[], mode = "production") =>
  authRequest<unknown>("/api/admin/agent-ops/governance/plugin-compositions/resolve", { method: "POST", data: { pluginKeys, mode } });

export const getGovernanceModels = () =>
  authRequest<unknown>("/api/admin/agent-ops/governance/models");

export const getGovernanceEvaluationCases = (workspaceId?: string) =>
  authRequest<unknown>("/api/admin/agent-ops/governance/evaluation-cases", {
    params: workspaceId ? { workspaceId } : undefined,
  });

export const getKnowledgeBaseProfiles = (workspaceId?: string) =>
  authRequest<unknown>("/api/admin/agent-ops/governance/knowledge-base-profiles", {
    params: workspaceId ? { workspaceId } : undefined,
  });

export const registerKnowledgeBaseProfile = (body: Record<string, unknown>) =>
  authRequest<unknown>("/api/admin/agent-ops/governance/knowledge-base-profiles", {
    method: "POST",
    data: body,
  });

export const debugGovernanceRetrieval = (query: string, scope?: string, knowledgeBaseKey?: string) =>
  authRequest<unknown>("/api/admin/agent-ops/governance/retrieval-debug", {
    params: { query, ...(scope ? { scope } : {}), ...(knowledgeBaseKey ? { knowledgeBaseKey } : {}) },
  });

export function unwrapData<T>(value: unknown): T {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (
      current &&
      typeof current === "object" &&
      "data" in current &&
      (current as { data?: unknown }).data !== undefined
    ) {
      current = (current as { data: unknown }).data;
    } else {
      break;
    }
  }
  return current as T;
}
