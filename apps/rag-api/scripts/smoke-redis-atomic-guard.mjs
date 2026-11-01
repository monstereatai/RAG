/** Malformed-key fault injection against an explicitly isolated, disposable Redis. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
const require = createRequire(import.meta.url);
const { RedisProvider } = require('../dist/src/providers/redis/redis.provider.js');
const { RedisCheckpointer } = require('../dist/src/providers/langgraph-checkpointer/redis-checkpointer.js');

if (!process.env.REDIS_URL) throw new Error('REDIS_URL must point to a disposable Redis');
if (process.env.REDIS_CHECKPOINT_TEST_ISOLATED !== 'I_ACKNOWLEDGE_ISOLATED_REDIS') {
  throw new Error('Set REDIS_CHECKPOINT_TEST_ISOLATED=I_ACKNOWLEDGE_ISOLATED_REDIS only on disposable Redis');
}

const threadId = `atomic-guard-${randomUUID()}`;
const indexKey = `thread:${threadId}`;
const latestKey = `checkpoint:latest:${threadId}`;
const checkpointKey = id => `checkpoint:${threadId}:${id}`;
const metadataKey = id => `checkpoint:metadata:${threadId}:${id}`;
const checkpoint = (id, ts) => ({v:1,id,ts,channel_values:{test:id},channel_versions:{},versions_seen:{}});
const config = { configurable: { thread_id: threadId } };
const inspector = new Redis(process.env.REDIS_URL, {
  connectTimeout: 5000, maxRetriesPerRequest: 1, retryStrategy: () => null,
});
inspector.on('error', () => {});
let provider;
async function withProvider(run) {
  provider = new RedisProvider({ get: key => key === 'redis.url' ? process.env.REDIS_URL : undefined });
  provider.onModuleInit();
  const deadline = Date.now() + 5000;
  while (!provider.isEnabled() && Date.now() < deadline) await new Promise(r => setTimeout(r, 30));
  assert.equal(provider.isEnabled(), true, 'Disposable Redis connection failed');
  try { return await run(new RedisCheckpointer(provider, 0, undefined, true)); }
  finally { provider.onModuleDestroy(); }
}
try {
  await inspector.ping();
  await inspector.set(indexKey, 'not-a-zset');
  await withProvider(async saver => {
    await assert.rejects(saver.put(config, checkpoint('invalid','2026-11-01T12:00:00.000Z'), {source:'smoke',step:1}));
  });
  assert.equal(await inspector.get(checkpointKey('invalid')), null,
    'Broken index type must not leave half-written checkpoint body');
  assert.equal(await inspector.get(latestKey), null,
    'Broken index must not publish latest checkpoint');

  await inspector.del(indexKey);
  await withProvider(async saver => {
    await saver.put(config, checkpoint('valid','2026-11-01T12:01:00.000Z'), {source:'smoke',step:2});
    assert.equal((await saver.getTuple(config))?.checkpoint.id, 'valid');
  });
  await inspector.del(indexKey); // simulate old corrupt state: pointer exists, ZSET entry gone
  await withProvider(async saver => {
    await assert.rejects(saver.put(config, checkpoint('new','2026-11-01T12:02:00.000Z'), {source:'smoke',step:3}));
  });
  assert.equal(await inspector.get(checkpointKey('new')), null,
    'Missing latest index entry must fail before writing new checkpoint');
  console.log(JSON.stringify({ok:true, isolatedRedis:true, corruptIndexRejected:true, missingLatestIndexRejected:true}));
} finally {
  const keys=[indexKey,latestKey,...['invalid','valid','new'].flatMap(id=>[checkpointKey(id),metadataKey(id)])];
  try { await inspector.del(...keys); } catch {}
  inspector.disconnect();
}
