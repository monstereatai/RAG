/** Crash a real workflow worker after its generated-role checkpoint; recover on another process. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  disposableRedis,
  awaitRedis,
  id,
  opt,
  report,
  requireIsolated,
  sleep,
} from './lib/platform-validation-utils.mjs';

const require = createRequire(import.meta.url);
const { Queue } = require('bullmq');
const { RedisProvider } = require('../dist/src/providers/redis/redis.provider.js');
const { RedisCheckpointer } = require('../dist/src/providers/langgraph-checkpointer/redis-checkpointer.js');
const { ProductionWorkflowQueueService } = require('../dist/src/modules/workflow/production-workflow-queue.service.js');
const { ProductionWorkflowService } = require('../dist/src/modules/workflow/production-workflow.service.js');
const workerScript = fileURLToPath(import.meta.url);
const target = opt('--out', '.tmp/evidence/production-workflow-cross-worker.json');

function mockConfig(redisUrl) {
  return {
    get(key) {
      if (key === 'redis.url') return redisUrl;
      if (key === 'core.requireDependencies') return true;
      if (key === 'nodeEnv') return 'test';
      return undefined;
    },
  };
}

function roleOutput() {
  return {
    summary: '隔离验证岗位已完成。',
    deliverables: [{
      type: 'review',
      title: '恢复验证交付物',
      markdown: '## 隔离验证\n\n这个交付物只用于验证真实 Redis Checkpoint 恢复。',
    }],
    claims: [],
    issues: [],
    downstreamRisks: [],
    riskLevel: 'low',
    readyForApproval: true,
  };
}

async function worker(redisUrl, threadId, role) {
  requireIsolated();
  const redis = await awaitRedis(redisUrl);
  const config = mockConfig(redisUrl);
  const redisProvider = new RedisProvider(config);
  redisProvider.onModuleInit();
  const readyDeadline = Date.now() + 10_000;
  while (!redisProvider.isEnabled() && Date.now() < readyDeadline) await sleep(50);
  assert(redisProvider.isEnabled(), 'worker RedisProvider did not connect');

  const llmProvider = {
    getModel: () => ({
      withStructuredOutput: () => ({
        invoke: async () => {
          await redis.incr(`validation:${threadId}:model-calls`);
          return roleOutput();
        },
      }),
    }),
    getActiveProviderName: () => 'isolated-validation',
    getFallbackProviderName: () => undefined,
    getRoutePolicy: () => ({ maxTokens: 4_096 }),
    runWithSignal: (_signal, callback) => callback(),
    runWithRequestBudget: (callback) => callback(),
  };
  const artifacts = {
    create: async () => {
      const count = await redis.incr(`validation:${threadId}:artifact-writes`);
      return {
        id: `validation-artifact-${count}`,
        title: '恢复验证交付物',
        kind: 'markdown',
        status: 'queued',
      };
    },
    markReviewState: async () => ({}),
  };
  const roleTools = {
    gather: async () => {
      await redis.incr(`validation:${threadId}:retrieval-calls`);
      return { evidence: [], executions: [] };
    },
  };
  const workflowQueue = new ProductionWorkflowQueueService(config, llmProvider);
  const service = new ProductionWorkflowService(
    llmProvider,
    redisProvider,
    roleTools,
    artifacts,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    workflowQueue,
    config,
  );
  service.onModuleInit();
  await workflowQueue.worker.waitUntilReady();

  if (role === 'crash') {
    Object.defineProperty(service.context.execution, 'persistRoleResult', {
      configurable: true,
      value: async () => {
        const snapshot = await service.context.app.getState(
          service.context.events.config(threadId),
        );
        assert.equal(snapshot?.values?.rolePhase, 'generated');
        await redis.set(`validation:${threadId}:crashed-after-checkpoint`, '1');
        process.exit(73);
      },
    });
  }

  await redis.set(`validation:${threadId}:worker-${role}`, 'ready');
  process.on('SIGTERM', async () => {
    await workflowQueue.onModuleDestroy();
    await redisProvider.onModuleDestroy();
    redis.disconnect();
    process.exit(0);
  });
  setInterval(() => {}, 1_000);
}

async function waitForKey(redis, key, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await redis.get(key)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${key}`);
}

async function waitForWorkerReady(redis, key, worker, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await redis.get(key)) return;
    if (worker.child.exitCode !== null || worker.child.signalCode !== null) {
      throw new Error(
        `Worker exited before readiness (exit=${worker.child.exitCode}, signal=${worker.child.signalCode}): ${worker.output}`,
      );
    }
    await sleep(50);
  }
  throw new Error(`Worker readiness timed out for ${key}: ${worker.output}`);
}

async function waitForExit(child, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (child.exitCode === null && Date.now() < deadline) await sleep(25);
  if (child.exitCode === null) throw new Error('Worker process did not exit');
  return child.exitCode;
}

function startWorker(redisUrl, threadId, role) {
  const child = spawn(process.execPath, [workerScript, '--worker', redisUrl, threadId, role], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PLATFORM_VALIDATION_ISOLATED: 'I_ACKNOWLEDGE_DISPOSABLE_TEST_ENV',
      WORKFLOW_PROCESSOR_ENABLED: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output = `${output}${chunk}`.slice(-2000); });
  child.stderr.on('data', (chunk) => { output = `${output}${chunk}`.slice(-2000); });
  return { child, get output() { return output; } };
}

async function main() {
  requireIsolated();
  const threadId = `verify-${id()}`;
  const testPrefix = `validation:${threadId}`;
  let output;
  const workers = [];
  let queue;
  try {
    output = await disposableRedis(async ({ redisUrl }) => {
      const redis = await awaitRedis(await redisUrl());
      queue = new Queue('production-workflow', {
        connection: { url: await redisUrl() },
      });
      let provider;
      try {
        await queue.waitUntilReady();
        const first = startWorker(await redisUrl(), threadId, 'crash');
        workers.push(first);
        await waitForWorkerReady(redis, `${testPrefix}:worker-crash`, first);

      const jobId = `production-workflow-start-${threadId}`;
      await queue.add('advance', {
        id: jobId,
        operation: 'start',
        threadId,
        userId: 'isolated-validation',
        dto: {
          threadId,
          projectId: 'isolated-validation',
          brief: '只用于验证工作流在岗位生成检查点后的跨 Worker 恢复。',
          roles: ['product'],
          processType: 'sequential',
        },
      }, {
        jobId,
        attempts: 3,
        backoff: { type: 'fixed', delay: 100 },
        removeOnComplete: false,
        removeOnFail: false,
      });
        try {
          await waitForKey(redis, `${testPrefix}:crashed-after-checkpoint`, 30_000);
        } catch (error) {
          const job = await queue.getJob(jobId);
          const jobState = job ? await job.getState() : 'missing';
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}; job=${jobState}; worker=${first.output}`,
          );
        }
      await waitForExit(first.child);
      assert.equal(first.child.exitCode, 73, `Worker A did not crash at the checkpoint: ${first.output}`);

        provider = new RedisProvider(mockConfig(await redisUrl()));
        provider.onModuleInit();
        const providerDeadline = Date.now() + 8_000;
        while (!provider.isEnabled() && Date.now() < providerDeadline) await sleep(50);
        assert(provider.isEnabled(), 'parent RedisProvider did not connect');
        const saver = new RedisCheckpointer(provider, 0, undefined, true);
        const tuple = await saver.getTuple({
          configurable: { thread_id: `production:${threadId}` },
        });
        assert.equal(tuple?.checkpoint.channel_values.rolePhase, 'generated');

        const second = startWorker(await redisUrl(), threadId, 'resume');
        workers.push(second);
        await waitForWorkerReady(redis, `${testPrefix}:worker-resume`, second);
        const deadline = Date.now() + 100_000;
        let state = 'unknown';
        let job;
        while (Date.now() < deadline) {
          job = await queue.getJob(jobId);
          state = job ? await job.getState() : 'missing';
          if (state === 'completed' || state === 'failed') break;
          await sleep(250);
        }
        assert.equal(state, 'completed', `Worker B did not complete the recovered workflow: ${second.output}`);
        assert.equal(Number(await redis.get(`${testPrefix}:model-calls`)), 1, 'Recovered worker regenerated the role');
        assert.equal(Number(await redis.get(`${testPrefix}:retrieval-calls`)), 1, 'Recovered worker repeated retrieval');
        assert.equal(Number(await redis.get(`${testPrefix}:artifact-writes`)), 1, 'Artifact write was duplicated');

        const finalTuple = await saver.getTuple({
          configurable: { thread_id: `production:${threadId}` },
        });
        assert.equal(finalTuple?.checkpoint.channel_values.status, 'completed');
        return {
          passed: true,
          evidenceLevel: 'real_local_docker',
          isolated: true,
          workerAExitedAfterGeneratedCheckpoint: true,
          workerBCompletedBullmqJob: true,
          modelCalls: 1,
          retrievalCalls: 1,
          artifactWrites: 1,
          checkpointStatus: finalTuple?.checkpoint.channel_values.status,
          limitations: [
            'Uses the real production workflow service, Redis checkpointer and BullMQ queue with mocked model, retrieval and artifact provider dependencies',
            'Does not test PostgreSQL Outbox dispatch or third-party side effects',
          ],
        };
      } finally {
        for (const worker of workers) {
          if (worker.child.exitCode === null) worker.child.kill('SIGTERM');
        }
        await Promise.all(workers.map((worker) => waitForExit(worker.child).catch(() => undefined)));
        await provider?.onModuleDestroy();
        redis.disconnect();
        await queue.close();
        queue = undefined;
      }
    });
  } catch (error) {
    output = {
      passed: false,
      evidenceLevel: 'real_local_docker',
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    for (const worker of workers) {
      if (worker.child.exitCode === null) worker.child.kill('SIGTERM');
    }
    if (queue) await queue.close().catch(() => {});
  }
  console.log(JSON.stringify({ savedTo: await report(target, {
    kind: 'production-workflow-cross-worker-recovery',
    threadId,
    ...output,
  }), ...output }, null, 2));
  if (!output?.passed) process.exitCode = 1;
}

if (process.argv[2] === '--worker') {
  await worker(process.argv[3], process.argv[4], process.argv[5]);
} else {
  await main();
}
