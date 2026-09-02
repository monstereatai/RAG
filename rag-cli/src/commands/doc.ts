import type { Command } from 'commander';
import { addBaseOptions, createRuntime, runCommand, withSpinner, type CommandDeps } from './shared.js';

export function registerDocCommand(program: Command, deps: CommandDeps): void {
  const doc = program.command('doc').description('Inspect current user documents');

  addBaseOptions(doc.command('list').description('List documents')).action(async (rawOptions) => {
    const runtime = await createRuntime(deps, rawOptions);
    await runCommand(async () => {
      const docs = await withSpinner(runtime.options, 'Loading documents', () =>
        runtime.apiClient.listDocuments(),
      );
      runtime.output.write({ status: 'ok', data: docs });
    }, runtime.output);
  });

  addBaseOptions(doc.command('show').argument('<docId>', 'document id')).action(
    async (docId: string, rawOptions) => {
      const runtime = await createRuntime(deps, rawOptions);
      await runCommand(async () => {
        const result = await withSpinner(runtime.options, 'Loading document', () =>
          runtime.apiClient.getDocument(docId),
        );
        runtime.output.write({ status: 'ok', data: result });
      }, runtime.output);
    },
  );

  addBaseOptions(doc.command('task').argument('<taskId>', 'asynchronous ingestion task id')).action(
    async (taskId: string, rawOptions) => {
      const runtime = await createRuntime(deps, rawOptions);
      await runCommand(async () => {
        const result = await withSpinner(runtime.options, 'Loading document task', () =>
          runtime.apiClient.getDocumentTask(taskId),
        );
        runtime.output.write({ status: 'ok', data: result });
      }, runtime.output);
    },
  );
}
