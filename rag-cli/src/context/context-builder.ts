import { CliError } from '../core/errors.js';
import type { RagApiClient } from '../core/api-client.js';
import type { SearchChunk, SkillMatch } from '../core/schemas.js';
import { normalizeCitations, type Citation } from './citation-normalizer.js';
import { buildGuidance, type CodingGuidance } from './guidance-builder.js';

export interface ContextPackage {
  task: string;
  status: 'ok' | 'insufficient_context';
  matchedSkills?: SkillMatch[];
  knowledge: SearchChunk[];
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
    const searchResult = await this.apiClient.debugChunks(input.task, input.limit);
    const chunks = normalizeChunks(searchResult);

    if (chunks.length === 0) {
      throw new CliError(
        'insufficient_context',
        'no enough RAG context found, try uploading documents or broadening the query',
        { recoverable: true },
      );
    }

    const matchedSkills = input.matchSkill
      ? await this.apiClient.matchSkills(input.task, input.skillLimit ?? 3)
      : undefined;

    return {
      task: input.task,
      status: 'ok',
      matchedSkills,
      knowledge: chunks,
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
}

function normalizeChunks(searchResult: unknown): SearchChunk[] {
  const result = searchResult as { chunks?: SearchChunk[]; results?: SearchChunk[] };
  return (result.chunks ?? result.results ?? []).filter(
    (chunk) => chunk.content && chunk.content.trim().length > 0,
  );
}

