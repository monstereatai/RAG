import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGuidance } from '../src/context/guidance-builder.js';

test('buildGuidance uses pnpm validation commands', () => {
  const guidance = buildGuidance({ task: 'task' });

  assert.deepEqual(guidance.validationCommands, ['pnpm run build', 'pnpm test']);
});

