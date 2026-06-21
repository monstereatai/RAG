import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import Redis from 'ioredis';

const mode = process.argv[2] ?? 'parent';
const threadId = process.env.REDIS_CHECKPOINT_SMOKE_THREAD_ID ?? 'smoke-thread';
const checkpointId =
  process.env.REDIS_CHECKPOINT_SMOKE_CHECKPOINT_ID ?? `smoke-${Date.now()}`;
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
    env: { ...process.env, REDIS_CHECKPOINT_SMOKE_CHECKPOINT_ID: checkpointId },
    encoding: 'utf8',
  });
  const reader = spawnSync(process.execPath, [process.argv[1], 'reader'], {
    env: { ...process.env, REDIS_CHECKPOINT_SMOKE_CHECKPOINT_ID: checkpointId },
    encoding: 'utf8',
  });

  const cleanup = await removeSmokeKeys();
  const ok = writer.status === 0 && reader.status === 0 && cleanup;
  console.log(
    JSON.stringify(
      {
        ok,
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
  const redis = createRedisClient();
  await redis.set(
    `checkpoint:${threadId}:${checkpointId}`,
    JSON.stringify({
      v: 1,
      id: checkpointId,
      ts: new Date().toISOString(),
      channel_values: { smoke: 'writer' },
      channel_versions: {},
      versions_seen: {},
    }),
    'EX',
    300,
  );
  await redis.set(`checkpoint:latest:${threadId}`, checkpointId, 'EX', 300);
  await redis.zadd(`thread:${threadId}`, Date.now(), checkpointId);
  await redis.quit();
  console.log(JSON.stringify({ ok: true, wrote: checkpointId }));
} else if (mode === 'reader') {
  const redis = createRedisClient();
  const latest = await redis.get(`checkpoint:latest:${threadId}`);
  const checkpoint = latest
    ? await redis.get(`checkpoint:${threadId}:${latest}`)
    : null;
  const listed = await redis.zrange(`thread:${threadId}`, 0, -1);
  await redis.quit();
  const ok = latest === checkpointId && Boolean(checkpoint);
  console.log(
    JSON.stringify({
      ok,
      latest,
      listedCount: listed.length,
      checkpointFound: Boolean(checkpoint),
    }),
  );
  if (!ok) process.exitCode = 1;
} else {
  throw new Error(`unknown mode: ${mode}`);
}

async function removeSmokeKeys() {
  const redis = createRedisClient();
  try {
    await redis.del(`checkpoint:${threadId}:${checkpointId}`);
    await redis.del(`checkpoint:latest:${threadId}`);
    await redis.del(`thread:${threadId}`);
    return true;
  } finally {
    await redis.quit();
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
  let parsed;
  try {
    parsed = stdout ? JSON.parse(stdout) : undefined;
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
