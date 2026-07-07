import type { Command } from 'commander';
import {
  addBaseOptions,
  createRuntime,
  runCommand,
  withSpinner,
  type CommandDeps,
} from './shared.js';

export function registerGraphCommand(program: Command, deps: CommandDeps): void {
  const graph = program.command('graph').description('Query GraphRAG');

  addBaseOptions(
    graph
      .command('query')
      .description('Ask a graph relationship question')
      .argument('<query>', 'graph query'),
  ).action(async (query: string, rawOptions) => {
    const runtime = await createRuntime(deps, rawOptions);
    await runCommand(async () => {
      const result = await withSpinner(runtime.options, 'Querying graph', () =>
        runtime.apiClient.graphQuery(query),
      );
      runtime.output.write({ status: 'ok', data: result });
    }, runtime.output);
  });
}
