import test from 'node:test';
import assert from 'node:assert/strict';
import { RagApiClient } from '../src/core/api-client.js';
import { CliError } from '../src/core/errors.js';

test('RagApiClient unwraps Nest transform response data', async () => {
  const client = new RagApiClient({
    baseUrl: 'http://example.test/api/v1',
    token: 'token',
    fetchImpl: async () =>
      new Response(JSON.stringify({ code: 200, data: { status: 'ok' }, message: 'success' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });

  const result = await client.profile();
  assert.deepEqual(result, { status: 'ok' });
});

test('RagApiClient maps 401 to unauthorized CliError', async () => {
  const client = new RagApiClient({
    baseUrl: 'http://example.test/api/v1',
    token: 'bad',
    fetchImpl: async () =>
      new Response(JSON.stringify({ message: 'token invalid or expired' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
  });

  await assert.rejects(() => client.profile(), (error) => {
    assert.ok(error instanceof CliError);
    assert.equal(error.code, 'unauthorized');
    return true;
  });
});

test('RagApiClient parses chat SSE events with CRLF delimiters', async () => {
  const client = new RagApiClient({
    baseUrl: 'http://example.test/api/v1',
    token: 'token',
    fetchImpl: async () =>
      new Response(
        [
          'data: {"type":"token","data":"你"}\r\n\r\n',
          'data: {"type":"token","data":"好"}\r\n\r\n',
          'data: {"type":"final","data":{"answer":"你好"}}\r\n\r\n',
        ].join(''),
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        },
      ),
  });

  const events = [];
  for await (const event of client.streamChat({ query: 'hi', mode: 'auto' })) {
    events.push(event);
  }

  assert.deepEqual(
    events.map((event) => event.type),
    ['token', 'token', 'final'],
  );
});

test('RagApiClient calls document, workflow and scheduled-job endpoints', async () => {
  const requestedPaths: string[] = [];
  const client = new RagApiClient({
    baseUrl: 'http://example.test/api/v1',
    token: 'token',
    fetchImpl: async (url) => {
      requestedPaths.push(new URL(String(url)).pathname);
      return new Response(JSON.stringify({ code: 200, data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await client.getDocumentTask('task 1');
  await client.listProductionWorkflows();
  await client.getProductionWorkflow('thread 1');
  await client.getProductionWorkflowCodingContext('thread 1');
  await client.listScheduledJobs();
  await client.getScheduledJobVersions('job 1');
  await client.getScheduledJobExecutions('job 1');
  await client.runScheduledJob('job 1');
  await client.copyScheduledJob('job 1');
  await client.setScheduledJobStatus('job 1', 'stop');

  assert.deepEqual(requestedPaths, [
    '/api/v1/documents/tasks/task%201',
    '/api/v1/workflows/production',
    '/api/v1/workflows/production/thread%201',
    '/api/v1/workflows/production/thread%201/coding-context',
    '/api/v1/jobs',
    '/api/v1/jobs/job%201/versions',
    '/api/v1/jobs/job%201/executions',
    '/api/v1/jobs/job%201/run',
    '/api/v1/jobs/job%201/copy',
    '/api/v1/jobs/job%201/stop',
  ]);
});
