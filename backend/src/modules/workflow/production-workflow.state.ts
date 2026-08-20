import { Annotation } from '@langchain/langgraph';

export const PRODUCTION_ROLES = [
  'product',
  'design',
  'frontend',
  'backend',
  'qa',
  'operations',
] as const;

export type ProductionRole = (typeof PRODUCTION_ROLES)[number];
export type ProductionWorkflowApprovalMode = 'auto' | 'required' | 'risk_based';
export type ProductionProcessType = 'sequential' | 'hierarchical' | 'conditional';
export type ProductionRiskLevel = 'low' | 'medium' | 'high';
export type WorkflowApproval = 'approved' | 'rejected' | null;
export type ProductionWorkflowStatus =
  | 'running'
  | 'pending_approval'
  | 'completed'
  | 'failed';

export interface ProductionStageResult {
  role: ProductionRole;
  summary: string;
  deliverables: ProductionDeliverable[];
  claims: ProductionClaim[];
  evidence: ProductionEvidence[];
  evidenceCoverage: number;
  issues: string[];
  downstreamRisks: string[];
  riskLevel: ProductionRiskLevel;
  toolExecutions: ProductionToolExecution[];
  generatedArtifact?: ProductionGeneratedArtifact;
  readyForApproval: boolean;
  completedAt: string;
}

export interface ProductionDeliverable {
  type: string;
  title: string;
  markdown: string;
}

export interface ProductionClaim {
  statement: string;
  evidenceIds: string[];
  status: 'supported' | 'pending_confirmation';
}

export interface ProductionEvidence {
  id: string;
  docId: string;
  chunkIndex: number;
  excerpt: string;
  totalScore: number;
  headingPath?: string[];
  sourceStart?: number | null;
  sourceEnd?: number | null;
  docVersion?: string | null;
}

export interface ProductionToolExecution {
  tool: string;
  status: 'success' | 'degraded' | 'failed' | 'blocked';
  durationMs: number;
  evidenceCount: number;
  fallback?: string;
  error?: string;
}

export interface ProductionGeneratedArtifact {
  id: string;
  title: string;
  kind: string;
  status: string;
}

export const ProductionWorkflowState = Annotation.Root({
  threadId: Annotation<string>({
    reducer: (_previous, next) => next,
    default: () => '',
  }),
  projectId: Annotation<string>({
    reducer: (_previous, next) => next,
    default: () => '',
  }),
  userId: Annotation<string>({
    reducer: (_previous, next) => next,
    default: () => '',
  }),
  runId: Annotation<string>({
    reducer: (_previous, next) => next,
    default: () => '',
  }),
  pluginKeys: Annotation<string[]>({
    reducer: (_previous, next) => next,
    default: () => [],
  }),
  pluginTools: Annotation<string[]>({
    reducer: (_previous, next) => next,
    default: () => [],
  }),
  brief: Annotation<string>({
    reducer: (_previous, next) => next,
    default: () => '',
  }),
  processType: Annotation<ProductionProcessType>({
    reducer: (_previous, next) => next,
    default: () => 'sequential',
  }),
  currentRole: Annotation<ProductionRole>({
    reducer: (_previous, next) => next,
    default: () => 'product',
  }),
  selectedRoles: Annotation<ProductionRole[]>({
    reducer: (_previous, next) => next,
    default: () => [...PRODUCTION_ROLES],
  }),
  executionBatches: Annotation<ProductionRole[][]>({
    reducer: (_previous, next) => next,
    default: () => [],
  }),
  batchIndex: Annotation<number>({
    reducer: (_previous, next) => next,
    default: () => 0,
  }),
  currentBatch: Annotation<ProductionRole[]>({
    reducer: (_previous, next) => next,
    default: () => [],
  }),
  completedRoles: Annotation<ProductionRole[]>({
    reducer: (_previous, next) => next,
    default: () => [],
  }),
  stageIndex: Annotation<number>({
    reducer: (_previous, next) => next,
    default: () => 0,
  }),
  stepCount: Annotation<number>({
    reducer: (_previous, next) => next,
    default: () => 0,
  }),
  maxSteps: Annotation<number>({
    reducer: (_previous, next) => next,
    default: () => 18,
  }),
  approvalMode: Annotation<ProductionWorkflowApprovalMode>({
    reducer: (_previous, next) => next,
    default: () => 'auto',
  }),
  approvalRoles: Annotation<ProductionRole[]>({
    reducer: (_previous, next) => next,
    default: () => [],
  }),
  riskApprovalThreshold: Annotation<ProductionRiskLevel>({
    reducer: (_previous, next) => next,
    default: () => 'high',
  }),
  pendingApprovalRoles: Annotation<ProductionRole[]>({
    reducer: (_previous, next) => next,
    default: () => [],
  }),
  rerunRoles: Annotation<ProductionRole[]>({
    reducer: (_previous, next) => next,
    default: () => [],
  }),
  status: Annotation<ProductionWorkflowStatus>({
    reducer: (_previous, next) => next,
    default: () => 'running',
  }),
  approval: Annotation<WorkflowApproval>({
    reducer: (_previous, next) => next,
    default: () => null,
  }),
  feedback: Annotation<string>({
    reducer: (_previous, next) => next,
    default: () => '',
  }),
  results: Annotation<Partial<Record<ProductionRole, ProductionStageResult>>>({
    reducer: (previous, next) => ({ ...previous, ...next }),
    default: () => ({}),
  }),
  error: Annotation<string>({
    reducer: (_previous, next) => next,
    default: () => '',
  }),
});

export type ProductionWorkflowStateType = typeof ProductionWorkflowState.State;
