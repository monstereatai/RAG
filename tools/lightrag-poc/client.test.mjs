import test from 'node:test';
import assert from 'node:assert/strict';
import { LightRagPocClient } from './client.mjs';

function createClient(fetchImpl) {
  return new LightRagPocClient({ baseUrl: 'http://127.0.0.1:9621', apiKey: 'fake-test-key', fetchImpl });
}

test('requires API key and safe URL', () => {
  assert.throws(() => new LightRagPocClient({ baseUrl: 'http://localhost:9621' }), /API_KEY/);
  assert.throws(() => new LightRagPocClient({ baseUrl: 'ftp://localhost', apiKey: 'x' }), /HTTP/);
  assert.throws(() => new LightRagPocClient({ baseUrl: 'http://u:p@localhost', apiKey: 'x' }), /credentials/);
});

test('queries context only and authenticates to server', async () => {
  const requests = [];
  const client = createClient(async (url, init) => {
    requests.push({ url, init });
    return { ok: true, json: async () => ({ response: '星辰券', references: [{ file_path: 'poc.md' }], llm_generated: false }) };
  });
  const result = await client.queryContext({ query: '星河挑战需要什么道具？', mode: 'mix' });
  assert.equal(result.context, '星辰券');
  assert.equal(result.references.length, 1);
  assert.equal(requests[0].init.headers['X-API-Key'], 'fake-test-key');
  const payload = JSON.parse(requests[0].init.body);
  assert.equal(payload.only_need_context, true);
  assert.equal(payload.mode, 'mix');
  assert.equal(payload.stream, false);
  assert.equal(payload.include_references, true);
});

test('refuses bypass mode and generated answers', async () => {
  const client = createClient(async () => ({ ok: true, json: async () => ({ response: 'generated', llm_generated: true }) }));
  await assert.rejects(client.queryContext({ query: 'test', mode: 'bypass' }), /unsupported/);
  await assert.rejects(client.queryContext({ query: 'test' }), /retrieval-only/);
});

test('inserts text with file_source and rejects unsafe paths', async () => {
  let sent;
  const client = createClient(async (_url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ track_id: 'test-track' }) };
  });
  const result = await client.insertText({ text: 'synthetic rules', fileSource: 'poc-game.md' });
  assert.equal(result.track_id, 'test-track');
  assert.deepEqual(sent, { text: 'synthetic rules', file_source: 'poc-game.md' });
  await assert.rejects(client.insertText({ text: 'content', fileSource: '../private.md' }), /safe basename/);
});

test('never logs error response body containing secrets', async () => {
  const client = createClient(async () => ({ ok: false, status: 401, text: async () => 'sensitive-secret' }));
  await assert.rejects(client.health(), error => error.message.includes('HTTP 401') && !error.message.includes('sensitive-secret'));
});
