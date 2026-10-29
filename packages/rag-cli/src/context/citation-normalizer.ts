import type { SearchChunk } from '../core/schemas.js';

export interface Citation {
  id: number;
  docId?: string;
  chunkId?: string;
  title?: string;
  score?: number;
}

export function normalizeCitations(chunks: SearchChunk[]): Citation[] {
  return chunks.map((chunk, index) => ({
    id: index + 1,
    docId: chunk.docId,
    chunkId: chunk.chunkId ?? chunk.id,
    title: chunk.title ?? chunk.source?.documentName?.toString(),
    score: chunk.score ?? chunk.totalScore,
  }));
}

