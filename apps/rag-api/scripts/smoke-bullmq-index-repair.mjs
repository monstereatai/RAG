import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import Redis from 'ioredis';
import { Queue, Worker } from 'bullmq';

const require = createRequire(import.meta.url);
const {
  IndexRepairQueueService,
} = require('../dist/src/modules/rag-admin/index-repair-queue.service.js');

const mode = process.argv[2] ?? 'parent';
const runId = process.env.BULLMQ_SMOKE_RUN_ID ?? randomUUID();
const jobId = `smoke-${runId}`;
const attemptsKey = `rag-smoke:bullmq-index-repair:${runId}:attempts`;
const crashRunId = runId.replace(/[^a-zA-Z0-9_-]/g, '');
const crashQueueName = `rag-index-repair-smoke-${crashRunId}`;
const crashJobId = `crash-${crashRunId}`;
const crashStartedKey = `rag-smoke:bullmq-index-repair:${runId}:crash-started`;
const recoveryCallsKey = `rag-smoke:bullmq-index-repair:${runId}:recovery-calls`;
const crashRecoveryTimeoutMs = 30_000;
const redisUrl =
  process.env.REDIS_BULLMQ_SMOKE_URL ?? 'redis://127.0.0.1:6379/15';
const queueName = 'rag-index-repair';

assertIsolatedLocalRedis(redisUrl);

if (mode === 'parent') {
  const reachable = await canConnectRedis();
  if (!reachable) {
    console.log(
      JSON.stringify({
        ok: true,
        skipped: true,
        reason: 'isolated local Redis DB 15 is not reachable',
      }),
    );
    process.exit(0);
  }

  const writer = runChild('writer');
  const reader = runChild('reader');
  const crashRecovery = await runCrashRecovery();
  const cleanup = await cleanupSmokeData();
  const ok =
    writer.status === 0 &&
    reader.status === 0 &&
    crashRecovery.ok &&
    crashRecovery.cleanup &&
    cleanup;
  console.log(
    JSON.stringify(
      {
        ok,
        topology: 'two-process-shared-isolated-redis-db',
        queue: queueName,
        runId,
        retry: writer.output,
        retryProcess: childSummary(writer),
        duplicateSubmit: reader.output,
        duplicateSubmitProcess: childSummary(reader),
        crashRecovery,
        cleanup,
      },
      null,
      2,
    ),
  );
  if (!ok) process.exitCode = 1;
} else if (mode === 'writer') {
  await runWriter();
} else if (mode === 'reader') {
  await runReader();
} else if (mode === 'crash-worker') {
  await runCrashWorker();
} else if (mode === 'recovery-worker') {
  await runRecoveryWorker();
} else {
  throw new Error(`unknown mode: ${mode}`);
}

