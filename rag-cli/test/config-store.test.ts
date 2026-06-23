import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigStore, normalizeBaseUrl } from '../src/core/config-store.js';

test('ConfigStore saves and resolves user config', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rag-cli-config-'));
  try {
    const store = new ConfigStore(join(dir, 'config.json'));
    await store.save({ baseUrl: 'http://localhost:3000/api/v1/', token: 'secret' });

    const resolved = await store.resolve();
    assert.equal(resolved.baseUrl, 'http://localhost:3000/api/v1');
    assert.equal(resolved.token, 'secret');
    assert.equal(resolved.tokenSource, 'config');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('normalizeBaseUrl trims trailing slashes', () => {
  assert.equal(normalizeBaseUrl('http://localhost:3000/api/v1///'), 'http://localhost:3000/api/v1');
});

