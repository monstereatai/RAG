import type { Command } from 'commander';
import { addBaseOptions, createRuntime, runCommand, withSpinner, type CommandDeps } from './shared.js';
import { parsePositiveInt } from './search.js';

export function registerSkillCommand(program: Command, deps: CommandDeps): void {
  const skill = program.command('skill').description('List and match local RAG skills');

  addBaseOptions(skill.command('list').description('List skills')).action(async (rawOptions) => {
    const runtime = await createRuntime(deps, rawOptions);
    await runCommand(async () => {
      const skills = await withSpinner(runtime.options, 'Loading skills', () =>
        runtime.apiClient.listSkills(),
      );
      runtime.output.write({ status: 'ok', data: skills });
    }, runtime.output);
  });

  addBaseOptions(
    skill
      .command('match')
      .description('Match skills by task')
      .argument('<query>', 'task query')
      .option('-l, --limit <number>', 'max matches', '3'),
  ).action(async (query: string, rawOptions) => {
    const runtime = await createRuntime(deps, rawOptions);
    await runCommand(async () => {
      const matches = await withSpinner(runtime.options, 'Matching skills', () =>
        runtime.apiClient.matchSkills(query, parsePositiveInt(rawOptions.limit, 'limit')),
      );
      runtime.output.write({ status: 'ok', data: matches });
    }, runtime.output);
  });
}
