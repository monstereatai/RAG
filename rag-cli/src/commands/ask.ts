import type { Command } from 'commander';
import { addBaseOptions, createRuntime, runCommand, withSpinner, type CommandDeps } from './shared.js';
import { chatModeSchema } from '../core/schemas.js';

export function registerAskCommand(program: Command, deps: CommandDeps): void {
  addBaseOptions(
    program
      .command('ask')
      .description('Ask RAG knowledge base')
      .argument('<query>', 'question')
      .option('-m, --mode <mode>', 'simple, agentic, auto', 'auto')
      .option('--thread-id <threadId>', 'conversation thread id'),
  ).action(async (query: string, rawOptions) => {
    const runtime = await createRuntime(deps, rawOptions);
    await runCommand(async () => {
      const mode = chatModeSchema.parse(rawOptions.mode);
      const result = await withSpinner(runtime.options, 'Asking RAG', () =>
        runtime.apiClient.ask({
          query,
          mode,
          threadId: typeof rawOptions.threadId === 'string' ? rawOptions.threadId : undefined,
        }),
      );
      runtime.output.write({ status: 'ok', data: result });
    }, runtime.output);
  });
}
