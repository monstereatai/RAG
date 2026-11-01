import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const exec = promisify(execFile);
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
export const id = () => randomUUID();
export const opt = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
};
export function requireIsolated() {
  if (process.env.PLATFORM_VALIDATION_ISOLATED !== 'I_ACKNOWLEDGE_DISPOSABLE_TEST_ENV') {
    throw new Error('Set PLATFORM_VALIDATION_ISOLATED=I_ACKNOWLEDGE_DISPOSABLE_TEST_ENV; tests create their OWN disposable Docker Redis container.');
  }
}
export async function cmd(command, args, { timeout = 120_000 } = {}) {
  const result = await exec(command, args, { timeout, maxBuffer: 4 * 1024 * 1024 });
  return result.stdout.trim();
}
export async function report(file, data) {
  const target = resolve(file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), ...data }, null, 2) + '\n', { mode: 0o600 });
  await chmod(target, 0o600);
  return target;
}
export function percentile(values, p) {
  if (!values.length) return null;
  const xs = [...values].sort((a, b) => a - b);
  return xs[Math.ceil(xs.length * p) - 1];
}
/** Resolve Docker's actual host binding. A dynamic -p mapping can change after stop/start. */
export function dockerRedisUrl(binding) {
  const endpoints = String(binding).split(/\r?\n/).map((line) => line.trim());
  const local = endpoints.find((line) => /^127\.0\.0\.1:[0-9]+$/.test(line));
  const port = local ? Number(local.slice('127.0.0.1:'.length)) : NaN;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`Disposable Redis must bind to 127.0.0.1 on an ephemeral port; got: ${binding}`);
  }
  return `redis://127.0.0.1:${port}`;
}

export async function disposableRedis(callback) {
  requireIsolated();
  // Never accept external Redis addresses for fault injection. The container is
  // created here with a unique name, bound ONLY to 127.0.0.1.
  const name = `rag-verify-${id().slice(0, 12)}`;
  const image = process.env.PLATFORM_VALIDATION_REDIS_IMAGE || 'redis:7.4-alpine';
  let created = false;
  try {
    await cmd('docker', [
      'run', '-d', '--name', name, '--label', 'rag.platform.validation=disposable',
      '-p', '127.0.0.1::6379', image, 'redis-server', '--appendonly', 'yes',
      '--appendfsync', 'always', '--save', '60', '1',
    ]);
    created = true;
    const redisUrl = async () =>
      dockerRedisUrl(await cmd('docker', ['port', name, '6379/tcp']));
    const url = await redisUrl();
    return await callback({ name, url, redisUrl, docker: (action) => cmd('docker', [action, name]) });
  } finally {
    if (created) await cmd('docker', ['rm', '-f', name]).catch(() => {});
  }
}
export async function awaitRedis(url, timeoutMs = 15_000) {
  const { default: Redis } = await import('ioredis');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const client = new Redis(url, {
      connectTimeout: 1_000, maxRetriesPerRequest: 0, retryStrategy: () => null,
    });
    client.on('error', () => {});
    try { await client.ping(); return client; }
    catch { client.disconnect(); await sleep(200); }
  }
  throw new Error(`Disposable Redis not reachable before deadline: ${url} (waited ${timeoutMs}ms)`);
}
