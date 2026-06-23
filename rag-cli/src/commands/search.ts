import type { Command } from 'commander';
import { addBaseOptions, createRuntime, runCommand, withSpinner, type CommandDeps } from './shared.js';
import { CliError } from '../core/errors.js';

export function registerSearchCommand(program: Command, deps: CommandDeps): void {
  addBaseOptions(
    program
      .command('search')
      .description('Search RAG knowledge chunks')
      .argument('<query>', 'search query')
      .option('-l, --limit <number>', 'max chunks', '5'),
  ).action(async (query: string, rawOptions) => {
    const runtime = await createRuntime(deps, rawOptions);
    await runCommand(async () => {
      const limit = parsePositiveInt(rawOptions.limit, 'limit');
      const result = await withSpinner(runtime.options, 'Searching knowledge base', () =>
        runtime.apiClient.debugChunks(query, limit),
      );
      const chunks = result.chunks ?? result.results ?? [];
      if (chunks.length === 0) {
        throw new CliError('insufficient_context', 'no chunks found for query', {
          recoverable: true,
        });
      }
      runtime.output.write({
        status: 'ok',
        data: {
          query,
          results: chunks.map((chunk) => ({
            docId: chunk.docId,
            chunkId: chunk.chunkId ?? chunk.id,
            title: chunk.title,
            content: chunk.content,
            score: chunk.score ?? chunk.totalScore,
            bm25Score: chunk.bm25Score,
            cosineScore: chunk.cosineScore,
            chunkIndex: chunk.chunkIndex,
          })),
        },
      });
    }, runtime.output);
  });
}

export function parsePositiveInt(raw: unknown, name: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new CliError('invalid_args', `${name} must be a positive integer`);
  }
  return value;
}
