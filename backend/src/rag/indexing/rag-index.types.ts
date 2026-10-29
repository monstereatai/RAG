import type { Bm25PersistedEntry } from './bm25-store';

export type RagChunkMetadata = Omit<
  Bm25PersistedEntry,
  'id' | 'content' | 'docId' | 'chunkIndex' | 'tokens' | 'userId'
>;

export type RagIndexedChunkMeta = Pick<
  Bm25PersistedEntry,
  'content' | 'docId' | 'chunkIndex' | 'userId'
> &
  RagChunkMetadata;

export type RankedRetrievalHit = Pick<
  Bm25PersistedEntry,
  'id' | 'content' | 'docId' | 'chunkIndex'
> &
  RagChunkMetadata & { score: number };
