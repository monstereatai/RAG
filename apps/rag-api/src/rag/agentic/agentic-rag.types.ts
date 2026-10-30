import type { RetrievedChunk } from '../evidence/retrieval.types';
import type { AgenticRagStateType } from './agentic-rag.state';

export interface AgenticRagRunResult {
  answer: string;
  references: RetrievedChunk[];
  route: 'simple' | 'agentic';
  confidence: number;
  retryCount: number;
  retrievalSufficient?: boolean;
  retrievalReason?: string;
  obsidianPaths?: string[];
  interrupted?: boolean;
  evidenceCoverage?: Array<{
    id: string;
    query: string;
    covered: boolean;
    evidenceIds: string[];
  }>;
  executionState?: AgenticRagStateType['executionState'];
}
