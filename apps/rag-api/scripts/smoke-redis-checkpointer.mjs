import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import Redis from 'ioredis';

const require = createRequire(import.meta.url);
const { RedisCheckpointer } = require('../dist/src/providers/langgraph-checkpointer/redis-checkpointer.js');
const { RedisProvider } = require('../dist/src/providers/redis/redis.provider.js');

const mode = process.argv[2] ?? 'parent';
const threadId =
  process.env.REDIS_CHECKPOINT_SMOKE_THREAD_ID ?? `smoke-${randomUUID()}`;
const checkpointId =
  process.env.REDIS_CHECKPOINT_SMOKE_CHECKPOINT_ID ?? `smoke-${randomUUID()}`;
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

if (mode === 'parent') {
  if (!(await canConnectRedis())) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          skipped: true,
          reason: 'Redis is not reachable',
          redisUrl: redactRedisUrl(redisUrl),
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  const writer = spawnSync(process.execPath, [process.argv[1], 'writer'], {
    env: {
      ...process.env,
      REDIS_CHECKPOINT_SMOKE_THREAD_ID: threadId,
      REDIS_CHECKPOINT_SMOKE_CHECKPOINT_ID: checkpointId,
    },
    encoding: 'utf8',
  });
  const reader = spawnSync(process.execPath, [process.argv[1], 'reader'], {
    env: {
      ...process.env,
      REDIS_CHECKPOINT_SMOKE_THREAD_ID: threadId,
      REDIS_CHECKPOINT_SMOKE_CHECKPOINT_ID: checkpointId,
    },
    encoding: 'utf8',
  });

  const cleanup = await removeSmokeCheckpoint();
  const ok = writer.status === 0 && reader.status === 0 && cleanup;
  console.log(
    JSON.stringify(
      {
        ok,
        topology: 'two-process-shared-redis',
        recovery: 'writer-instance-to-reader-instance',
        threadId,
        checkpointId,
        writer: parseChildOutput(writer),
        reader: parseChildOutput(reader),
        cleanup,
      },
      null,
      2,
    ),
  );
  if (!ok) process.exitCode = 1;
} else if (mode === 'writer') {
  await withCheckpointer(async (checkpointer) => {
    await checkpointer.put(
      { configurable: { thread_id: threadId } },
      {
        v: 1,
        id: checkpointId,
        ts: new Date().toISOString(),
        channel_values: { smoke: 'writer' },
        channel_versions: {},
        versions_seen: {},
      },
      { source: 'smoke', step: 1 },
    );
  });
  console.log(JSON.stringify({ ok: true, wrote: checkpointId }));
} else if (mode === 'reader') {
  await withCheckpointer(async (checkpointer) => {
    const config = { configurable: { thread_id: threadId } };
    const latest = await checkpointer.getTuple(config);
    const listed = [];
    for await (const tuple of checkpointer.list(config, { limit: 1 })) {
      listed.push(tuple);
    }
    const ok =
      latest?.checkpoint.id === checkpointId &&
      latest.metadata?.source === 'smoke' &&
      listed[0]?.checkpoint.id === checkpointId;
    console.log(
      JSON.stringify({
        ok,
        latestCheckpointId: latest?.checkpoint.id ?? null,
        listedCount: listed.length,
        metadataFound: latest?.metadata?.source === 'smoke',
      }),
    );
    if (!ok) process.exitCode = 1;
  });
} else {
  throw new Error(`unknown mode: ${mode}`);
}

async function removeSmokeCheckpoint() {
  let removed = false;
  try {
    await withCheckpointer(async (checkpointer) => {
      await checkpointer.deleteThread(threadId);
      removed = (await checkpointer.getTuple({
        configurable: { thread_id: threadId },
      })) === undefined;
    });
    return removed;
  } catch {
    return false;
  }
}

async function withCheckpointer(run) {
  const provider = new RedisProvider({
    get: (key) => (key === 'redis.url' ? redisUrl : undefined),
  });
  provider.onModuleInit();
  try {
    const deadline = Date.now() + 5000;
    while (!provider.isEnabled() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!provider.isEnabled()) throw new Error('Redis failed to connect');
    const checkpointer = new RedisCheckpointer(provider, 300, undefined, true);
    return await run(checkpointer);
  } finally {
    provider.onModuleDestroy();
  }
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

function createRedisClient() {
  const client = new Redis(redisUrl, {
    connectTimeout: 1000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  client.on('error', () => {
    // The parent preflight converts connection failures into a skipped result.
  });
  return client;
}

function redactRedisUrl(url) {
  return url.replace(/:\/\/([^:@]+):([^@]+)@/, '://$1:***@');
}

function parseChildOutput(child) {
  const stdout = child.stdout?.trim();
  const jsonLine = stdout
    ?.split(/\r?\n/)
    .reverse()
    .find((line) => line.trim().startsWith('{'));
  let parsed;
  try {
    parsed = jsonLine ? JSON.parse(jsonLine) : undefined;
  } catch {
    parsed = stdout;
  }
  return {
    status: child.status,
    ok: child.status === 0,
    output: parsed,
    stderr: child.stderr?.trim() || undefined,
  };
}
