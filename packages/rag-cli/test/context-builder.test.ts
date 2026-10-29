import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextBuilder } from '../src/context/context-builder.js';
import { CliError } from '../src/core/errors.js';

test('ContextBuilder builds context package with citations', async () => {
  const builder = new ContextBuilder({
    debugChunks: async () => ({
      query: 'task',
      chunks: [
        {
          id: 'chunk-1',
          docId: 'doc-1',
          content: 'Use citations and run tests.',
          totalScore: 0.9,
        },
      ],
    }),
    matchSkills: async () => [{ name: 'coding', score: 1 }],
  } as never);

  const result = await builder.build({
    task: 'task',
    limit: 3,
    matchSkill: true,
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.knowledge.length, 1);
  assert.equal(result.citations[0]?.chunkId, 'chunk-1');
  assert.equal(result.matchedSkills?.[0]?.name, 'coding');
});

test('ContextBuilder rejects empty knowledge', async () => {
  const builder = new ContextBuilder({
    debugChunks: async () => ({ query: 'task', chunks: [] }),
  } as never);

  await assert.rejects(() => builder.build({ task: 'task', limit: 3 }), (error) => {
    assert.ok(error instanceof CliError);
    assert.equal(error.code, 'insufficient_context');
    return true;
  });
});