function runChild(childMode) {
  const child = spawnSync(process.execPath, [process.argv[1], childMode], {
    env: {
      ...process.env,
      BULLMQ_SMOKE_RUN_ID: runId,
      REDIS_BULLMQ_SMOKE_URL: redisUrl,
    },
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return {
    status: child.status,
    signal: child.signal,
    error: child.error?.message,
    output: parseChildOutput(child),
    stderr: child.stderr?.trim() || undefined,
  };
}

function childSummary(child) {
  return {
    status: child.status,
    signal: child.signal,
    error: child.error,
    stderr: child.stderr,
  };
}

async function runWriter() {
  const redis = createRedisClient();
  const queue = createQueue();
  const service = new IndexRepairQueueService(makeConfig());
  try {
    await redis.del(attemptsKey);
    service.registerProcessor(async () => {
      const attempts = await redis.incr(attemptsKey);
      if (attempts === 1) throw new Error('smoke transient failure');
    });
    await service.enqueue({
      id: jobId,
      docId: `smoke-doc-${runId}`,
      requestedBy: 'smoke',
    });

    const job = await waitForJobState(queue, jobId, 'completed', 15_000);
    const attempts = Number(await redis.get(attemptsKey));
    const ok = job.attemptsMade >= 1 && attempts === 2;
    console.log(
      JSON.stringify({
        ok,
        state: await job.getState(),
        attemptsMade: job.attemptsMade,
        processorCalls: attempts,
      }),
    );
    if (!ok) process.exitCode = 1;
  } finally {
    await service.onModuleDestroy();
    await queue.close();
    await redis.quit();
  }
}

async function runReader() {
  const redis = createRedisClient();
  const queue = createQueue();
  const service = new IndexRepairQueueService(makeConfig());
  try {
    service.registerProcessor(async () => {
      await redis.incr(attemptsKey);
    });
    await service.enqueue({
      id: jobId,
      docId: `smoke-doc-${runId}`,
      requestedBy: 'smoke',
    });

    const job = await waitForJobState(queue, jobId, 'completed', 3_000);
    await delay(250);
    const attempts = Number(await redis.get(attemptsKey));
    const ok = job.attemptsMade >= 1 && attempts === 2;
    console.log(
      JSON.stringify({
        ok,
        state: await job.getState(),
        attemptsMade: job.attemptsMade,
        processorCalls: attempts,
        duplicateWasIgnored: attempts === 2,
      }),
    );
    if (!ok) process.exitCode = 1;
  } finally {
    await service.onModuleDestroy();
    await queue.close();
    await redis.quit();
  }
}

async function runCrashRecovery() {
  const redis = createRedisClient();
  const queue = createCrashQueue();
  let crashingProcess;
  let recoveryProcess;
  let result;
  let cleanup = true;
  try {
    await redis.del(crashStartedKey, recoveryCallsKey);
    await queue.add(
      'crash-recovery',
      { id: crashJobId, docId: `smoke-doc-${runId}`, requestedBy: 'smoke' },
      { jobId: crashJobId, attempts: 2 },
    );

    crashingProcess = spawnChildProcess('crash-worker');
    const started = await waitForRedisValue(
      redis,
      crashStartedKey,
      '1',
      10_000,
    );
    if (!started) throw new Error('crash worker did not claim the job');

    crashingProcess.child.kill('SIGKILL');
    const crashExit = await waitForChildClose(crashingProcess, 5_000);
    if (crashExit.timedOut || crashExit.signal !== 'SIGKILL') {
      throw new Error('crash worker did not exit from SIGKILL');
    }

    recoveryProcess = spawnChildProcess('recovery-worker');
    const job = await waitForJobState(
      queue,
      crashJobId,
      'completed',
      crashRecoveryTimeoutMs,
    );
    const recoveryExit = await waitForChildClose(recoveryProcess, 5_000);
    const recoveryCalls = Number(await redis.get(recoveryCallsKey));
    const ok =
      !recoveryExit.timedOut &&
      recoveryExit.code === 0 &&
      recoveryCalls === 1 &&
      job.stalledCounter >= 1;
    result = {
      ok,
      crashSignal: crashExit.signal,
      recoveryExitCode: recoveryExit.code,
      state: await job.getState(),
      stalledCounter: job.stalledCounter,
      recoveryCalls,
    };
  } catch (error) {
    const job = await queue.getJob(crashJobId).catch(() => undefined);
    const [counts, recoveryCalls, recoveryExit] = await Promise.all([
      queue.getJobCounts('waiting', 'active', 'stalled', 'completed', 'failed'),
      redis.get(recoveryCallsKey),
      recoveryProcess
        ? waitForChildClose(recoveryProcess, 100)
        : Promise.resolve(undefined),
    ]);
    result = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      state: job ? await job.getState() : null,
      stalledCounter: job?.stalledCounter ?? null,
      counts,
      recoveryCalls: Number(recoveryCalls ?? 0),
      recoveryWorker: recoveryExit
        ? {
            code: recoveryExit.code ?? null,
            signal: recoveryExit.signal ?? null,
            stdout: recoveryExit.stdout?.slice(0, 500),
            stderr: recoveryExit.stderr?.slice(0, 500),
          }
        : undefined,
    };
  } finally {
    await stopChildProcess(crashingProcess);
    await stopChildProcess(recoveryProcess);
    try {
      await queue.obliterate({ force: true });
    } catch {
      cleanup = false;
    }
    try {
      await redis.del(crashStartedKey, recoveryCallsKey);
    } catch {
      cleanup = false;
    }
    await queue.close();
    await redis.quit();
  }
  return { ...result, cleanup };
}

async function runCrashWorker() {
  const redis = createRedisClient();
  const worker = new Worker(
    crashQueueName,
    async (job) => {
      if (job.id !== crashJobId) throw new Error('unexpected smoke job');
      await redis.set(crashStartedKey, '1');
      await new Promise(() => {});
    },
    makeCrashWorkerOptions(),
  );
  worker.on('error', (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
  await new Promise(() => {});
}

async function runRecoveryWorker() {
  const redis = createRedisClient();
  const worker = new Worker(
    crashQueueName,
    async (job) => {
      if (job.id !== crashJobId) throw new Error('unexpected smoke job');
      return redis.incr(recoveryCallsKey);
    },
    { ...makeCrashWorkerOptions(), autorun: false },
  );
  let timeout;
  try {
    const result = await new Promise((resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error('recovery worker timed out')),
        crashRecoveryTimeoutMs,
      );
      worker.on('completed', async (job, value) => {
        if (job.id !== crashJobId) return;
        try {
          resolve({
            recoveryCalls: Number(await redis.get(recoveryCallsKey)),
            value,
          });
        } catch (error) {
          reject(error);
        }
      });
      worker.on('error', reject);
      void worker.run().catch(reject);
    });
    console.log(JSON.stringify({ ok: true, ...result }));
  } catch (error) {
    console.log(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    await worker.close();
    await redis.quit();
  }
}

async function waitForJobState(queue, id, expectedState, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await queue.getJob(id);
    if (job) {
      const state = await job.getState();
      if (state === expectedState) return job;
      if (state === 'failed') {
        throw new Error(`smoke job failed after ${job.attemptsMade} attempts`);
      }
    }
    await delay(100);
  }
  throw new Error(`timed out waiting for smoke job state=${expectedState}`);
}

async function cleanupSmokeData() {
  const redis = createRedisClient();
  const queue = createQueue();
  try {
    const job = await queue.getJob(jobId);
    if (job) await job.remove();
    await redis.del(attemptsKey);
    return (await queue.getJob(jobId)) === undefined;
  } catch {
    return false;
  } finally {
    await queue.close();
    await redis.quit();
  }
}

function createCrashQueue() {
  return new Queue(crashQueueName, {
    connection: { url: redisUrl },
  });
}

function makeCrashWorkerOptions() {
  return {
    connection: { url: redisUrl },
    lockDuration: 1_500,
    stalledInterval: 500,
    maxStalledCount: 1,
  };
}

function spawnChildProcess(childMode) {
  const child = spawn(process.execPath, [process.argv[1], childMode], {
    env: {
      ...process.env,
      BULLMQ_SMOKE_RUN_ID: runId,
      REDIS_BULLMQ_SMOKE_URL: redisUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  const closed = new Promise((resolve) => {
    child.once('error', (error) =>
      resolve({
        code: null,
        signal: null,
        error: error.message,
        stdout,
        stderr,
      }),
    );
    child.once('close', (code, signal) =>
      resolve({ code, signal, stdout: stdout.trim(), stderr: stderr.trim() }),
    );
  });
  return { child, closed };
}

async function waitForChildClose(childProcess, timeoutMs) {
  let timeout;
  const timeoutResult = new Promise((resolve) => {
    timeout = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  const result = await Promise.race([childProcess.closed, timeoutResult]);
  clearTimeout(timeout);
  return result;
}

async function stopChildProcess(childProcess) {
  if (!childProcess) return;
  if (
    childProcess.child.exitCode !== null ||
    childProcess.child.signalCode !== null
  ) {
    return;
  }
  childProcess.child.kill('SIGKILL');
  await waitForChildClose(childProcess, 3_000);
}

async function waitForRedisValue(redis, key, expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await redis.get(key)) === expected) return true;
    await delay(100);
  }
  return false;
}

function makeConfig() {
  return {
    get(key) {
      if (key === 'nodeEnv') return 'development';
      if (key === 'redis.url') return redisUrl;
      return undefined;
    },
  };
}

function createQueue() {
  return new Queue(queueName, {
    connection: { url: redisUrl },
  });
}

function createRedisClient() {
  const redis = new Redis(redisUrl, {
    connectTimeout: 1000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  redis.on('error', () => {});
  return redis;
}

async function canConnectRedis() {
  const redis = createRedisClient();
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
}

function assertIsolatedLocalRedis(value) {
  const url = new URL(value);
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  if (!['redis:', 'rediss:'].includes(url.protocol)) {
    throw new Error('BULLMQ smoke requires a Redis URL.');
  }
  if (!localHosts.has(url.hostname) || url.pathname !== '/15') {
    throw new Error(
      'BULLMQ smoke is restricted to loopback Redis database 15 to isolate application queue data.',
    );
  }
}

function parseChildOutput(child) {
  const lines = child.stdout?.trim().split(/\r?\n/) ?? [];
  for (const line of lines.reverse()) {
    try {
      return JSON.parse(line);
    } catch {
      continue;
    }
  }
  return child.stdout?.trim() || null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
