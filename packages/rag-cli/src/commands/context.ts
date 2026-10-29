import type { Command } from 'commander';
import { ContextBuilder } from '../context/context-builder.js';
import {
  addBaseOptions,
  createRuntime,
  parseCsv,
  runCommand,
  withSpinner,
  type CommandDeps,
} from './shared.js';
import { parsePositiveInt } from './search.js';

export function registerContextCommand(program: Command, deps: CommandDeps): void {
  addBaseOptions(
    program
      .command('context')
      .description('Build a structured coding context package')
      .argument('<task>', 'task description')
      .option('-l, --limit <number>', 'max knowledge chunks', '5')
      .option('--paths <paths>', 'comma-separated likely paths')
      .option('--include-roadmap', 'include roadmap in likely files', false)
      .option('--match-skill', 'include skill match results', false)
      .option('--skill-limit <number>', 'max skill matches', '3'),
  ).action(async (task: string, rawOptions) => {
    const runtime = await createRuntime(deps, rawOptions);
    await runCommand(async () => {
      const builder = new ContextBuilder(runtime.apiClient);
      const result = await withSpinner(runtime.options, 'Building context package', () =>
        builder.build({
          task,
          limit: parsePositiveInt(rawOptions.limit, 'limit'),
          paths: parseCsv(typeof rawOptions.paths === 'string' ? rawOptions.paths : undefined),
          includeRoadmap: rawOptions.includeRoadmap === true,
          matchSkill: rawOptions.matchSkill === true,
          skillLimit: parsePositiveInt(rawOptions.skillLimit, 'skill-limit'),
        }),
      );
      runtime.output.write({ status: result.status, data: result });
    }, runtime.output);
  });
}
