import type { Command } from 'commander';
import { addBaseOptions, createRuntime, runCommand, type CommandDeps } from './shared.js';

export function registerDoctorCommand(program: Command, deps: CommandDeps): void {
  addBaseOptions(program.command('doctor').description('Check CLI and RAG service status')).action(
    async (rawOptions) => {
      const runtime = await createRuntime(deps, rawOptions);
      await runCommand(async () => {
        const checks = [];
        checks.push({
          name: 'config',
          ok: true,
          baseUrl: runtime.config.baseUrl,
          configPath: runtime.config.configPath,
          tokenSource: runtime.config.tokenSource,
        });

        checks.push(await check('health', () => runtime.apiClient.health()));
        checks.push(await check('profile', () => runtime.apiClient.profile()));
        checks.push(await check('skills', () => runtime.apiClient.listSkills()));
        checks.push(await check('documents', () => runtime.apiClient.listDocuments()));

        const ok = checks.every((item) => item.ok);
        runtime.output.write({
          status: ok ? 'ok' : 'error',
          data: {
            ok,
            checks,
          },
          error: ok
            ? undefined
            : {
                code: 'doctor_failed',
                message: 'one or more checks failed',
                recoverable: true,
              },
        });
        if (!ok) {
          process.exitCode = 1;
        }
      }, runtime.output);
    },
  );
}

async function check(name: string, fn: () => Promise<unknown>) {
  try {
    const result = await fn();
    return { name, ok: true, result: summarize(result) };
  } catch (error) {
    const err = error as Error & { code?: string };
    return {
      name,
      ok: false,
      code: err.code,
      message: err.message,
    };
  }
}

function summarize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return { count: value.length };
  }
  return value;
}
