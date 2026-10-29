export interface RetrievedChunk {
  id: string;
  content: string;
  docId: string;
  chunkIndex: number;
  bm25Score: number;
  cosineScore: number;
  totalScore: number;
  /** DashScope 重排分（仅当 rerank 实际生效时携带） */
  rerankScore?: number;
  sourceAuthorityWeight?: number;
  parentChunkId?: string | null;
  headingPath?: string[];
  sectionId?: string | null;
  clauseId?: string | null;
  tableRef?: string | null;
  sourceStart?: number | null;
  sourceEnd?: number | null;
  docVersion?: string | null;
  effectiveAt?: string | null;
  expiredAt?: string | null;
  sourceAuthority?: string;
  projectId?: string | null;
  activityId?: string | null;
  region?: string | null;
  locale?: string | null;
  channel?: string | null;
  roleScope?: string[];
  documentType?: string;
  lifecycleStatus?: string;
  supersedesDocId?: string | null;
  ruleKey?: string | null;
  changeType?: string;
  supersedesChunkId?: string | null;
  retrievalSource?:
    | 'bm25'
    | 'vector'
    | 'hybrid'
    | 'expansion'
    | 'obsidian'
    | 'web'
    | 'attachment';
  contextRole?: 'hit' | 'neighbor' | 'section' | 'obsidian';
  /** 附件内的页码、标题或片段位置，用于回答引用展示。 */
  citationLabel?: string;
}

export interface EffectiveTimeRange {
  from: string;
  to: string;
}

export interface RetrievalScope {
  /** Document validity interval, with an exclusive upper bound. */
  effectiveTime?: EffectiveTimeRange;
  projectId?: string;
  activityId?: string;
  region?: string;
  locale?: string;
  channel?: string;
  role?: string;
  documentType?: string;
  includeDeprecated?: boolean;
}

export type RetrievalIntent =
  | 'lookup'
  | 'procedure'
  | 'comparison'
  | 'generation';

export interface RetrievalProfile {
  intent: RetrievalIntent;
  candidateDepth: number;
  finalTopK: number;
  neighborWindow: number;
  sameSectionLimit: number;
  contextCharacterBudget: number;
  maxChunksPerDocument: number;
}

export interface RetrievalDiagnostics {
  intent: RetrievalIntent;
  candidateDepth: number;
  expandedChunks: number;
  duplicateChunksRemoved: number;
  documentLimitRemoved: number;
  budgetRemoved: number;
  contextCharacters: number;
  graphProbe?: {
    attempted: boolean;
    enabled: boolean;
    merged: boolean;
    factCount: number;
    elapsedMs: number;
    skippedReason?: string;
  };
  imageProbe?: {
    attempted: boolean;
    enabled: boolean;
    merged: boolean;
    hitCount: number;
    elapsedMs: number;
    skippedReason?: string;
  };
  stages?: {
    keywordCandidates: number;
    vectorCandidates: number;
    descriptionCandidates?: number;
    descriptionSourceChunks?: number;
    fusedCandidates: number;
    scopedCandidates: number;
    finalCandidates: number;
    filteredByScope: number;
    filteredByBudget: number;
  };
  /** 本轮是否因高置信追问执行了补全问题检索。 */
  contextualQueryUsed?: boolean;
  /** Hybrid 计划检索无结果后是否执行了 BM25 兜底。 */
  retrievalFallback?: 'bm25';
  /** 统一执行计划中各查询的执行结果，便于定位单路降级。 */
  plannedQueries?: Array<{
    kind: 'original' | 'standalone' | 'sub_query';
    query: string;
    weight: number;
    status: 'success' | 'failed';
    candidates: number;
    error?: string;
  }>;
  /** 供检索实验台使用的各阶段候选快照，限制为前 50 条避免泄漏完整语料。 */
  candidates?: {
    keyword: RetrievalCandidateSnapshot[];
    vector: RetrievalCandidateSnapshot[];
    fused: RetrievalCandidateSnapshot[];
    reranked: RetrievalCandidateSnapshot[];
    rerankInput: RetrievalCandidateSnapshot[];
    context: RetrievalCandidateSnapshot[];
  };
}

export interface RetrievalCandidateSnapshot {
  id: string;
  docId: string;
  chunkIndex: number;
  score: number;
  rerankScore?: number;
  retrievalSource?: RetrievedChunk['retrievalSource'];
}

/** Vector retrieval channel used for the current query. */
export type RagVectorSource = 'milvus' | 'elasticsearch' | 'none';

export interface DetailedRetrievalResult {
  chunks: RetrievedChunk[];
  diagnostics: RetrievalDiagnostics;
  profile: RetrievalProfile;
  /** 本轮向量候选来自哪个通道（ES kNN 降级/并行通道可观测） */
  vectorSource?: RagVectorSource;
  /** 本轮是否执行了 DashScope 重排 */
  rerankApplied?: boolean;
}
