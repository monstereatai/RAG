import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);

test('config get unknown key returns invalid_args', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rag-cli-home-'));
  try {
    await assert.rejects(
      () =>
        execFileAsync('node', ['dist/src/bin.js', 'config', 'get', 'missing', '--format', 'json'], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            HOME: dir,
          },
        }),
      (error) => {
        const err = error as { stdout?: string; code?: number };
        assert.equal(err.code, 2);
        const parsed = JSON.parse(err.stdout ?? '{}') as { error?: { code?: string } };
        assert.equal(parsed.error?.code, 'invalid_args');
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

