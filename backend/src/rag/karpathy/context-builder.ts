import type { RetrievedChunk } from './karpathy-rag.service';

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

export interface ContextBuildResult {
  chunks: RetrievedChunk[];
  context: string;
  stats: {
    inputChunks: number;
    duplicateChunksRemoved: number;
    documentLimitRemoved: number;
    budgetRemoved: number;
    contextCharacters: number;
  };
}

const PROFILES: Record<RetrievalIntent, RetrievalProfile> = {
  lookup: {
    intent: 'lookup',
    candidateDepth: 8,
    finalTopK: 4,
    neighborWindow: 0,
    sameSectionLimit: 0,
    contextCharacterBudget: 3_500,
    maxChunksPerDocument: 2,
  },
  procedure: {
    intent: 'procedure',
    candidateDepth: 12,
    finalTopK: 6,
    neighborWindow: 1,
    sameSectionLimit: 1,
    contextCharacterBudget: 6_000,
    maxChunksPerDocument: 4,
  },
  comparison: {
    intent: 'comparison',
    candidateDepth: 16,
    finalTopK: 8,
    neighborWindow: 1,
    sameSectionLimit: 1,
    contextCharacterBudget: 8_000,
    maxChunksPerDocument: 3,
  },
  generation: {
    intent: 'generation',
    candidateDepth: 20,
    finalTopK: 8,
    neighborWindow: 1,
    sameSectionLimit: 2,
    contextCharacterBudget: 10_000,
    maxChunksPerDocument: 5,
  },
};

export function detectRetrievalProfile(query: string): RetrievalProfile {
  if (/(对比|比较|差异|区别|不同版本|去年|历史版本|地区差异)/.test(query)) {
    return PROFILES.comparison;
  }
  if (
    /(生成|设计|方案|矩阵|完整清单|技术拆解|怎么规划|有哪些风险)/.test(query)
  ) {
    return PROFILES.generation;
  }
  if (/(流程|步骤|如何|怎么做|验收|测试|上线|排查|处理)/.test(query)) {
    return PROFILES.procedure;
  }
  return PROFILES.lookup;
}

export class ContextBuilder {
  build(
    chunks: RetrievedChunk[],
    profile: RetrievalProfile,
    query?: string,
  ): ContextBuildResult {
    const seen = new Set<string>();
    const unique: RetrievedChunk[] = [];
    let duplicateChunksRemoved = 0;

    for (const chunk of chunks) {
      const key = normalizeForDedup(chunk.content);
      if (!key || seen.has(key)) {
        duplicateChunksRemoved += 1;
        continue;
      }
      seen.add(key);
      unique.push(chunk);
    }

    const perDocument = new Map<string, number>();
    const diversified: RetrievedChunk[] = [];
    let documentLimitRemoved = 0;
    for (const chunk of unique) {
      const count = perDocument.get(chunk.docId) ?? 0;
      if (count >= profile.maxChunksPerDocument) {
        documentLimitRemoved += 1;
        continue;
      }
      perDocument.set(chunk.docId, count + 1);
      diversified.push(chunk);
    }

    const mmrOrdered = query ? applyLexicalMmr(diversified, query) : diversified;
    const selected: RetrievedChunk[] = [];
    let usedCharacters = 0;
    let budgetRemoved = 0;
    for (const chunk of mmrOrdered) {
      if (selected.length >= profile.finalTopK) {
        budgetRemoved += 1;
        continue;
      }
      const estimated = chunk.content.length + 32;
      if (
        selected.length > 0 &&
        usedCharacters + estimated > profile.contextCharacterBudget
      ) {
        budgetRemoved += 1;
        continue;
      }
      selected.push(chunk);
      usedCharacters += estimated;
    }

    const arranged = arrangeForLongContext(
      query ? selected.map((chunk) => compressChunk(chunk, query)) : selected,
    );
    const context = arranged
      .map(
        (chunk, index) =>
          `[片段 ${index + 1}｜${chunk.contextRole ?? 'hit'}]\n${chunk.content}`,
      )
      .join('\n\n---\n\n');

    return {
      chunks: arranged,
      context,
      stats: {
        inputChunks: chunks.length,
        duplicateChunksRemoved,
        documentLimitRemoved,
        budgetRemoved,
        contextCharacters: context.length,
      },
    };
  }
}

/**
 * MMR 的轻量实现：候选没有保留原始 embedding，因此用分词集合估计冗余度。
 * relevance 使用 RRF／Rerank 后的 totalScore，保留高相关片段并惩罚同质内容。
 */
function applyLexicalMmr(
  chunks: RetrievedChunk[],
  query: string,
  lambda = 0.72,
): RetrievedChunk[] {
  if (chunks.length < 2) return chunks;
  const queryTerms = tokenizeForMmr(query);
  const remaining = [...chunks];
  const selected: RetrievedChunk[] = [];
  const maxScore = Math.max(...chunks.map((chunk) => chunk.totalScore), 0.0001);

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestValue = Number.NEGATIVE_INFINITY;
    remaining.forEach((candidate, index) => {
      const relevance =
        0.5 * (candidate.totalScore / maxScore) +
        0.5 * jaccard(tokenizeForMmr(candidate.content), queryTerms);
      const redundancy = selected.length
        ? Math.max(
            ...selected.map((item) =>
              jaccard(tokenizeForMmr(candidate.content), tokenizeForMmr(item.content)),
            ),
          )
        : 0;
      const value = lambda * relevance - (1 - lambda) * redundancy;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    });
    selected.push(remaining.splice(bestIndex, 1)[0]);
  }
  return selected;
}

function tokenizeForMmr(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .flatMap((part) => (part.length > 1 ? [part] : [...part]))
      .filter(Boolean),
  );
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  left.forEach((item) => {
    if (right.has(item)) intersection += 1;
  });
  return intersection / (left.size + right.size - intersection);
}

function compressChunk(chunk: RetrievedChunk, query: string): RetrievedChunk {
  if (chunk.content.length < 900) return chunk;
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 1);
  if (terms.length === 0) return chunk;
  const sentences = chunk.content.split(/(?<=[。！？.!?])\s*/).filter(Boolean);
  const matched = sentences.filter((sentence) => {
    const text = sentence.toLowerCase();
    return terms.some((term) => text.includes(term));
  });
  if (matched.length === 0 || matched.length === sentences.length) return chunk;
  return { ...chunk, content: matched.join(' ') };
}

function arrangeForLongContext(chunks: RetrievedChunk[]): RetrievedChunk[] {
  if (chunks.length <= 2) return chunks;
  const start: RetrievedChunk[] = [];
  const end: RetrievedChunk[] = [];
  chunks.forEach((chunk, index) => {
    if (index % 2 === 0) start.push(chunk);
    else end.unshift(chunk);
  });
  return [...start, ...end];
}

function normalizeForDedup(content: string): string {
  return content
    .replace(/^章节路径：[^\n]+\n/gm, '')
    .replace(/^内容类型：[^\n]+\n/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
