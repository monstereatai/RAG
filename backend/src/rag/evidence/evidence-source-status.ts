import type { ObsidianSearchHit } from '../../modules/obsidian/obsidian-knowledge.service';
import type { BadCaseMatch } from '../prompts/bad-case-flywheel.service';
import type { DetailedRetrievalResult } from './retrieval.types';
import type {
  EvidenceSourcePolicy,
  EvidenceSourceSnapshot,
} from './evidence-bundle';

export interface EvidenceSourceStatusInput {
  badCaseMatches: BadCaseMatch[];
  retrieval: DetailedRetrievalResult;
  obsidianHits: ObsidianSearchHit[];
  sourcePolicy: EvidenceSourcePolicy;
  failures?: {
    badCaseFailure?: string;
    retrievalFailure?: string;
    obsidianFailure?: string;
  };
}

export function buildEvidenceSourceStatuses(
  input: EvidenceSourceStatusInput,
): EvidenceSourceSnapshot[] {
  const graph = input.retrieval.diagnostics.graphProbe;
  const image = input.retrieval.diagnostics.imageProbe;
  return [
    {
      source: 'bad_case',
      status: input.failures?.badCaseFailure
        ? statusForFailure(input.failures.badCaseFailure)
        : input.badCaseMatches.length
          ? 'hit'
          : 'no_result',
      hitCount: input.badCaseMatches.length,
      reason: input.failures?.badCaseFailure,
    },
    {
      source: 'bm25',
      status: input.failures?.retrievalFailure
        ? statusForFailure(input.failures.retrievalFailure)
        : input.retrieval.diagnostics.stages?.keywordCandidates
          ? 'hit'
          : 'no_result',
      hitCount: input.retrieval.diagnostics.stages?.keywordCandidates ?? 0,
      reason: input.failures?.retrievalFailure,
    },
    {
      source: 'vector',
      status: input.retrieval.vectorSource === 'none' ? 'no_result' : 'hit',
      hitCount: input.retrieval.diagnostics.stages?.vectorCandidates ?? 0,
    },
    {
      source: 'elasticsearch',
      status:
        input.retrieval.vectorSource === 'elasticsearch'
          ? 'hit'
          : 'not_executed',
      hitCount:
        input.retrieval.vectorSource === 'elasticsearch'
          ? (input.retrieval.diagnostics.stages?.vectorCandidates ?? 0)
          : 0,
    },
    {
      source: 'obsidian',
      status: input.failures?.obsidianFailure
        ? statusForFailure(input.failures.obsidianFailure)
        : input.obsidianHits.length
          ? 'hit'
          : 'no_result',
      hitCount: input.obsidianHits.length,
      reason: input.failures?.obsidianFailure,
    },
    {
      source: 'graph',
      status: graph?.attempted
        ? graph.factCount
          ? 'hit'
          : 'no_result'
        : 'not_executed',
      hitCount: graph?.factCount ?? 0,
      reason: graph?.skippedReason,
    },
    {
      source: 'image',
      status: image?.attempted
        ? image.hitCount
          ? 'hit'
          : 'no_result'
        : 'not_executed',
      hitCount: image?.hitCount ?? 0,
      reason: image?.skippedReason,
    },
    {
      source: 'web',
      status:
        input.sourcePolicy === 'web_allowed' ? 'not_executed' : 'forbidden',
      hitCount: 0,
    },
  ];
}

function statusForFailure(message: string): 'timeout' | 'failure' {
  return /timeout|timed out|超时/i.test(message) ? 'timeout' : 'failure';
}
