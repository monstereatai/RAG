import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProductionWorkflowHandoff, RagApiClient } from '../src/rag-api-client.js';

test('RagApiClient unwraps standard response envelope', async () => {
  const client = new RagApiClient({
    baseUrl: 'http://rag.test/api/v1',
    token: 'test-token',
    fetchImpl: async (url, init) => {
      assert.equal(String(url), 'http://rag.test/api/v1/rag/search');
      assert.equal(init?.method, 'POST');
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-token');
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            query: '组件',
            chunks: [{ id: 'c1', content: '内部组件用法' }],
            status: 'insufficient_context',
            retrievalSufficient: false,
            retrievalReason: '候选片段未通过检索质量门禁',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });

  const result = await client.search('组件', 3);
  assert.equal(result.query, '组件');
  assert.equal(result.chunks?.[0]?.content, '内部组件用法');
  assert.equal(result.status, 'insufficient_context');
  assert.equal(result.retrievalSufficient, false);
  assert.equal(result.retrievalReason, '候选片段未通过检索质量门禁');
});

test('RagApiClient falls back to debug chunks when formal search is missing', async () => {
  let called = 0;
  const client = new RagApiClient({
    baseUrl: 'http://rag.test/api/v1',
    token: 'test-token',
    fetchImpl: async (url) => {
      called += 1;
      if (called === 1) {
        return new Response(JSON.stringify({ message: 'not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      assert.equal(String(url), 'http://rag.test/api/v1/debug/chunks?query=NestJS&k=2');
      return new Response(JSON.stringify({ query: 'NestJS', chunks: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await client.search('NestJS', 2);
  assert.equal(result.query, 'NestJS');
  assert.equal(called, 2);
});

test('RagApiClient calls Supervisor multi-agent pipeline endpoint', async () => {
  const client = new RagApiClient({
    baseUrl: 'http://rag.test/api/v1',
    token: 'test-token',
    fetchImpl: async (url, init) => {
      assert.equal(String(url), 'http://rag.test/api/v1/supervisor/query');
      assert.equal(init?.method, 'POST');
      assert.equal(init?.body, JSON.stringify({ query: '复杂技术方案' }));
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            domain: 'tech',
            answer: '方案结果',
            confidence: 0.88,
            stages: [{ agent: 'researcher', durationMs: 10, confidence: 0.9 }],
            totalDurationMs: 20,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });

  const result = await client.supervisorQuery('复杂技术方案');
  assert.equal(result.domain, 'tech');
  assert.equal(result.stages[0]?.agent, 'researcher');
});

test('RagApiClient auto logs in when token is missing', async () => {
  const calls: string[] = [];
  const client = new RagApiClient({
    baseUrl: 'http://rag.test/api/v1',
    username: 'admin',
    password: 'admin123',
    fetchImpl: async (url, init) => {
      calls.push(String(url));
      if (String(url).endsWith('/auth/login')) {
        assert.equal(init?.body, JSON.stringify({ username: 'admin', password: 'admin123' }));
        return new Response(JSON.stringify({ accessToken: 'fresh-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer fresh-token');
      return new Response(JSON.stringify({ query: '业务规则', chunks: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await client.search('业务规则', 5);
  assert.equal(result.query, '业务规则');
  assert.deepEqual(calls, ['http://rag.test/api/v1/auth/login', 'http://rag.test/api/v1/rag/search']);
});

test('RagApiClient refreshes token and retries once on unauthorized', async () => {
  let loginCount = 0;
  let searchCount = 0;
  const client = new RagApiClient({
    baseUrl: 'http://rag.test/api/v1',
    token: 'expired-token',
    username: 'admin',
    password: 'admin123',
    fetchImpl: async (url) => {
      if (String(url).endsWith('/auth/login')) {
        loginCount += 1;
        return new Response(JSON.stringify({ accessToken: 'refreshed-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      searchCount += 1;
      if (searchCount === 1) {
        return new Response(JSON.stringify({ message: 'token invalid or expired' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ query: '业务规则', chunks: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await client.search('业务规则', 5);
  assert.equal(result.query, '业务规则');
  assert.equal(loginCount, 1);
  assert.equal(searchCount, 2);
});

test('RagApiClient calls governance, workflow and scheduled-job read endpoints', async () => {
  const paths: string[] = [];
  const client = new RagApiClient({
    baseUrl: 'http://rag.test/api/v1',
    token: 'test-token',
    fetchImpl: async (url) => {
      paths.push(new URL(String(url)).pathname);
      return new Response(JSON.stringify({ code: 0, data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await client.productionWorkflowStatus('thread 1');
  await client.listDocuments();
  await client.documentStatus('doc 1');
  await client.documentTaskStatus('task 1');
  await client.listScheduledJobs();
  await client.scheduledJobExecutions('job 1');

  assert.deepEqual(paths, [
    '/api/v1/workflows/production/thread%201',
    '/api/v1/documents',
    '/api/v1/documents/doc%201',
    '/api/v1/documents/tasks/task%201',
    '/api/v1/jobs',
    '/api/v1/jobs/job%201/executions',
  ]);
});

test('buildProductionWorkflowHandoff keeps Markdown, Schemas and RAG citations together', () => {
  const handoff = buildProductionWorkflowHandoff({
    threadId: 'thread-1',
    projectId: 'act10',
    stages: [{
      role: 'product',
      summary: '活动需求已经梳理。',
      deliverables: [{ title: 'PRD', markdown: '# 活动规则' }],
      lowCodeSchemas: [{ schemaVersion: 1, kind: 'pageSchema', title: '活动页' }],
      evidence: [{ id: 'e-1', docId: 'rule-doc', chunkIndex: 3, excerpt: '奖池规则。', totalScore: 0.91 }],
    }],
  });

  assert.equal(handoff.threadId, 'thread-1');
  assert.equal((handoff.schemas as unknown[]).length, 1);
  assert.equal((handoff.citations as unknown[]).length, 1);
  assert.match(String(handoff.markdown), /# 活动规则/);
  assert.match(String(handoff.markdown), /奖池规则/);
});
