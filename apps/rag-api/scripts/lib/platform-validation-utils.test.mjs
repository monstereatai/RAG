import test from 'node:test';
import assert from 'node:assert/strict';
import { percentile, requireIsolated, opt } from './platform-validation-utils.mjs';

test('unacknowledged fault injection rejects before Docker invocation', () => {
  const old = process.env.PLATFORM_VALIDATION_ISOLATED;
  delete process.env.PLATFORM_VALIDATION_ISOLATED;
  try { assert.throws(() => requireIsolated(), /I_ACKNOWLEDGE_DISPOSABLE_TEST_ENV/); }
  finally { if (old === undefined) delete process.env.PLATFORM_VALIDATION_ISOLATED; else process.env.PLATFORM_VALIDATION_ISOLATED = old; }
});
test('percentiles use sorted empirical samples and do not invent samples', () => {
  assert.equal(percentile([], .95), null);
  assert.equal(percentile([100,30,80,50,20], .5), 50);
  assert.equal(percentile([100,30,80,50,20], .95), 100);
});
test('opt missing key returns literal fallback', () => {
  assert.equal(opt('--never-a-real-flag-for-test','safe'), 'safe');
});
