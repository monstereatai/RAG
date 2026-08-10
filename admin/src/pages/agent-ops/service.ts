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
  status: "running" | "pending_approval" | "completed" | "failed";
  feedback: string;
  results: Partial<Record<ProductionRole, ProductionStageResult>>;
  error: string;
  requiresApproval: boolean;
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

export const getProductionWorkflow = (threadId: string) =>
  authRequest<unknown>(
    `/api/admin/agent-ops/workflows/${encodeURIComponent(threadId)}`,
  );

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
