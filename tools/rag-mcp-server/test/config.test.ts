import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBaseUrl } from '../src/config.js';

test('normalizeBaseUrl removes trailing slashes', () => {
  assert.equal(normalizeBaseUrl('http://localhost:3000/api/v1///'), 'http://localhost:3000/api/v1');
});
