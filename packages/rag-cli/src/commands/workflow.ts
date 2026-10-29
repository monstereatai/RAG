import type { Command } from 'commander';
import { addBaseOptions, createRuntime, runCommand, withSpinner, type CommandDeps } from './shared.js';

export function registerWorkflowCommand(program: Command, deps: CommandDeps): void {
  const workflow = program.command('workflow').description('Inspect production workflow state and handoff artifacts');

  addBaseOptions(workflow.command('list').description('List current user production workflows')).action(
    async (rawOptions) => {
      const runtime = await createRuntime(deps, rawOptions);
      await runCommand(async () => {
        const result = await withSpinner(runtime.options, 'Loading production workflows', () =>
          runtime.apiClient.listProductionWorkflows(),
        );
        runtime.output.write({ status: 'ok', data: result });
      }, runtime.output);
    },
  );

  addBaseOptions(workflow.command('show').argument('<threadId>', 'workflow thread id')).action(
    async (threadId: string, rawOptions) => {
      const runtime = await createRuntime(deps, rawOptions);
      await runCommand(async () => {
        const result = await withSpinner(runtime.options, 'Loading production workflow', () =>
          runtime.apiClient.getProductionWorkflow(threadId),
        );
        runtime.output.write({ status: 'ok', data: result });
      }, runtime.output);
    },
  );

  addBaseOptions(workflow.command('context').argument('<threadId>', 'completed workflow thread id')).action(
    async (threadId: string, rawOptions) => {
      const runtime = await createRuntime(deps, rawOptions);
      await runCommand(async () => {
        const result = await withSpinner(runtime.options, 'Loading approved coding context', () =>
          runtime.apiClient.getProductionWorkflowCodingContext(threadId),
        );
        runtime.output.write({ status: 'ok', data: result });
      }, runtime.output);
    },
  );
}
