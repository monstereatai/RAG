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
  const job = admin
    .command('job')
    .description('Manage scheduled analysis jobs; write operations require the admin role');

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

  addBaseOptions(job.command('list').description('List scheduled analysis jobs')).action(
    async (rawOptions) => {
      const runtime = await createRuntime(deps, rawOptions);
      await runCommand(async () => {
        const result = await withSpinner(runtime.options, 'Loading scheduled jobs', () =>
          runtime.apiClient.listScheduledJobs(),
        );
        runtime.output.write({ status: 'ok', data: result });
      }, runtime.output);
    },
  );

  addBaseOptions(job.command('versions').argument('<jobId>', 'job id')).action(
    async (jobId: string, rawOptions) => {
      const runtime = await createRuntime(deps, rawOptions);
      await runCommand(async () => {
        const result = await withSpinner(runtime.options, 'Loading job versions', () =>
          runtime.apiClient.getScheduledJobVersions(jobId),
        );
        runtime.output.write({ status: 'ok', data: result });
      }, runtime.output);
    },
  );

  addBaseOptions(job.command('executions').argument('<jobId>', 'job id')).action(
    async (jobId: string, rawOptions) => {
      const runtime = await createRuntime(deps, rawOptions);
      await runCommand(async () => {
        const result = await withSpinner(runtime.options, 'Loading job executions', () =>
          runtime.apiClient.getScheduledJobExecutions(jobId),
        );
        runtime.output.write({ status: 'ok', data: result });
      }, runtime.output);
    },
  );

  addBaseOptions(job.command('run').argument('<jobId>', 'job id')).action(
    async (jobId: string, rawOptions) => {
      const runtime = await createRuntime(deps, rawOptions);
      await runCommand(async () => {
        const result = await withSpinner(runtime.options, 'Running scheduled job', () =>
          runtime.apiClient.runScheduledJob(jobId),
        );
        runtime.output.write({ status: 'ok', data: result });
      }, runtime.output);
    },
  );

  addBaseOptions(job.command('copy').argument('<jobId>', 'job id')).action(
    async (jobId: string, rawOptions) => {
      const runtime = await createRuntime(deps, rawOptions);
      await runCommand(async () => {
        const result = await withSpinner(runtime.options, 'Copying scheduled job', () =>
          runtime.apiClient.copyScheduledJob(jobId),
        );
        runtime.output.write({ status: 'ok', data: result });
      }, runtime.output);
    },
  );

  for (const status of ['start', 'stop'] as const) {
    addBaseOptions(job.command(status).argument('<jobId>', 'job id')).action(
      async (jobId: string, rawOptions) => {
        const runtime = await createRuntime(deps, rawOptions);
        await runCommand(async () => {
          const result = await withSpinner(runtime.options, `${status === 'start' ? 'Enabling' : 'Disabling'} scheduled job`, () =>
            runtime.apiClient.setScheduledJobStatus(jobId, status),
          );
          runtime.output.write({ status: 'ok', data: result });
        }, runtime.output);
      },
    );
  }
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
