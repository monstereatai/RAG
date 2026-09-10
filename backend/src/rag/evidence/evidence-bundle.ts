import type {
  RetrievalDiagnostics,
  RetrievedChunk,
} from '../karpathy/karpathy-rag.service';

/** 请求级证据来源策略。它是外网工具是否可以执行的唯一授权依据。 */
export type EvidenceSourcePolicy =
  | 'direct_answer'
  | 'local_only'
  | 'web_allowed';

export interface EvidenceAssessment {
  sufficient: boolean;
  reason: string;
  /** 充分性必须针对该查询判断，防止子问题覆盖原问题的结论。 */
  evaluatedQuery: string;
}

/**
 * 单次用户请求的权威本地证据快照。
 *
 * 检索、Simple、Auto 和 Agentic 都传递这个对象，而不是重复以不同问题文本
 * 对同一批片段做互相矛盾的充分性判断。
 */
export interface EvidenceBundle {
  query: string;
  chunks: RetrievedChunk[];
  assessment: EvidenceAssessment;
  sourcePolicy: EvidenceSourcePolicy;
  diagnostics?: RetrievalDiagnostics;
}

export function createEvidenceBundle(input: EvidenceBundle): EvidenceBundle {
  return {
    ...input,
    query: input.query.trim(),
    chunks: dedupeEvidence(input.chunks),
    assessment: {
      ...input.assessment,
      evaluatedQuery: input.assessment.evaluatedQuery.trim(),
    },
  };
}

/** local_only 永远优先于检索质量，禁止把本地资料请求泄露到公网。 */
export function canUseWebFallback(bundle: EvidenceBundle): boolean {
  return !bundle.assessment.sufficient && bundle.sourcePolicy === 'web_allowed';
}

/** 原查询只能复用由它产生的结论；子问题必须独立补证。 */
export function appliesToQuery(bundle: EvidenceBundle, query: string): boolean {
  return normalize(bundle.assessment.evaluatedQuery) === normalize(query);
}

function dedupeEvidence(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const candidates = new Map<string, RetrievedChunk>();
  for (const chunk of chunks) {
    const existing = candidates.get(chunk.id);
    if (!existing || chunk.totalScore > existing.totalScore) {
      candidates.set(chunk.id, chunk);
    }
  }
  return [...candidates.values()].sort((a, b) => b.totalScore - a.totalScore);
}

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '').trim().toLowerCase();
}
