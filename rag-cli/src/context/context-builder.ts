import { CliError } from '../core/errors.js';
import type { RagApiClient } from '../core/api-client.js';
import type { AskResult, SearchChunk, SkillMatch } from '../core/schemas.js';
import { normalizeCitations, type Citation } from './citation-normalizer.js';
import { buildGuidance, type CodingGuidance } from './guidance-builder.js';

export interface ContextPackage {
  task: string;
  status: 'ok' | 'insufficient_context';
  matchedSkills?: SkillMatch[];
  knowledge: SearchChunk[];
  answer?: string;
  retrieval?: {
    sufficient?: boolean;
    reason?: string;
    route?: string;
    obsidianPaths: string[];
  };
  codingGuidance: CodingGuidance;
  riskFlags: string[];
  citations: Citation[];
}

export class ContextBuilder {
  constructor(private readonly apiClient: RagApiClient) {}

  async build(input: {
    task: string;
    limit: number;
    paths?: string[];
    includeRoadmap?: boolean;
    matchSkill?: boolean;
    skillLimit?: number;
  }): Promise<ContextPackage> {
    const serverContext = await this.tryServerContext(input);
    if (serverContext?.status === 'ok' && (serverContext.knowledge ?? []).length > 0) {
      const chunks = serverContext.knowledge ?? [];
      return {
        task: input.task,
        status: 'ok',
        matchedSkills: serverContext.matchedSkills,
        knowledge: chunks,
        codingGuidance: buildGuidance({
          task: input.task,
          paths: input.paths,
          includeRoadmap: input.includeRoadmap,
        }),
        riskFlags: [
          ...(serverContext.riskFlags ?? []),
          'New dependencies must be traceable to CLI architecture selection.',
          'Publishing, CI/CD changes, schema changes, and production deployment are out of scope.',
        ],
        citations: normalizeCitations(chunks),
      };
    }

    const searchResult =
      typeof this.apiClient.search === 'function'
        ? await this.apiClient.search(input.task, input.limit)
        : await this.apiClient.debugChunks(input.task, input.limit);
    let chunks = normalizeChunks(searchResult);
    let askFallback: AskResult | undefined;

    if (chunks.length === 0) {
      askFallback = await this.tryAskFallback(input.task);
      chunks = normalizeChunks({ chunks: askFallback?.references ?? [] });
      const hasObsidianContext = (askFallback?.obsidianPaths ?? []).length > 0;
      const hasReliableAnswer = askFallback?.retrievalSufficient === true;
      if (chunks.length === 0 && !hasObsidianContext && !hasReliableAnswer) {
        throw new CliError(
          'insufficient_context',
          'no enough RAG context found, try uploading documents or broadening the query',
          { recoverable: true },
        );
      }
    }

    const matchedSkills = input.matchSkill
      ? await this.apiClient.matchSkills(input.task, input.skillLimit ?? 3)
      : undefined;

    return {
      task: input.task,
      status: 'ok',
      matchedSkills,
      knowledge: chunks,
      answer: askFallback?.answer,
      retrieval: askFallback
        ? {
            sufficient: askFallback.retrievalSufficient,
            reason: askFallback.retrievalReason,
            route: askFallback.route,
            obsidianPaths: askFallback.obsidianPaths ?? [],
          }
        : undefined,
      codingGuidance: buildGuidance({
        task: input.task,
        paths: input.paths,
        includeRoadmap: input.includeRoadmap,
      }),
      riskFlags: [
        'New dependencies must be traceable to CLI architecture selection.',
        'Publishing, CI/CD changes, schema changes, and production deployment are out of scope.',
      ],
      citations: normalizeCitations(chunks),
    };
  }

  private async tryAskFallback(task: string): Promise<AskResult | undefined> {
    if (typeof this.apiClient.ask !== 'function') {
      return undefined;
    }
    try {
      return await this.apiClient.ask({ query: task, mode: 'auto' });
    } catch {
      return undefined;
    }
  }

  private async tryServerContext(input: {
    task: string;
    limit: number;
    includeRoadmap?: boolean;
    matchSkill?: boolean;
    skillLimit?: number;
  }) {
    if (typeof this.apiClient.contextPackage !== 'function') {
      return undefined;
    }
    try {
      return await this.apiClient.contextPackage(input);
    } catch {
      return undefined;
    }
  }
}

function normalizeChunks(searchResult: unknown): SearchChunk[] {
  const result = searchResult as { chunks?: SearchChunk[]; results?: SearchChunk[] };
  return (result.chunks ?? result.results ?? []).filter(
    (chunk) => chunk.content && chunk.content.trim().length > 0,
  );
}
