/** Real Redis stop/start recovery against a new disposable Docker container. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { disposableRedis, awaitRedis, sleep, id, opt, report } from './lib/platform-validation-utils.mjs';

const require = createRequire(import.meta.url);
const { RedisProvider } = require('../dist/src/providers/redis/redis.provider.js');
const { RedisCheckpointer } = require('../dist/src/providers/langgraph-checkpointer/redis-checkpointer.js');
const target = opt('--out', '.tmp/evidence/platform-redis-recovery.json');

function checkpoint(checkpointId) {
  return { v: 1, id: checkpointId, ts: new Date().toISOString(),
    channel_values: { stage: checkpointId }, channel_versions: {}, versions_seen: {} };
}
async function withSaver(url, fn, { offline = false } = {}) {
  const provider = new RedisProvider({ get: (key) => key === 'redis.url' ? url : undefined });
  provider.onModuleInit();
  try {
    const until = Date.now() + (offline ? 500 : 7_000);
    while (Date.now() < until && !provider.isEnabled()) await sleep(50);
    if (!offline) assert.equal(provider.isEnabled(), true, 'RedisProvider did not connect');
    return await fn(new RedisCheckpointer(provider, 0, undefined, true));
  } finally { await provider.onModuleDestroy(); }
}

let output;
try {
  output = await disposableRedis(async ({ url, name, docker }) => {
    const threadId = `verify-${id()}`;
    const initialId = `checkpoint-${id()}`;
    const config = { configurable: { thread_id: threadId } };
    const pendingConfig = { configurable: { thread_id: threadId, checkpoint_id: initialId } };
    const client = await awaitRedis(url);
    client.disconnect();
    await withSaver(url, async (saver) => {
      await saver.put(config, checkpoint(initialId), { source: 'validation', step: 1 });
      await saver.putWrites(pendingConfig, [ ['tool:start', { id: 'tool-1' }], ['tool:result', { ok: true }] ], 'task-1');
      const existing = await saver.getTuple(pendingConfig);
      assert.equal(existing?.checkpoint.id, initialId);
      assert.equal(existing?.pendingWrites?.length, 2);
    });

    // Stop without deleting the container's persistent AOF. A new provider must
    // fail closed during the real outage (no silent in-memory fallback).
    await docker('stop');
    let rejectedWhileUnavailable = false;
    await withSaver(url, async (saver) => {
      try { await saver.put(config, checkpoint('offline-write'), { source: 'validation', step: 2 }); }
      catch { rejectedWhileUnavailable = true; }
    }, { offline: true });
    assert.equal(rejectedWhileUnavailable, true, 'Required checkpoint writes must fail during outage');

    await docker('start');
    const restored = await awaitRedis(url);
    restored.disconnect();
    await withSaver(url, async (saver) => {
      const persisted = await saver.getTuple(config);
      assert.equal(persisted?.checkpoint.id, initialId, 'Checkpoint lost after Docker restart');
      const writes = await saver.getTuple(pendingConfig);
      assert.equal(writes?.pendingWrites?.length, 2, 'Pending writes lost after Docker restart');
      await saver.put(config, checkpoint('after-restart'), { source: 'validation', step: 3 });
      assert.equal((await saver.getTuple(config))?.checkpoint.id, 'after-restart');
      await saver.deleteThread(threadId);
      assert.equal(await saver.getTuple(config), undefined, 'Thread cleanup failed');
    });
    return { passed: true, evidenceLevel: 'real_local_docker', containerName: name,
      isolated: true, redisStopped: true, unavailableWriteRejected: true,
      checkpointSurvivedRestart: true, pendingWritesSurvivedRestart: true,
      postRestartWriteWorked: true, cleanupWorked: true,
      limitations: ['Does not test PostgreSQL/BullMQ correlation or external tool side effects',
        'Docker stop/start is a controlled failure, not a full network partition or Redis cluster failover'] };
  });
} catch (error) {
  output = { passed: false, evidenceLevel: 'real_local_docker', reason: error instanceof Error ? error.message : String(error) };
}
await report(target, { kind: 'isolated-redis-checkpoint-recovery', ...output });
console.log(JSON.stringify(output, null, 2));
if (!output.passed) process.exitCode = 1;
