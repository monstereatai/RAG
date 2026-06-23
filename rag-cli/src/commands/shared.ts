import type { Command } from 'commander';
import { baseOptionsSchema, formatSchema, type BaseOptions } from '../core/schemas.js';
import { ConfigStore } from '../core/config-store.js';
import { RagApiClient } from '../core/api-client.js';
import { OutputFormatter } from '../core/output.js';
import { toCliError } from '../core/errors.js';
import { isMachineMode } from '../core/terminal.js';
import { createSpinner } from '../core/spinner.js';

export interface CommandDeps {
  configStore: ConfigStore;
}

export function addBaseOptions(command: Command): Command {
  return command
    .option('--base-url <url>', 'RAG API base URL')
    .option('--token <token>', 'RAG API token')
    .option('--format <format>', 'output format: json, markdown, table', 'markdown')
    .option('--timeout <ms>', 'request timeout in milliseconds', '15000')
    .option('--quiet', 'quiet machine-friendly output', false)
    .option('--verbose', 'verbose diagnostics', false);
}

export async function createRuntime(
  deps: CommandDeps,
  rawOptions: Record<string, unknown>,
): Promise<{
  options: BaseOptions;
  output: OutputFormatter;
  apiClient: RagApiClient;
  config: Awaited<ReturnType<ConfigStore['resolve']>>;
}> {
  const options = baseOptionsSchema.parse({
    ...rawOptions,
    format: formatSchema.catch('markdown').parse(rawOptions.format ?? 'markdown'),
  });
  const config = await deps.configStore.resolve({
    baseUrl: options.baseUrl,
    token: options.token,
  });
  return {
    options,
    output: new OutputFormatter(options.format, options.quiet),
    apiClient: new RagApiClient({
      baseUrl: config.baseUrl,
      token: config.token,
      timeoutMs: options.timeout,
    }),
    config,
  };
}

export async function runCommand(
  action: () => Promise<void>,
  output: OutputFormatter,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    const cliError = toCliError(error);
    output.error(cliError);
    process.exitCode = cliError.exitCode;
  }
}

export function shouldPrompt(options: BaseOptions): boolean {
  return process.stdin.isTTY && !isMachineMode(options);
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

export async function withSpinner<T>(
  options: BaseOptions,
  text: string,
  action: () => Promise<T>,
): Promise<T> {
  const spinner = createSpinner({ format: options.format, quiet: options.quiet, text });
  spinner?.start();
  try {
    const result = await action();
    spinner?.succeed();
    return result;
  } catch (error) {
    spinner?.fail();
    throw error;
  }
}

export function parseCsv(value?: string): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
