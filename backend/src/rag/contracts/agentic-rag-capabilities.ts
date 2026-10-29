import type { BadCaseMatch } from '../prompts/bad-case.types';
import type {
  RetrievalScope,
  RetrievedChunk,
} from '../evidence/retrieval.types';
import type { ObsidianSearchHit } from '../../modules/obsidian/obsidian-knowledge.types';
import type { RagAnswerResult, RetrieveOptions } from './rag-types';

export const AGENTIC_RETRIEVAL_CAPABILITY = Symbol(
  'AGENTIC_RETRIEVAL_CAPABILITY',
);
export const AGENTIC_FAST_PATH_CAPABILITY = Symbol(
  'AGENTIC_FAST_PATH_CAPABILITY',
);
export const AGENTIC_SIMPLE_ANSWER_CAPABILITY = Symbol(
  'AGENTIC_SIMPLE_ANSWER_CAPABILITY',
);
export const AGENTIC_SUPPORTING_EVIDENCE_CAPABILITY = Symbol(
  'AGENTIC_SUPPORTING_EVIDENCE_CAPABILITY',
);

export interface AgenticRetrievalCapability {
  prepareGroundedEvidence(
    chunks: RetrievedChunk[],
    scope?: RetrievalScope,
  ): RetrievedChunk[];
  retrieve(
    query: string,
    options?: RetrieveOptions,
    userId?: string,
  ): Promise<RetrievedChunk[]>;
}

export interface AgenticFastPathResult {
  sufficient: boolean;
  reason: string;
  chunks: RetrievedChunk[];
  obsidianHits: ObsidianSearchHit[];
  prefetchedFastPath: NonNullable<RetrieveOptions['prefetchedFastPath']>;
}

export interface AgenticFastPathCapability {
  assessFastPath(
    query: string,
    userId?: string,
    options?: RetrieveOptions,
  ): Promise<AgenticFastPathResult>;
}

export interface AgenticSimpleAnswerCapability {
  answer(
    query: string,
    history?: Array<{ role: 'human' | 'ai'; content: string }>,
    userId?: string,
    memoryMessages?: Array<{ role: string; content: string }>,
    onToken?: (token: string) => void,
    retrieveOptions?: RetrieveOptions,
  ): Promise<RagAnswerResult>;
}

export interface ObsidianSourceResolution {
  chunks: RetrievedChunk[];
  mappedDocIds: Set<string>;
  sourceNotePaths: Set<string>;
}

export interface AgenticSupportingEvidenceCapability {
  toReviewedEvidenceChunks(matches: BadCaseMatch[]): RetrievedChunk[];
  getObsidianContext(
    query: string,
    userId?: string,
    role?: string,
  ): Promise<{ hits: ObsidianSearchHit[]; context: string }>;
  formatObsidianContext(hits: ObsidianSearchHit[]): string;
  resolveObsidianSourceEvidence(
    query: string,
    hits: ObsidianSearchHit[],
    userId?: string,
    options?: Pick<
      RetrieveOptions,
      'tenantId' | 'scope' | 'roles' | 'departmentIds' | 'trustedAdminPrincipal'
    >,
  ): Promise<ObsidianSourceResolution>;
  toObsidianChunks(hits: ObsidianSearchHit[]): RetrievedChunk[];
}
