/** Child worker for isolated BullMQ failover/load experiments, not app business tools. */
import Redis from 'ioredis';
import { Worker } from 'bullmq';
import { sleep } from './lib/platform-validation-utils.mjs';

const [url, queueName, prefix, role, concurrencyRaw] = process.argv.slice(2);
if (!url?.startsWith('redis://127.0.0.1:') || !/^rag-validation-[a-f0-9-]+$/.test(queueName) ||
    !/^rag-validation:[a-f0-9-]+$/.test(prefix)) {
  throw new Error('Must use an isolated loopback Redis and per-run queue');
}
const concurrency = Number(concurrencyRaw);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('Invalid concurrency');
const redis = new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
const notify = (type, extra = {}) => console.log(JSON.stringify({type,role,...extra}));
const sideEffect = `
  if redis.call('SET', KEYS[1], ARGV[1], 'NX') then
    redis.call('INCR', KEYS[2]); return 1
  end
  return 0
`;
const worker = new Worker(queueName, async (job) => {
  // Worker intentionally uses an atomic idempotency key to model a tool with a
  // durable idempotency contract. This does NOT prove arbitrary external tools
  // are idempotent.
  const effectKey = `${prefix}:effect:${job.id}`;
  const first = await redis.eval(sideEffect, 2, effectKey, `${prefix}:effects`, role);
  await redis.sadd(`${prefix}:workers`, role);
  notify('processed', {jobId:job.id,first:Boolean(first)});
  if (role === 'victim' && job.data?.chaos === true) {
    notify('effect_committed_before_ack', {jobId:job.id});
    await new Promise(() => {}); // parent SIGKILLs after side effect, before ACK
  }
  await sleep(Number(job.data?.sleepMs ?? 30));
  return { completedBy: role, effectWasNew: first === 1 };
}, {
  connection: { url }, concurrency, lockDuration: 3_000,
  stalledInterval: 1_000, maxStalledCount: 2,
});
worker.on('error', (error) => notify('worker-error', {message:error.message.slice(0, 120)}));
await worker.waitUntilReady();
notify('ready');
process.on('SIGTERM', async () => {
  const timer = setTimeout(() => process.exit(0), 2_000);
  timer.unref();
  try { await worker.close(true); } catch {}
  try { redis.disconnect(); } catch {}
  process.exit(0);
});
