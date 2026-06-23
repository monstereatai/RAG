import type { Command } from 'commander';
import {
  addBaseOptions,
  createRuntime,
  readStdin,
  runCommand,
  shouldPrompt,
  withSpinner,
  type CommandDeps,
} from './shared.js';
import { CliError } from '../core/errors.js';
import { promptInput, promptSecret } from '../core/prompts.js';

export function registerAuthCommand(program: Command, deps: CommandDeps): void {
  const auth = program.command('auth').description('Manage RAG API authentication');

  addBaseOptions(
    auth
      .command('login')
      .description('Login and save token in user-level config')
      .option('-u, --username <username>', 'username'),
  ).action(async (rawOptions) => {
    const runtime = await createRuntime(deps, rawOptions);
    await runCommand(async () => {
      const username =
        rawOptions.username ??
        (shouldPrompt(runtime.options)
          ? await promptInput('Username')
          : undefined);
      if (!username || typeof username !== 'string') {
        throw new CliError('invalid_args', 'username is required');
      }

      const pwd = shouldPrompt(runtime.options)
        ? await promptSecret('Password')
        : await readStdin();
      if (!pwd) {
        throw new CliError('invalid_args', 'password is required from prompt or stdin');
      }

      const result = await withSpinner(runtime.options, 'Logging in', () =>
        runtime.apiClient.login({ username, password: pwd }),
      );
      const token = pickToken(result);
      if (!token) {
        throw new CliError('server_error', 'login response did not include access token', {
          recoverable: false,
        });
      }
      await deps.configStore.update({
        baseUrl: runtime.config.baseUrl,
        token,
      });
      runtime.output.write({
        status: 'ok',
        data: {
          baseUrl: runtime.config.baseUrl,
          tokenSaved: true,
          user: result.user,
        },
      });
    }, runtime.output);
  });

  addBaseOptions(auth.command('status').description('Show current auth status')).action(
    async (rawOptions) => {
      const runtime = await createRuntime(deps, rawOptions);
      await runCommand(async () => {
        const profile = await withSpinner(runtime.options, 'Checking auth status', () =>
          runtime.apiClient.profile(),
        );
        runtime.output.write({
          status: 'ok',
          data: {
            baseUrl: runtime.config.baseUrl,
            configPath: runtime.config.configPath,
            tokenSource: runtime.config.tokenSource,
            profile,
          },
        });
      }, runtime.output);
    },
  );

  addBaseOptions(auth.command('logout').description('Clear saved token')).action(async (rawOptions) => {
    const runtime = await createRuntime(deps, rawOptions);
    await runCommand(async () => {
      await deps.configStore.clearToken();
      runtime.output.write({ status: 'ok', data: { tokenCleared: true } });
    }, runtime.output);
  });
}

function pickToken(result: Record<string, unknown>): string | undefined {
  const direct = result.accessToken ?? result.token;
  return typeof direct === 'string' ? direct : undefined;
}
