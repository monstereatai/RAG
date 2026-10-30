import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { MAX_REQUEST_BYTES } from './contracts.mjs';

const PORT = Number(process.env.PORT ?? 4321);
const BUILD_TIMEOUT_MS = 12_000;
const MAX_BUILD_OUTPUT_BYTES = 2 * 1024 * 1024;

function send(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const contentLength = Number(request.headers['content-length'] ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) throw new Error('Request body is too large.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function buildInChild(payload) {
  return new Promise((resolve, reject) => {
    const workerPath = fileURLToPath(new URL('./build-preview.mjs', import.meta.url));
    const child = spawn(process.execPath, ['--max-old-space-size=384', workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { NODE_ENV: 'production', HOME: '/tmp' },
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, new Error(`Preview build exceeded ${BUILD_TIMEOUT_MS} ms.`));
    }, BUILD_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_BUILD_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish(reject, new Error('Preview build output is too large.'));
        return;
      }
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8_000);
    });
    child.on('error', (error) => finish(reject, error));
    child.on('close', (code) => {
      if (code !== 0) {
        finish(reject, new Error(stderr || `Preview build exited with ${code}.`));
        return;
      }
      try {
        finish(resolve, JSON.parse(stdout).html);
      } catch {
        finish(reject, new Error('Preview build returned an invalid response.'));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export function createPreviewRunner() {
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      send(response, 200, { status: 'ok' });
      return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/preview') {
      send(response, 404, { message: 'Not found.' });
      return;
    }
    try {
      const payload = await readBody(request);
      const html = await buildInChild(payload);
      send(response, 200, { html });
    } catch (error) {
      send(response, 400, {
        message: error instanceof Error ? error.message : 'Preview build failed.',
      });
    }
  });
  server.headersTimeout = 5_000;
  server.requestTimeout = 15_000;
  server.maxRequestsPerSocket = 20;
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createPreviewRunner();
  server.listen(PORT, '0.0.0.0', () => {
    process.stdout.write(`Preview runner listening on ${PORT}\n`);
  });
}
