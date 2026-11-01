/** Integration test: requires real isolated Redis; never skips silently. */
import 'dotenv/config';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { RedisProvider } = require('../dist/src/providers/redis/redis.provider.js');
const { RedisCheckpointer } = require('../dist/src/providers/langgraph-checkpointer/redis-checkpointer.js');
if (!process.env.REDIS_URL) throw new Error('REDIS_URL required; do not run against production Redis');
if (process.env.REDIS_CHECKPOINT_TEST_ISOLATED !== 'I_ACKNOWLEDGE_ISOLATED_REDIS')
  throw new Error('Set REDIS_CHECKPOINT_TEST_ISOLATED=I_ACKNOWLEDGE_ISOLATED_REDIS for disposable isolated Redis');
const p = new RedisProvider({get:key=> key==='redis.url' ? process.env.REDIS_URL:undefined});
p.onModuleInit();
const threadId=`checkpoint-atomic-smoke-${randomUUID()}`;
const checkpoint = (id,ts)=>({v:1,id,ts,channel_values:{test:id},channel_versions:{},versions_seen:{}});
try {
  const started=Date.now();
  while(!p.isEnabled() && Date.now()-started<5000) await new Promise(r=>setTimeout(r,30));
  assert.equal(p.isEnabled(),true,'Redis did not connect');
  const saver=new RedisCheckpointer(p,0,undefined,true);
  const base={configurable:{thread_id:threadId}};
  await saver.put(base,checkpoint('new','2026-11-01T18:00:00.000Z'),{source:'smoke',step:2});
  await saver.put(base,checkpoint('old','2026-11-01T17:00:00.000Z'),{source:'smoke',step:1});
  const latest=await saver.getTuple(base);
  assert.equal(latest?.checkpoint.id,'new','older completion regressed latest pointer');
  assert.equal(latest?.metadata?.step,2);
  await saver.putWrites({configurable:{thread_id:threadId,checkpoint_id:'new'}},[
    ['a',{value:1}],['b',{value:2}],
  ],'task-1');
  const recovered=await saver.getTuple({configurable:{thread_id:threadId,checkpoint_id:'new'}});
  assert.equal(recovered?.pendingWrites?.length,2,'pending writes not durable');
  const index=await p.zrangeRequired(`thread:${threadId}`,0,-1);
  assert.equal(index.length,2);
  await saver.deleteThread(threadId);
  assert.equal(await saver.getTuple(base),undefined);
  assert.deepEqual(await p.scanRequired(`writes:${threadId}:*`),[]);
  console.log(JSON.stringify({ok:true,atomic:true,latest:'new',pendingWrites:2,cleaned:true}));
} finally {try {await p.onModuleDestroy();} catch {}}
