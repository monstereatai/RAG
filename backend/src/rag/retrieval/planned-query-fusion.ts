export type PlannedFusionQueryKind = 'original' | 'standalone' | 'sub_query';

export interface PlannedFusionQuery {
  kind: PlannedFusionQueryKind;
  text: string;
  weight: number;
}

export interface PlannedFusionCandidate {
  id: string;
  totalScore: number;
  rerankScore?: number;
  sourceAuthorityWeight?: number;
}

export interface PlannedFusionRun<TCandidate extends PlannedFusionCandidate> {
  chunks: TCandidate[];
  vectorSource?: 'milvus' | 'elasticsearch' | 'none';
}

export interface PlannedQueryFusionResult<
  TCandidate extends PlannedFusionCandidate,
  TRun extends PlannedFusionRun<TCandidate>,
> {
  chunks: TCandidate[];
  fusedCandidateCount: number;
  duplicateChunksRemoved: number;
  primaryResult?: TRun;
  vectorSource: 'milvus' | 'elasticsearch' | 'none';
  plannedQueries: Array<{
    kind: PlannedFusionQueryKind;
    query: string;
    weight: number;
    status: 'success' | 'failed';
    candidates: number;
    error?: string;
  }>;
  failures: Array<{ kind: PlannedFusionQueryKind; message: string }>;
}

/**
 * 合并多路检索结果：按每路排名和权重累加分数，按 chunk id 去重，
 * 保留原有稳定排序规则，并把会话附件证据追加到融合结果末尾。
 */
export function fusePlannedQueryRuns<
  TCandidate extends PlannedFusionCandidate,
  TRun extends PlannedFusionRun<TCandidate>,
>(input: {
  queries: PlannedFusionQuery[];
  queryRuns: PromiseSettledResult<TRun>[];
  supplementalEvidence?: TCandidate[];
  rankScore: (rank: number) => number;
}): PlannedQueryFusionResult<TCandidate, TRun> {
  const fused = new Map<string, { chunk: TCandidate; score: number }>();
  const plannedQueries: PlannedQueryFusionResult<
    TCandidate,
    TRun
  >['plannedQueries'] = [];
  const failures: PlannedQueryFusionResult<TCandidate, TRun>['failures'] = [];
  let primaryResult: TRun | undefined;
  let vectorSource: PlannedQueryFusionResult<TCandidate, TRun>['vectorSource'] =
    'none';

  input.queryRuns.forEach((result, queryIndex) => {
    const plannedQuery = input.queries[queryIndex];
    if (result.status === 'rejected') {
      const message =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      failures.push({ kind: plannedQuery.kind, message });
      plannedQueries.push({
        kind: plannedQuery.kind,
        query: plannedQuery.text,
        weight: plannedQuery.weight,
        status: 'failed',
        candidates: 0,
        error: message.slice(0, 300),
      });
      return;
    }

    if (plannedQuery.kind === 'original' || !primaryResult) {
      primaryResult = result.value;
    }
    if (result.value.vectorSource === 'milvus') vectorSource = 'milvus';
    else if (
      vectorSource === 'none' &&
      result.value.vectorSource === 'elasticsearch'
    ) {
      vectorSource = 'elasticsearch';
    }
    plannedQueries.push({
      kind: plannedQuery.kind,
      query: plannedQuery.text,
      weight: plannedQuery.weight,
      status: 'success',
      candidates: result.value.chunks.length,
    });

    result.value.chunks.forEach((chunk, rank) => {
      const contribution =
        input.rankScore(rank) *
        plannedQuery.weight *
        (chunk.sourceAuthorityWeight ?? 1);
      const current = fused.get(chunk.id);
      if (!current) {
        fused.set(chunk.id, { chunk, score: contribution });
        return;
      }
      current.score += contribution;
      if (chunk.totalScore > current.chunk.totalScore) {
        current.chunk = chunk;
      }
    });
  });

  const chunks: TCandidate[] = [...fused.values()]
    .map(({ chunk, score }) => ({
      ...chunk,
      totalScore: score,
      rerankScore: undefined,
    }))
    .sort((left, right) => right.totalScore - left.totalScore);
  for (const chunk of input.supplementalEvidence ?? []) {
    if (!chunks.some((item) => item.id === chunk.id)) {
      chunks.push(chunk);
    }
  }

  const fulfilledCandidateCount = input.queryRuns.reduce(
    (sum, result) =>
      sum + (result.status === 'fulfilled' ? result.value.chunks.length : 0),
    0,
  );

  return {
    chunks,
    fusedCandidateCount: fused.size,
    duplicateChunksRemoved: fulfilledCandidateCount - fused.size,
    primaryResult,
    vectorSource,
    plannedQueries,
    failures,
  };
}
