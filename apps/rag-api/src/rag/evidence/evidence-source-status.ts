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
        : input.retrieval.diagnostics.degradedChannels?.includes('keyword')
          ? 'failure'
          : input.badCaseMatches.length
            ? 'hit'
            : 'no_result',
      hitCount: input.badCaseMatches.length,
      reason: input.failures?.badCaseFailure
        ? failureReasonCode(input.failures.badCaseFailure)
        : undefined,
    },
    {
      source: 'bm25',
      status: input.failures?.retrievalFailure
        ? statusForFailure(input.failures.retrievalFailure)
        : input.retrieval.diagnostics.degradedChannels?.includes('keyword')
          ? 'failure'
          : input.retrieval.diagnostics.stages?.keywordCandidates
            ? 'hit'
            : 'no_result',
      hitCount: input.retrieval.diagnostics.stages?.keywordCandidates ?? 0,
      reason: input.failures?.retrievalFailure
        ? failureReasonCode(input.failures.retrievalFailure)
        : undefined,
    },
    {
      source: 'vector',
      status: input.retrieval.diagnostics.degradedChannels?.includes('vector')
        ? 'failure'
        : input.retrieval.vectorSource === 'none'
          ? 'no_result'
          : 'hit',
      hitCount: input.retrieval.diagnostics.stages?.vectorCandidates ?? 0,
    },
    {
      source: 'elasticsearch',
      status: input.retrieval.diagnostics.degradedChannels?.includes('vector')
        ? 'failure'
        : input.retrieval.vectorSource === 'elasticsearch'
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
      reason: input.failures?.obsidianFailure
        ? failureReasonCode(input.failures.obsidianFailure)
        : undefined,
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

function failureReasonCode(
  message: string,
): 'source_timeout' | 'source_failure' {
  return statusForFailure(message) === 'timeout'
    ? 'source_timeout'
    : 'source_failure';
}
