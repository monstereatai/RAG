/**
 * Destructive cross-store drill: ONLY containers created by this invocation.
 * Real PostgreSQL DomainEventsService + Redis BullMQ, business transaction,
 * PG restart, dispatcher crash AFTER enqueue, and Redis stop/recovery.
 * No production DB/API is contacted. Does NOT prove external tools exactly-once.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { sleep, cmd, disposableRedis, awaitRedis, id, opt, report, requireIsolated } from './lib/platform-validation-utils.mjs';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');
const { DomainEventsService } = require('../dist/src/modules/domain-events/domain-events.service.js');
const { DomainEventOutboxEntity } = require('../dist/src/providers/db/entities/domain-event-outbox.entity.js');
const { DomainEventSubscriptionEntity } = require('../dist/src/providers/db/entities/domain-event-subscription.entity.js');
const { DomainEventDeliveryEntity } = require('../dist/src/providers/db/entities/domain-event-delivery.entity.js');
const { RedisProvider } = require('../dist/src/providers/redis/redis.provider.js');
const { ProductionWorkflowQueueService } = require('../dist/src/modules/workflow/production-workflow-queue.service.js');
const { parseWorkflowDispatch } = require('../dist/src/modules/workflow/workflow-dispatch-contract.js');

const EVENT = 'workflow.dispatch.requested';
const TARGET = opt('--out', '.tmp/evidence/platform-cross-store-recovery.json');
const testId = id();
const tenantId = `test-${testId.slice(0, 10)}`;
const get = (data) => ({ get: (key) => data[key] });
const jobFor = (operation, threadId) => ({
  id: `production-workflow-${operation}-${createHash('sha256').update(`${operation}:${threadId}:`).digest('hex').slice(0, 32)}`,
  operation, threadId, userId: `test-${testId.slice(0, 10)}`, tenantId,
  dto: { threadId, projectId: 'isolated-validation', brief: 'Dry-run validation only; do not invoke actual workflow tools.' },
});
const intent = (job) => ({
  eventType: EVENT, tenantId, aggregateType: 'production_workflow',
  aggregateId: job.threadId, idempotencyKey: `workflow-dispatch:${job.id}`,
  payload: { job },
});

function pgPort(binding) {
  const match = String(binding).split(/\r?\n/).map(x => x.trim()).find(x => /^127\.0\.0\.1:\d+$/.test(x));
  if (!match) throw new Error(`Unsafe PostgreSQL port mapping, expected localhost only: ${binding}`);
  return Number(match.split(':').at(-1));
}
async function disposablePostgres(callback) {
  requireIsolated();
  const name = `rag-pg-verify-${id().slice(0, 12)}`;
  const password = `test-${randomUUID()}`;
  const image = process.env.PLATFORM_VALIDATION_PG_IMAGE || 'postgres:16-alpine';
  let created = false;
  try {
    await cmd('docker', ['run', '-d', '--name', name, '--label', 'rag.platform.validation=disposable',
      '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_USER=ragtest', '-e', 'POSTGRES_DB=ragtest',
      '-p', '127.0.0.1::5432', image]);
    created = true;
    const url = async () => {
      const port = pgPort(await cmd('docker', ['port', name, '5432/tcp']));
      return `postgresql://ragtest:${encodeURIComponent(password)}@127.0.0.1:${port}/ragtest`;
    };
    return await callback({ name, url, docker: (operation) => cmd('docker', [operation, name]) });
  } finally {
    if (created) await cmd('docker', ['rm', '-fv', name]).catch(() => {});
  }
}
async function database(url, maxMs = 35_000) {
  const deadline = Date.now() + maxMs;
  let last;
  while (Date.now() < deadline) {
    const ds = new DataSource({ type: 'postgres', url, entities: [DomainEventOutboxEntity,
      DomainEventSubscriptionEntity, DomainEventDeliveryEntity], synchronize: true,
      logging: false, connectTimeoutMS: 1_500, extra: { connectionTimeoutMillis: 1_500 } });
    try {
      await ds.initialize();
      await ds.query('CREATE TABLE IF NOT EXISTS platform_validation_intents (thread_id varchar(64) PRIMARY KEY, note varchar(30) NOT NULL)');
      return ds;
    } catch (error) {
      last = error;
      if (ds.isInitialized) await ds.destroy().catch(() => {});
      await sleep(400);
    }
  }
  throw new Error(`Disposable PostgreSQL did not become ready: ${last?.message || 'deadline exceeded'}`);
}
async function dispatcher(ds, redisUrl, { crash = false } = {}) {
  const redis = new RedisProvider(get({ 'redis.url': redisUrl }));
  redis.onModuleInit();
  const deadline = Date.now() + 15_000;
  while (!redis.isEnabled() && Date.now() < deadline) await sleep(80);
  assert(redis.isEnabled(), 'isolated Redis must be reachable');
  const previous = process.env.WORKFLOW_PROCESSOR_ENABLED;
  process.env.WORKFLOW_PROCESSOR_ENABLED = 'false';
  let queue;
  try {
    queue = new ProductionWorkflowQueueService(get({ 'redis.url': redisUrl, nodeEnv: 'test' }));
  } finally {
    if (previous === undefined) delete process.env.WORKFLOW_PROCESSOR_ENABLED;
    else process.env.WORKFLOW_PROCESSOR_ENABLED = previous;
  }
  const events = new DomainEventsService(get({ 'domainEvents.requireDistributedLock': true, 'domainEvents.lockTtlSeconds': 30 }),
    ds.getRepository(DomainEventOutboxEntity), ds.getRepository(DomainEventSubscriptionEntity), redis,
    ds.getRepository(DomainEventDeliveryEntity));
  events.registerInternalHandler(EVENT, async row => {
    const job = parseWorkflowDispatch(row.payload, row.aggregateId, row.tenantId);
    await queue.enqueue(job);
    if (crash) process.exit(73); // committed to Redis, NOT acknowledged in PG
  });
  return { redis, queue, events, close: async () => {
    await queue.onModuleDestroy();
    await redis.onModuleDestroy();
  } };
}
async function status(ds, job) {
  return ds.getRepository(DomainEventOutboxEntity).findOneByOrFail({ idempotencyKey: `workflow-dispatch:${job.id}` });
}
async function assertQueued(queue, job) {
  const actual = await queue.queue?.getJob(job.id);
  assert(actual, `BullMQ did not retain job ${job.id}`);
  assert.equal(actual.data.threadId, job.threadId);
  assert.equal(actual.data.tenantId, tenantId);
}
async function main() {
  requireIsolated();
  const started = Date.now();
  const evidence = { passed: false, evidenceLevel: 'real_local_docker', isolated: true,
    checks: {}, limitations: [
      'Tests real PostgreSQL Outbox/BullMQ dispatch, not full LLM workflow execution',
      'BullMQ stable IDs deduplicate while jobs remain retained; external tools still need their own idempotency/fencing',
      'Controlled PG/Redis stop-start is not a network partition or multi-node HA failover',
    ] };
  try {
    await disposableRedis(async (redisBox) => disposablePostgres(async (pgBox) => {
      evidence.redisContainer = redisBox.name;
      evidence.postgresContainer = pgBox.name;
      const redisUrl = redisBox.url;
      const liveRedis = await awaitRedis(redisUrl, 25_000);
      liveRedis.disconnect();
      let ds = await database(await pgBox.url());
      try {
        // Transaction rollback MUST undo both the business row and dispatch intent.
        const rolledBack = jobFor('start', randomUUID());
        const producer = new DomainEventsService(get({}), ds.getRepository(DomainEventOutboxEntity),
          ds.getRepository(DomainEventSubscriptionEntity), { isEnabled: () => false });
        await assert.rejects(ds.transaction(async manager => {
          await manager.query('INSERT INTO platform_validation_intents(thread_id,note) VALUES($1,$2)', [rolledBack.threadId, 'rollback']);
          await producer.emitInTransaction(manager, intent(rolledBack));
          throw new Error('controlled rollback before commit');
        }), /controlled rollback/);
        const rows = await ds.query('SELECT thread_id FROM platform_validation_intents WHERE thread_id=$1', [rolledBack.threadId]);
        assert.equal(rows.length, 0);
        assert.equal(await ds.getRepository(DomainEventOutboxEntity).countBy({ idempotencyKey: `workflow-dispatch:${rolledBack.id}` }), 0);
        evidence.checks.businessTransactionRollbackAtomic = true;

        // Durable PG commit, dispatcher temporarily absent, restart PG.
        const first = jobFor('start', randomUUID());
        await ds.transaction(async manager => {
          await manager.query('INSERT INTO platform_validation_intents(thread_id,note) VALUES($1,$2)', [first.threadId, 'committed']);
          await producer.emitInTransaction(manager, intent(first));
        });
        assert.equal((await status(ds, first)).status, 'pending');
        await ds.destroy();
        ds = null;
        await pgBox.docker('stop');
        await pgBox.docker('start');
        ds = await database(await pgBox.url());
        assert.equal((await status(ds, first)).status, 'pending');
        assert.equal((await ds.query('SELECT thread_id FROM platform_validation_intents WHERE thread_id=$1', [first.threadId])).length, 1);
        evidence.checks.postgresRestartPreservedCommittedIntent = true;

        let d = await dispatcher(ds, await redisBox.redisUrl());
        try {
          await d.events.dispatchPending();
          assert.equal((await status(ds, first)).status, 'delivered');
          await assertQueued(d.queue, first);
          evidence.checks.outboxRecoveryAfterDispatcherAbsence = true;

          // A real child process dies after Queue.add and BEFORE PG ack.
          const second = jobFor('start', randomUUID());
          const producer2 = new DomainEventsService(get({}), ds.getRepository(DomainEventOutboxEntity),
            ds.getRepository(DomainEventSubscriptionEntity), { isEnabled: () => false });
          await producer2.emit(intent(second));
          const child = spawnSync(process.execPath, [new URL(import.meta.url).pathname, '--crash-after-enqueue'],
            { cwd: process.cwd(), env: {
              ...process.env, PLATFORM_TEST_PG_URL: await pgBox.url(),
              PLATFORM_TEST_REDIS_URL: await redisBox.redisUrl(),
              WORKFLOW_PROCESSOR_ENABLED: 'false',
            }, encoding: 'utf8', timeout: 30_000 });
          assert.equal(child.status, 73,
            `Child must exit AFTER Queue.add, before PostgreSQL acknowledgement. exit=${child.status} stderr=${child.stderr?.slice(-700)}`);
          assert.equal((await status(ds, second)).status, 'pending');
          await assertQueued(d.queue, second);
          // The killed dispatcher held the GLOBAL Redis lease. A healthy instance
          // MUST wait for the actual TTL before taking over; deleting that lock
          // would conceal a race in production. TTL is configured to 30 seconds.
          const leaseInspector = await awaitRedis(await redisBox.redisUrl());
          const leaseStarted = Date.now();
          try {
            while (await leaseInspector.exists('rag:domain-events:dispatch-lock')) {
              assert(Date.now() - leaseStarted < 45_000, 'Killed dispatcher lease did not expire');
              await sleep(800);
            }
          } finally { leaseInspector.disconnect(); }
          evidence.dispatchLeaseRecoveryMs = Date.now() - leaseStarted;
          await d.events.dispatchPending();
          assert.equal((await status(ds, second)).status, 'delivered');
          await assertQueued(d.queue, second);
          evidence.checks.workerDispatchCrashAfterEnqueueRecovered = true;
          evidence.checks.stableBullmqJobIdRetained = true;

          // Stop Redis: PG must preserve pending intent, then restart and deliver.
          const third = jobFor('start', randomUUID());
          await producer2.emit(intent(third));
          await d.close();
          d = null;
          await redisBox.docker('stop');
          const offline = new DomainEventsService(get({ 'domainEvents.requireDistributedLock': true }),
            ds.getRepository(DomainEventOutboxEntity), ds.getRepository(DomainEventSubscriptionEntity),
            { isEnabled: () => false }, ds.getRepository(DomainEventDeliveryEntity));
          await offline.dispatchPending();
          assert.equal((await status(ds, third)).status, 'pending');
          evidence.checks.redisOutageKeptOutboxPending = true;
          await redisBox.docker('start');
          const nextRedisUrl = await redisBox.redisUrl();
          const r = await awaitRedis(nextRedisUrl, 35_000);
          r.disconnect();
          d = await dispatcher(ds, nextRedisUrl);
          await d.events.dispatchPending();
          assert.equal((await status(ds, third)).status, 'delivered');
          await assertQueued(d.queue, third);
          evidence.checks.redisRecoveryDispatchedPending = true;
          const all = await ds.getRepository(DomainEventOutboxEntity).find({ where: { eventType: EVENT } });
          assert.equal(all.length, 3);
          assert(all.every(e => e.status === 'delivered'));
          const counts = await d.queue.queue.getJobCounts('wait', 'active', 'completed', 'failed', 'delayed');
          assert.equal(Object.values(counts).reduce((a,b)=>a+b,0), 3,
            'Expected three distinct jobs; duplicate dispatch must not produce more');
          evidence.checks.noDuplicateBullmqJobsWhileRetained = true;
          evidence.jobCounts = counts;
        } finally { if (d) await d.close(); }
      } finally { if (ds?.isInitialized) await ds.destroy(); }
    }));
    evidence.passed = Object.values(evidence.checks).length === 8 &&
      Object.values(evidence.checks).every(Boolean);
  } catch (error) {
    evidence.reason = error instanceof Error ? error.message : String(error);
  }
  evidence.elapsedMs = Date.now() - started;
  console.log(JSON.stringify({ savedTo: await report(TARGET, evidence), ...evidence }, null, 2));
  if (!evidence.passed) process.exitCode = 1;
}
if (process.argv.includes('--crash-after-enqueue')) {
  requireIsolated();
  if (!/^postgresql:\/\/ragtest:[^@]+@127\.0\.0\.1:\d+\/ragtest$/.test(process.env.PLATFORM_TEST_PG_URL ?? '') ||
      !/^redis:\/\/127\.0\.0\.1:\d+$/.test(process.env.PLATFORM_TEST_REDIS_URL ?? '')) {
    throw new Error('Child may connect only to newly created localhost disposable PostgreSQL and Redis');
  }
  const db = await database(process.env.PLATFORM_TEST_PG_URL);
  const d = await dispatcher(db, process.env.PLATFORM_TEST_REDIS_URL, { crash: true });
  try { await d.events.dispatchPending(); } finally { await d.close(); await db.destroy(); }
  process.exit(74); // error if no dispatch was found
} else {
  await main();
}
