import test from 'node:test';
import assert from 'node:assert/strict';
import { OutputFormatter } from '../src/core/output.js';
import { CliError } from '../src/core/errors.js';

test('OutputFormatter includes stable error envelope in JSON', () => {
  const writes: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    const output = new OutputFormatter('json');
    output.error(new CliError('invalid_args', 'bad input'));
  } finally {
    process.stdout.write = originalWrite;
  }

  const parsed = JSON.parse(writes.join('')) as {
    status: string;
    error: { code: string; message: string; recoverable: boolean };
  };
  assert.equal(parsed.status, 'error');
  assert.equal(parsed.error.code, 'invalid_args');
  assert.equal(parsed.error.message, 'bad input');
  assert.equal(typeof parsed.error.recoverable, 'boolean');
});
