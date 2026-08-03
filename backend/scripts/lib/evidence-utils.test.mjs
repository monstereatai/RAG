import assert from 'node:assert/strict';
import test from 'node:test';
import {
  average,
  parseBoolean,
  percentile,
  rate,
  safeError,
} from './evidence-utils.mjs';

test('computes stable aggregate metrics', () => {
  assert.equal(average([1, 0, 1]), 0.6667);
  assert.equal(rate(3, 4), 0.75);
  assert.equal(percentile([100, 20, 50, 80], 0.5), 50);
  assert.equal(percentile([100, 20, 50, 80], 0.95), 100);
});

test('parses booleans and removes credentials from errors', () => {
  assert.equal(parseBoolean('true'), true);
  assert.equal(parseBoolean('0', true), false);
  assert.equal(
    safeError(new Error('Authorization: Bearer secret.token.value')),
    'Authorization: Bearer ***',
  );
  assert.equal(safeError('api_key=do-not-print'), 'api_key=***');
});
