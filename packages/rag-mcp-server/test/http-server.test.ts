import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('stateless HTTP MCP serves requests after initialize with each caller bearer', async () => {
  const forwarded: string[] = [];
  const rag = createServer((request, response) => {
    const bearer = request.headers.authorization ?? '';
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/v1/auth/profile') {
      if (bearer !== 'Bearer token-a' && bearer !== 'Bearer token-b') {
        response.writeHead(401).end('{}');
        return;
      }
      response.end(JSON.stringify({ data: { userId: bearer.slice(-1), tenantId: 'tenant-1' } }));
      return;
    }
    if (request.url === '/api/v1/rag/search') {
      forwarded.push(bearer);
      response.end(JSON.stringify({ data: { query: 'test', chunks: [] } }));
      return;
    }
    response.writeHead(404).end('{}');
  });
  await new Promise<void>((resolve) => rag.listen(0, '127.0.0.1', resolve));
  const ragAddress = rag.address();
  assert.ok(ragAddress && typeof ragAddress !== 'string');

  const reserved = createServer();
  await new Promise<void>((resolve) => reserved.listen(0, '127.0.0.1', resolve));
  const mcpAddress = reserved.address();
  assert.ok(mcpAddress && typeof mcpAddress !== 'string');
  await new Promise<void>((resolve) => reserved.close(() => resolve()));

  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/http-server.js', import.meta.url))], {
    env: {
      ...process.env,
      RAG_MCP_BASE_URL: `http://127.0.0.1:${ragAddress.port}/api/v1`,
      RAG_MCP_HTTP_HOST: '127.0.0.1',
      RAG_MCP_HTTP_PORT: String(mcpAddress.port),
      RAG_MCP_TOKEN: '',
      RAG_MCP_USERNAME: '',
      RAG_MCP_PASSWORD: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await Promise.race([
      new Promise<void>((resolve) => child.stdout.once('data', () => resolve())),
      new Promise<never>((_, reject) => child.once('exit', (code) => reject(new Error(`MCP exited: ${code}`)))),
    ]);
    const call = async (token: string, id: number, method: string, params: unknown) => {
      const response = await fetch(`http://127.0.0.1:${mcpAddress.port}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': '2025-06-18',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      });
      const body = await response.text();
      assert.equal(response.status, 200, `${method}: ${body}`);
      return body;
    };
    await call('token-a', 1, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance', version: '1' },
    });
    const tools = await call('token-a', 2, 'tools/list', {});
    assert.match(tools, /rag_search/);
    assert.doesNotMatch(tools, /rag_workflow_run/);
    await call('token-a', 3, 'tools/call', { name: 'rag_search', arguments: { query: 'a' } });
    await call('token-b', 4, 'tools/call', { name: 'rag_search', arguments: { query: 'b' } });
    assert.deepEqual(forwarded, ['Bearer token-a', 'Bearer token-b']);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    }
    rag.closeAllConnections();
    await new Promise<void>((resolve) => rag.close(() => resolve()));
  }
});
