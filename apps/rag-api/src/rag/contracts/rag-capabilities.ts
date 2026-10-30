import type {
  DetailedRetrievalResult,
  RetrievedChunk,
} from '../evidence/retrieval.types';
import type { QueryTaskType } from '../planning/query-plan';
import type { RagAnswerResult, RetrieveOptions } from './rag-types';

export const RAG_QUERY_CAPABILITY = Symbol('RAG_QUERY_CAPABILITY');
export const RAG_RETRIEVAL_CAPABILITY = Symbol('RAG_RETRIEVAL_CAPABILITY');
export const RAG_INDEX_CAPABILITY = Symbol('RAG_INDEX_CAPABILITY');
export const RAG_ADMIN_CAPABILITY = Symbol('RAG_ADMIN_CAPABILITY');

export interface RagIndexChunkInput {
  id: string;
  content: string;
  docId: string;
  chunkIndex: number;
  parentChunkId?: string | null;
  headingPath?: string[];
  sectionId?: string | null;
  clauseId?: string | null;
  tableRef?: string | null;
  sourceStart?: number | null;
  sourceEnd?: number | null;
  docVersion?: string | null;
  effectiveAt?: Date | null;
  expiredAt?: Date | null;
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
  contentHash?: string | null;
  indexGeneration?: string | null;
  ruleKey?: string | null;
  changeType?: string;
  supersedesChunkId?: string | null;
  hypotheticalQuestions?: string[];
}

export interface RagChunkMetadataPatch {
  [key: string]: unknown;
  expiredAt?: string | null;
  lifecycleStatus?: string;
  ruleKey?: string | null;
  changeType?: string;
  supersedesChunkId?: string | null;
  indexGeneration?: string | null;
  docVersion?: string | null;
}

export interface RagQueryCapability {
  answer(
    query: string,
    history?: Array<{ role: 'human' | 'ai'; content: string }>,
    userId?: string,
    memoryMessages?: Array<{ role: string; content: string }>,
    onToken?: (token: string) => void,
    retrieveOptions?: RetrieveOptions,
  ): Promise<RagAnswerResult>;
  unsupportedReliableAnswer(): string;
}

export interface RagRetrievalCapability {
  retrieve(
    query: string,
    options?: RetrieveOptions,
    userId?: string,
  ): Promise<RetrievedChunk[]>;
  retrieveDetailed(
    query: string,
    options?: RetrieveOptions,
    userId?: string,
  ): Promise<DetailedRetrievalResult>;
  retrieveReviewedEvidence(
    query: string,
    limit?: number,
    userId?: string,
    tenantId?: string,
  ): Promise<RetrievedChunk[]>;
  assessRetrievedChunks(
    query: string,
    chunks: RetrievedChunk[],
    taskType?: QueryTaskType,
  ): { sufficient: boolean; reason: string };
}

export interface RagIndexCapability {
  indexChunks(chunks: RagIndexChunkInput[], userId?: string): void;
  removeDocChunks(docId: string, userId?: string): void;
  removeChunkIds(ids: string[], userId?: string): void;
  updateChunkMetadataByIds(ids: string[], patch: RagChunkMetadataPatch): void;
  updateDocumentLifecycle(
    docId: string,
    lifecycleStatus: string,
    userId?: string,
  ): void;
  getIndexedChunkCount(docId: string, userId?: string): number;
  getIndexedChunkHashes(
    docId: string,
    userId?: string,
  ): {
    hashes: string[];
    generations: string[];
    lifecycleStatuses: string[];
    complete: boolean;
  };
  getSnapshotPersistenceStatus(docId: string): {
    persisted: boolean;
    reason?: string;
  };
  getStats(): { totalChunks: number; totalDocs: number };
}

export interface RagAdminCapability
  extends RagRetrievalCapability, RagIndexCapability {}
