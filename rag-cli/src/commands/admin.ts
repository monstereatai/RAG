import type { Command } from 'commander';
import {
  addBaseOptions,
  createRuntime,
  runCommand,
  withSpinner,
  type CommandDeps,
} from './shared.js';
import { CliError } from '../core/errors.js';

const adminSearchKinds = ['popular', 'no-result', 'recall-issues'] as const;
type AdminSearchKind = (typeof adminSearchKinds)[number];

export function registerAdminCommand(program: Command, deps: CommandDeps): void {
  const admin = program.command('admin').description('Inspect RAG admin operations');

  addBaseOptions(
    admin
      .command('search')
      .description('Inspect search operations')
      .option(
        '--kind <kind>',
        'popular, no-result, recall-issues',
        'popular',
      ),
  ).action(async (rawOptions) => {
    const runtime = await createRuntime(deps, rawOptions);
    await runCommand(async () => {
      const kind = parseAdminSearchKind(rawOptions.kind);
      const result = await withSpinner(runtime.options, 'Loading search ops', () =>
        runtime.apiClient.adminSearch(kind),
      );
      runtime.output.write({ status: 'ok', data: result });
    }, runtime.output);
  });
}

function parseAdminSearchKind(raw: unknown): AdminSearchKind {
  if (
    typeof raw === 'string' &&
    adminSearchKinds.includes(raw as AdminSearchKind)
  ) {
    return raw as AdminSearchKind;
  }
  throw new CliError('invalid_args', 'kind must be one of: popular, no-result, recall-issues', {
    recoverable: true,
  });
}
