export interface CapabilitiesResponse {
  vectorStore: { provider: string; available: boolean };
  bm25: { available: boolean; engine: string };
  elasticsearch: { available: boolean };
  rerank: { available: boolean; provider: string };
  graphRag: { available: boolean };
  mcp: { available: boolean };
  mem0: { available: boolean };
  redis: { available: boolean };
  speech: { available: boolean };
  agui: { available: boolean; endpoint: string };
  langSmith: { available: boolean; tracing: boolean; project: string };
  evaluation: { available: boolean; scripts: string[] };
  webSearch: { available: boolean };
  embedding: { provider: string; available: boolean };
}

export interface VectorIndexResponse {
  provider: string;
  collectionName: string;
  indexType: string;
  metricType: string;
  chunkCount: number;
  status: 'healthy' | 'degraded' | 'unavailable';
  statusReason: string | null;
  circuitState: 'closed' | 'open' | 'half_open';
  consecutiveFailures: number;
  lastFailureAt: string | null;
  circuitOpenUntil: string | null;
  params: Record<string, number | string>;
}

export interface EvaluationSummary {
  datasetName: string;
  mode: string;
  passed: boolean;
  averageScore: number;
  totalSamples: number;
  refusalRate?: number;
  citationRate: number;
  available?: boolean;
  reason?: string;
  outcome?: 'passed' | 'failed' | 'skipped' | 'unavailable';
  failedSamples?: number;
  synthetic?: boolean;
  retrievalMetrics?: { hitRate: number; mrr: number; ndcg: number };
  latencyMs?: { average: number; p95: number };
  estimatedCostByModeAndVariant?: Record<string, unknown>;
  pairedComparison?: Record<string, unknown>;
}

export interface ConversationSummary {
  threadId: string;
  title: string;
  mode: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export type IndexAuditStatus =
  | 'ok'
  | 'mismatch'
  | 'unavailable'
  | 'skipped'
  | 'unverified';

export type IndexAuditCheck = {
  status: IndexAuditStatus;
  expected?: number;
  actual?: number;
  documentCount?: number;
  sourcePresent?: boolean;
  expectedContentHash?: string;
  actualContentHashes?: string[];
  expectedIndexGeneration?: string;
  actualIndexGenerations?: string[];
  persistenceReason?: string;
  expectedChunkLifecycleStatuses?: string[];
  actualChunkLifecycleStatuses?: string[];
  expectedDocumentLifecycleStatus?: string | null;
  actualDocumentLifecycleStatuses?: string[];
  pgCount?: number;
  milvusCount?: number;
  missingCount?: number;
  staleCount?: number;
  missingPgCount?: number;
  stalePgCount?: number;
  missingMilvusCount?: number;
  staleMilvusCount?: number;
  contentMismatchCount?: number;
  sourceMappingMismatchCount?: number;
  docVersion?: string | null;
  indexGeneration?: string | null;
  lifecycleStatus?: string | null;
  reviewStatus?: string | null;
  effectiveAt?: Date | null;
  expiredAt?: Date | null;
  reason?: string;
};

export interface DocumentSearchFilters {
  fileType?: string;
  updatedRange?: 'day' | 'week' | 'month';
  documentType?: string;
  role?: string;
}

export interface DocumentAdminItem {
  docId: string;
  filename: string;
  chunkCount: number;
  userId: string;
  category: string;
  sourceAuthority: string;
  docVersion: string;
  effectiveAt: string | null;
  expiredAt: string | null;
  createdAt: string;
  obsidianPath?: string | null;
  obsidianStatus?: 'linked' | 'missing';
}

export interface DocumentIndexAuditIssue {
  docId: string;
  filename: string;
  chunkCount: number;
  lifecycleStatus: string;
  reviewStatus: string | null;
  graphIndexStatus: string;
  checks: Record<string, IndexAuditCheck>;
  reasons: string[];
}

export interface DocumentIndexAuditResult {
  available: boolean;
  scanned: number;
  nextCursor: { createdAt: string; docId: string } | null;
  issueCount: number;
  counts: Record<string, number>;
  issues: DocumentIndexAuditIssue[];
  checks: DocumentIndexAuditIssue[];
  repairActions: string[];
}
