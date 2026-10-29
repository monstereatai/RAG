import type { RetrievedChunk } from '../evidence/retrieval.types';
import type { QueryPlan } from '../planning/query-plan';
import type { RetrievalExecutionPlan } from './retrieval-execution-plan';

export interface SupplementalEvidenceContext {
  content: string;
  evidence: RetrievedChunk[];
}

export interface SupplementalEvidenceLoaderInput {
  queryPlan: QueryPlan;
  executionPlan: RetrievalExecutionPlan;
}

/** Loads external evidence only after the query and retrieval policies are fixed. */
export type SupplementalEvidenceLoader = (
  input: SupplementalEvidenceLoaderInput,
) => Promise<SupplementalEvidenceContext>;
