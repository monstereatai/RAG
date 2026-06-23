import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);

test('doctor returns a machine-safe failure envelope when service is unavailable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rag-cli-home-'));
  try {
    await assert.rejects(
      () =>
        execFileAsync(
          'node',
          [
            'dist/src/bin.js',
            'doctor',
            '--format',
            'json',
            '--base-url',
            'http://127.0.0.1:9/api/v1',
            '--timeout',
            '500',
          ],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              HOME: dir,
            },
          },
        ),
      (error) => {
        const err = error as { stdout?: string; stderr?: string; code?: number };
        assert.equal(err.code, 1);
        assert.equal(err.stderr, '');

        const parsed = JSON.parse(err.stdout ?? '{}') as {
          status?: string;
          data?: {
            ok?: boolean;
            checks?: Array<{ name?: string; ok?: boolean; code?: string }>;
          };
          error?: { code?: string; recoverable?: boolean };
        };
        assert.equal(parsed.status, 'error');
        assert.equal(parsed.error?.code, 'doctor_failed');
        assert.equal(parsed.error?.recoverable, true);
        assert.equal(parsed.data?.ok, false);
        assert.equal(
          parsed.data?.checks?.some(
            (item) => item.name === 'health' && item.ok === false && item.code === 'service_unavailable',
          ),
          true,
        );
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
