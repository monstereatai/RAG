/** Real startAsync transaction drill against a disposable, localhost-only PostgreSQL container. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { sleep, cmd, id, report, requireIsolated } from './lib/platform-validation-utils.mjs';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');
const { AgentRunEntity } = require('../dist/src/providers/db/entities/agent-run.entity.js');
const { AgentActionEntity } = require('../dist/src/providers/db/entities/agent-action.entity.js');
const { AgentTaskEntity } = require('../dist/src/providers/db/entities/agent-task.entity.js');
const { DomainEventOutboxEntity } = require('../dist/src/providers/db/entities/domain-event-outbox.entity.js');
const { DomainEventSubscriptionEntity } = require('../dist/src/providers/db/entities/domain-event-subscription.entity.js');
const { DomainEventDeliveryEntity } = require('../dist/src/providers/db/entities/domain-event-delivery.entity.js');
const { AgentRunsService } = require('../dist/src/modules/agent-runs/agent-runs.service.js');
const { AgentTasksService } = require('../dist/src/modules/agent-tasks/agent-tasks.service.js');
const { DomainEventsService } = require('../dist/src/modules/domain-events/domain-events.service.js');
const { ProductionWorkflowStateService } = require('../dist/src/modules/workflow/production-workflow.state-service.js');
const { ProductionWorkflowControl } = require('../dist/src/modules/workflow/production-workflow.control.js');

async function disposablePostgres(callback) {
  requireIsolated();
  const name = `rag-workflow-pg-${id().slice(0, 12)}`;
  const password = `test-${randomUUID()}`;
  let created = false;
  try {
    await cmd('docker', ['run', '-d', '--name', name, '--label', 'rag.platform.validation=disposable',
      '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_USER=ragtest', '-e', 'POSTGRES_DB=ragtest',
      '-p', '127.0.0.1::5432', process.env.PLATFORM_VALIDATION_PG_IMAGE || 'postgres:16-alpine']);
    created = true;
    const mapping = await cmd('docker', ['port', name, '5432/tcp']);
    const bound = String(mapping).split(/\r?\n/).map(line => line.trim()).find(line => /^127\.0\.0\.1:\d+$/.test(line));
    assert(bound, `unsafe PostgreSQL port mapping: ${mapping}`);
    const url = `postgresql://ragtest:${encodeURIComponent(password)}@127.0.0.1:${bound.split(':').at(-1)}/ragtest`;
    return await callback(url);
  } finally {
    if (created) await cmd('docker', ['rm', '-fv', name]).catch(() => {});
  }
}

async function database(url) {
  const deadline = Date.now() + 35000;
  let last;
  while (Date.now() < deadline) {
    const ds = new DataSource({ type: 'postgres', url,
      entities: [AgentRunEntity, AgentActionEntity, AgentTaskEntity, DomainEventOutboxEntity,
        DomainEventSubscriptionEntity, DomainEventDeliveryEntity], synchronize: true, logging: false,
      connectTimeoutMS: 1500, extra: { connectionTimeoutMillis: 1500 } });
    try { await ds.initialize(); return ds; }
    catch (error) { last = error; if (ds.isInitialized) await ds.destroy().catch(() => {}); await sleep(400); }
  }
  throw new Error(`disposable PostgreSQL did not become ready: ${last?.message}`);
}

function harness(ds) {
  const get = key => key === 'domainEvents.requireDistributedLock' ? false : undefined;
  const events = { emit: async () => {} };
  const redis = { isEnabled: () => false };
  const domainEvents = new DomainEventsService({ get }, ds.getRepository(DomainEventOutboxEntity),
    ds.getRepository(DomainEventSubscriptionEntity), redis, ds.getRepository(DomainEventDeliveryEntity));
  const runs = new AgentRunsService(ds.getRepository(AgentRunEntity), ds.getRepository(AgentActionEntity),
    events, { get: async () => null, activate: async () => {} }, {}, redis);
  const tasks = new AgentTasksService(ds.getRepository(AgentTaskEntity), events);
  let queueAvailable = false;
  const queued = [];
  const context = {
    domainEvents, agentRuns: runs, tasks, agentGoals: { get: async () => null, activate: async () => {} },
    workflowQueue: { isEnabled: () => queueAvailable, isRequired: () => true,
      enqueue: async job => { if (!queueAvailable) throw new Error('Redis temporarily unavailable'); queued.push(job); return true; } },
    events: { view: (_threadId, state) => ({ threadId: state.threadId, projectId: state.projectId, status: state.status }),
      saveWorkflowIndexBestEffort: async () => {} },
    pendingStates: new Map(), logger: { warn: () => {} },
  };
  const state = new ProductionWorkflowStateService(context);
  state.getState = async () => null;
  context.state = state;
  const control = new ProductionWorkflowControl(context);
  return { context, state, control, domainEvents, queued, recover: () => { queueAvailable = true; } };
}

async function main() {
  requireIsolated();
  const evidence = { passed: false, evidenceLevel: 'real_local_docker', isolated: true, checks: {},
    limitations: ['Uses real PostgreSQL and production start services with stubbed runtime events, Redis queue and model execution'] };
  await disposablePostgres(async url => {
    const ds = await database(url);
    try {
      const { state, control, domainEvents, queued, recover } = harness(ds);
      const requestId = randomUUID();
      const dto = { requestId, projectId: 'pg-validation', brief: '真实 PostgreSQL 启动事务及并发幂等验证',
        roles: ['product', 'design', 'backend'], processType: 'hierarchical' };
      const userId = 'validation-user';
      const tenantId = 'validation-tenant';
      const responses = await Promise.all(Array.from({ length: 5 }, () => control.startAsync(dto, userId, tenantId)));
      const threadId = responses[0].threadId;
      assert(responses.every(item => item.threadId === threadId));
      const runs = ds.getRepository(AgentRunEntity);
      const tasks = ds.getRepository(AgentTaskEntity);
      const outbox = ds.getRepository(DomainEventOutboxEntity);
      assert.equal(await runs.countBy({ threadId }), 1);
      assert.equal(await tasks.countBy({ threadId }), 4); // manager + three roles
      assert.equal(await outbox.countBy({ eventType: 'workflow.dispatch.requested', aggregateId: threadId }), 1);
      evidence.checks.concurrentSameRequestOnePlan = true;
      const repeat = await control.startAsync(dto, userId, tenantId);
      assert.equal(repeat.threadId, threadId);
      await assert.rejects(control.startAsync({ ...dto, brief: `${dto.brief} changed` }, userId, tenantId),
        error => error?.status === 409);
      evidence.checks.responseLossRetryAndParameterConflict = true;

      const rollbackDto = { ...dto, requestId: randomUUID() };
      const rollbackThread = randomUUID();
      const rollbackState = await state.createInitialState(rollbackDto, userId, rollbackThread, tenantId);
      const { key, requestHash } = control.startRequestIdentity(rollbackDto, userId, tenantId);
      const job = { id: state.workflowJobId('start', rollbackThread), operation: 'start',
        threadId: rollbackThread, userId, tenantId, dto: { ...rollbackDto, threadId: rollbackThread } };
      await assert.rejects(domainEvents.transaction(async manager => {
        await state.createAcceptedRecords(manager, rollbackState, job, key, requestHash);
        throw new Error('injected process failure before commit');
      }), /injected process failure/);
      assert.equal(await runs.countBy({ threadId: rollbackThread }), 0);
      assert.equal(await tasks.countBy({ threadId: rollbackThread }), 0);
      assert.equal(await outbox.countBy({ aggregateId: rollbackThread }), 0);
      evidence.checks.transactionRollbackNoPartialRecords = true;

      assert.equal(queued.length, 0); // Redis unavailable after PostgreSQL commit
      recover();
      domainEvents.registerInternalHandler('workflow.dispatch.requested', async event => {
        const payload = JSON.parse(event.payload);
        queued.push(payload.job);
      });
      await domainEvents.dispatchPending();
      assert.equal(queued.filter(item => item.threadId === threadId).length, 1);
      const persisted = await outbox.findOneByOrFail({ aggregateId: threadId, eventType: 'workflow.dispatch.requested' });
      assert.equal(persisted.status, 'delivered');
      evidence.checks.redisRecoveryDispatchesCommittedIntent = true;
      evidence.passed = true;
      evidence.threadId = threadId;
    } finally { await ds.destroy(); }
  });
  await report('.tmp/evidence/production-workflow-postgres.json', evidence);
  console.log(JSON.stringify(evidence, null, 2));
}
await main();
