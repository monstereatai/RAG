import type { RetrievedChunk } from '../evidence/retrieval.types';
import type { QueryTaskType } from '../planning/query-plan';

import type {
  RetrievalIntent,
  RetrievalProfile,
} from '../evidence/retrieval.types';
export type {
  RetrievalIntent,
  RetrievalProfile,
} from '../evidence/retrieval.types';

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

export function retrievalProfileForTaskType(
  taskType: QueryTaskType,
): RetrievalProfile {
  return taskType === 'synthesis' ? PROFILES.generation : PROFILES[taskType];
}

export class ContextBuilder {
  /** 去重并限制单文档占比后，再按相关性、多样性和字符预算挑选生成上下文。 */
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

    const mmrOrdered = query
      ? applyLexicalMmr(diversified, query)
      : diversified;
    const attachmentPrimaries = new Map<string, RetrievedChunk>();
    for (const chunk of diversified) {
      if (
        chunk.retrievalSource === 'attachment' &&
        !attachmentPrimaries.has(chunk.docId)
      ) {
        attachmentPrimaries.set(chunk.docId, chunk);
      }
    }
    const attachmentIds = new Set(
      [...attachmentPrimaries.values()].map((chunk) => chunk.id),
    );
    const ordered = [
      ...attachmentPrimaries.values(),
      ...mmrOrdered.filter((chunk) => !attachmentIds.has(chunk.id)),
    ];
    const selectionLimit = Math.min(
      profile.candidateDepth,
      Math.max(profile.finalTopK, attachmentPrimaries.size + 2),
    );
    const contextCharacterBudget = attachmentPrimaries.size
      ? Math.max(
          profile.contextCharacterBudget,
          Math.min(
            10_000,
            profile.contextCharacterBudget + attachmentPrimaries.size * 1_900,
          ),
        )
      : profile.contextCharacterBudget;
    const selected: RetrievedChunk[] = [];
    let usedCharacters = 0;
    let budgetRemoved = 0;
    for (const chunk of ordered) {
      if (selected.length >= selectionLimit) {
        budgetRemoved += 1;
        continue;
      }
      const estimated = chunk.content.length + 32;
      if (
        selected.length > 0 &&
        usedCharacters + estimated > contextCharacterBudget
      ) {
        budgetRemoved += 1;
        continue;
      }
      selected.push(chunk);
      usedCharacters += estimated;
    }

    // 排序可以改变片段位置，但传给生成器的内容必须保持原文完整，
    // 避免按关键词删句时把否定、例外或适用条件一并删掉。
    const arranged = arrangeForLongContext(selected);
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
              jaccard(
                tokenizeForMmr(candidate.content),
                tokenizeForMmr(item.content),
              ),
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
