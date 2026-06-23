import type { Command } from 'commander';
import {
  addBaseOptions,
  createRuntime,
  readStdin,
  runCommand,
  shouldPrompt,
  type CommandDeps,
} from './shared.js';
import { CliError } from '../core/errors.js';
import { promptInput, promptSecret } from '../core/prompts.js';

const supportedConfigKeys = ['baseUrl', 'token'] as const;
type SupportedConfigKey = (typeof supportedConfigKeys)[number];

export function registerConfigCommand(program: Command, deps: CommandDeps): void {
  const config = program.command('config').description('Manage local CLI config');

  addBaseOptions(config.command('get').argument('[key]', 'config key')).action(
    async (key, rawOptions) => {
      const runtime = await createRuntime(deps, rawOptions);
      await runCommand(async () => {
        if (key && !isSupportedConfigKey(key)) {
          throw new CliError('invalid_args', 'supported config keys: baseUrl, token');
        }
        const current = await deps.configStore.load();
        const supportedKey = key as SupportedConfigKey | undefined;
        runtime.output.write({
          status: 'ok',
          data: supportedKey
            ? { [supportedKey]: maskIfToken(supportedKey, current[supportedKey]) }
            : maskConfig(current),
        });
      }, runtime.output);
    },
  );

  addBaseOptions(
    config.command('set').argument('<key>', 'config key').argument('[value]', 'config value'),
  ).action(async (key, value, rawOptions) => {
    const runtime = await createRuntime(deps, rawOptions);
    await runCommand(async () => {
      if (!isSupportedConfigKey(key)) {
        throw new CliError('invalid_args', 'supported config keys: baseUrl, token');
      }
      const nextValue = await resolveConfigValue(key, value, runtime.options);
      if (!nextValue) {
        throw new CliError('invalid_args', 'value is required');
      }
      await deps.configStore.update({ [key]: nextValue });
      runtime.output.write({ status: 'ok', data: { [key]: maskIfToken(key, nextValue) } });
    }, runtime.output);
  });
}

export function registerInitCommand(program: Command, deps: CommandDeps): void {
  addBaseOptions(program.command('init').description('Initialize local CLI config')).action(
    async (rawOptions) => {
      const runtime = await createRuntime(deps, rawOptions);
      await runCommand(async () => {
        const baseUrl = shouldPrompt(runtime.options)
          ? await promptInput('RAG API base URL', runtime.config.baseUrl)
          : runtime.config.baseUrl;
        await deps.configStore.update({ baseUrl });
        runtime.output.write({
          status: 'ok',
          data: {
            baseUrl,
            configPath: runtime.config.configPath,
            next: 'run rag auth login or set RAG_TOKEN',
          },
        });
      }, runtime.output);
    },
  );
}

async function resolveConfigValue(
  key: SupportedConfigKey,
  value: unknown,
  options: Parameters<typeof shouldPrompt>[0],
): Promise<string | undefined> {
  if (typeof value === 'string') {
    return value;
  }
  if (shouldPrompt(options)) {
    if (key === 'token') {
      return promptSecret('Token');
    }
    return promptInput(`Value for ${key}`);
  }
  return readStdin();
}

function isSupportedConfigKey(key: unknown): key is SupportedConfigKey {
  return typeof key === 'string' && supportedConfigKeys.includes(key as SupportedConfigKey);
}

function maskConfig(config: { baseUrl?: string; token?: string }): Record<string, unknown> {
  return {
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    ...(config.token ? { token: maskIfToken('token', config.token) } : {}),
  };
}

function maskIfToken(key: string, value: unknown): unknown {
  if (key.toLowerCase().includes('token') && typeof value === 'string') {
    return value.length > 0 ? '[saved]' : '';
  }
  return value;
}
