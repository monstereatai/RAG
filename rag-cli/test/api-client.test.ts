import test from 'node:test';
import assert from 'node:assert/strict';
import { RagApiClient } from '../src/core/api-client.js';
import { CliError } from '../src/core/errors.js';

test('RagApiClient unwraps Nest transform response data', async () => {
  const client = new RagApiClient({
    baseUrl: 'http://example.test/api/v1',
    token: 'token',
    fetchImpl: async () =>
      new Response(JSON.stringify({ code: 200, data: { status: 'ok' }, message: 'success' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });

  const result = await client.profile();
  assert.deepEqual(result, { status: 'ok' });
});

test('RagApiClient maps 401 to unauthorized CliError', async () => {
  const client = new RagApiClient({
    baseUrl: 'http://example.test/api/v1',
    token: 'bad',
    fetchImpl: async () =>
      new Response(JSON.stringify({ message: 'token invalid or expired' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
  });

  await assert.rejects(() => client.profile(), (error) => {
    assert.ok(error instanceof CliError);
    assert.equal(error.code, 'unauthorized');
    return true;
  });
});

