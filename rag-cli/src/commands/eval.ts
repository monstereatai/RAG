import type { Command } from 'commander';
import {
  addBaseOptions,
  createRuntime,
  runCommand,
  withSpinner,
  type CommandDeps,
} from './shared.js';

export function registerEvalCommand(program: Command, deps: CommandDeps): void {
  const evalCommand = program
    .command('eval')
    .description('Inspect and trigger RAG evaluation entrypoints');

  addBaseOptions(evalCommand.command('status').description('Show evaluation status')).action(
    async (rawOptions) => {
      const runtime = await createRuntime(deps, rawOptions);
      await runCommand(async () => {
        const result = await withSpinner(runtime.options, 'Loading eval status', () =>
          runtime.apiClient.evalStatus(),
        );
        runtime.output.write({ status: 'ok', data: result });
      }, runtime.output);
    },
  );

  addBaseOptions(
    evalCommand
      .command('run')
      .description('Trigger backend evaluation entrypoint')
      .option('--dataset <dataset>', 'dataset name')
      .option('--mode <mode>', 'offline, live, project'),
  ).action(async (rawOptions) => {
    const runtime = await createRuntime(deps, rawOptions);
    await runCommand(async () => {
      const result = await withSpinner(runtime.options, 'Triggering eval', () =>
        runtime.apiClient.evalRun({
          dataset:
            typeof rawOptions.dataset === 'string'
              ? rawOptions.dataset
              : undefined,
          mode: typeof rawOptions.mode === 'string' ? rawOptions.mode : undefined,
        }),
      );
      runtime.output.write({ status: 'ok', data: result });
    }, runtime.output);
  });
}
