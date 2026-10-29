import { createServer as createHttpServer, type IncomingMessage } from 'node:http';
import { pathToFileURL } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { withHttpBearer, currentHttpBearer } from './http-auth-context.js';
import { loadConfig } from './config.js';
import { createServer } from './server.js';

const DEFAULT_PORT = 3100;
const DEFAULT_RATE_LIMIT = 120;
const DEFAULT_RATE_WINDOW_MS = 60_000;
const MAX_REQUEST_BYTES = 1_048_576;

interface CallerProfile {
  userId: string;
  tenantId: string;
}

interface RateWindow {
  startedAt: number;
  count: number;
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const rateWindows = new Map<string, RateWindow>();
  const rateLimit = readPositiveInt(
    process.env.RAG_MCP_HTTP_RATE_LIMIT,
    DEFAULT_RATE_LIMIT,
  );
  const rateWindowMs = readPositiveInt(
    process.env.RAG_MCP_HTTP_RATE_WINDOW_MS,
    DEFAULT_RATE_WINDOW_MS,
  );
  const server = createHttpServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://localhost');
    if (requestUrl.pathname === '/healthz' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (requestUrl.pathname !== '/mcp') {
      response.writeHead(404).end();
      return;
    }

    const bearer = extractBearer(request.headers.authorization);
    if (!bearer) {
      response.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end();
      return;
    }

    try {
      await withHttpBearer(bearer, async () => {
        const caller = await validateCaller(config.baseUrl, bearer, config.timeoutMs);
        if (!caller) {
          response.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end();
          return;
        }

        if (!takeRateLimit(rateWindows, `${caller.tenantId}:${caller.userId}`, rateLimit, rateWindowMs)) {
          response.writeHead(429, { 'Retry-After': String(Math.ceil(rateWindowMs / 1000)) }).end();
          return;
        }

        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        const parsedBody = request.method === 'POST'
          ? await readJsonBody(request, response)
          : undefined;
        if (request.method === 'POST' && parsedBody === undefined) return;
        // Stateless transports accept one HTTP request only. Reusing one after
        // initialize makes every subsequent tools/list or tools/call fail.
        const readOnlyMcp = await createServer({
          httpMode: true,
          tokenProvider: currentHttpBearer,
        });
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        try {
          await readOnlyMcp.connect(transport);
          await transport.handleRequest(request, response, parsedBody);
        } finally {
          await readOnlyMcp.close();
        }
      });
    } catch {
      if (!response.headersSent) {
        response.writeHead(503, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'RAG backend unavailable' }));
      } else if (!response.writableEnded) {
        response.end();
      }
    }
  });

  const host = process.env.RAG_MCP_HTTP_HOST?.trim() || '127.0.0.1';
  const port = readPositiveInt(process.env.RAG_MCP_HTTP_PORT, DEFAULT_PORT);
  server.listen(port, host, () => {
    process.stdout.write(`RAG MCP Streamable HTTP listening on http://${host}:${port}/mcp\n`);
  });

  const shutdown = () => {
    server.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

async function validateCaller(
  baseUrl: string,
  bearer: string,
  timeoutMs: number,
): Promise<CallerProfile | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/auth/profile`, {
      headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw new Error(`RAG profile request failed: ${response.status}`);
    const raw: unknown = await response.json();
    const payload = isRecord(raw) && isRecord(raw.data) ? raw.data : raw;
    if (!isRecord(payload)) return null;
    const userId = typeof payload.userId === 'string' ? payload.userId.trim() : '';
    const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId.trim() : '';
    return userId && tenantId ? { userId, tenantId } : null;
  } finally {
    clearTimeout(timeout);
  }
}

function takeRateLimit(
  windows: Map<string, RateWindow>,
  identity: string,
  maxRequests: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const current = windows.get(identity);
  if (!current || now - current.startedAt >= windowMs) {
    windows.set(identity, { startedAt: now, count: 1 });
    if (windows.size > 10_000) {
      for (const [key, value] of windows) {
        if (now - value.startedAt >= windowMs) windows.delete(key);
      }
    }
    return true;
  }
  if (current.count >= maxRequests) return false;
  current.count += 1;
  return true;
}

function extractBearer(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string' || header.length > 8192) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

async function readJsonBody(
  request: IncomingMessage,
  response: import('node:http').ServerResponse,
): Promise<unknown | undefined> {
  const contentType = request.headers['content-type'] ?? '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    response.writeHead(415).end();
    return undefined;
  }
  const contentLength = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    response.writeHead(413).end();
    return undefined;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) {
      response.writeHead(413).end();
      return undefined;
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'invalid JSON request body' }));
    return undefined;
  }
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown startup error';
    process.stderr.write(`rag-mcp-http-server failed: ${message}\n`);
    process.exitCode = 1;
  });
}
