import { writeEvidenceReport } from './lib/evidence-utils.mjs';
import {
  parseBoolean,
  percentile,
  rate,
  safeError,
} from './lib/evidence-utils.mjs';

const baseUrl = (
  process.env.PERF_RAG_BASE_URL ?? 'http://localhost:3000'
).replace(/\/$/, '');
const samples = Number(process.env.PERF_RAG_SAMPLES ?? '3');
const concurrency = Math.max(
  1,
  Number(process.env.PERF_RAG_CONCURRENCY ?? '1'),
);
const enforce = parseBoolean(process.env.PERF_RAG_ENFORCE);
const outputPath =
  process.env.PERF_RAG_OUTPUT ?? '.tmp/evidence/rag-performance.json';
if (!Number.isInteger(samples) || samples < 1) {
  throw new Error('PERF_RAG_SAMPLES 必须是大于 0 的整数。');
}
if (!Number.isInteger(concurrency) || concurrency < 1) {
  throw new Error('PERF_RAG_CONCURRENCY 必须是大于 0 的整数。');
}
const thresholds = {
  simpleP50Ms: Number(process.env.PERF_RAG_SIMPLE_P50_MS ?? '300'),
  agenticP50Ms: Number(process.env.PERF_RAG_AGENTIC_P50_MS ?? '800'),
  simpleP95Ms: Number(process.env.PERF_RAG_SIMPLE_P95_MS ?? '1000'),
  agenticP95Ms: Number(process.env.PERF_RAG_AGENTIC_P95_MS ?? '3000'),
  maxErrorRate: Number(process.env.PERF_RAG_MAX_ERROR_RATE ?? '0.01'),
};

const token = await getToken();
const simple = await measure('simple', () =>
  postChat('RAG 性能基准：用一句话说明 RAG 是什么', 'simple'),
);
const agentic = await measure('agentic', () =>
  postChat('RAG 性能基准：列出 RAG 回答的关键步骤', 'agentic'),
);

const report = {
  schemaVersion: 1,
  evidenceLevel: 'local_real_api',
  generatedAt: new Date().toISOString(),
  baseUrl,
  samples,
  concurrency,
  enforce,
  thresholds,
  simple,
  agentic,
  passed:
    simple.p50Ms <= thresholds.simpleP50Ms &&
    agentic.p50Ms <= thresholds.agenticP50Ms &&
    simple.p95Ms <= thresholds.simpleP95Ms &&
    agentic.p95Ms <= thresholds.agenticP95Ms &&
    simple.errorRate <= thresholds.maxErrorRate &&
    agentic.errorRate <= thresholds.maxErrorRate,
};

console.log(JSON.stringify(report, null, 2));
await writeEvidenceReport(outputPath, report, renderMarkdown(report));

if (enforce && !report.passed) {
  process.exitCode = 1;
}

async function measure(name, fn) {
  const durations = [];
  const errors = [];
  const wallStarted = performance.now();
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < samples) {
      const index = nextIndex;
      nextIndex += 1;
      const start = performance.now();
      try {
        await fn();
        durations.push(Number((performance.now() - start).toFixed(2)));
      } catch (error) {
        errors.push({ index, error: safeError(error) });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, samples) }, () => worker()),
  );

  durations.sort((a, b) => a - b);
  const wallDurationMs = Number((performance.now() - wallStarted).toFixed(2));
  return {
    name,
    attempted: samples,
    succeeded: durations.length,
    failed: errors.length,
    successRate: rate(durations.length, samples),
    errorRate: rate(errors.length, samples),
    throughputPerSecond: Number(
      (durations.length / Math.max(wallDurationMs / 1000, 0.001)).toFixed(3),
    ),
    wallDurationMs,
    minMs: durations[0] ?? 0,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    maxMs: durations[durations.length - 1] ?? 0,
    durationsMs: durations,
    errors,
  };
}

async function getToken() {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.PERF_RAG_USERNAME ?? 'user',
      password: process.env.PERF_RAG_PASSWORD ?? 'user1234',
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return unwrap(body).accessToken;
}

async function postChat(query, mode) {
  const res = await fetch(`${baseUrl}/api/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, mode }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      `${mode} chat failed: ${res.status} ${JSON.stringify(body)}`,
    );
  }
  const answer = unwrap(body).answer;
  if (!answer) {
    throw new Error(`${mode} chat returned empty answer`);
  }
}

function unwrap(body) {
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}

function renderMarkdown(report) {
  const row = (item) =>
    `| ${item.name} | ${item.attempted} | ${item.successRate} | ${item.errorRate} | ${item.p50Ms} | ${item.p95Ms} | ${item.throughputPerSecond} |`;
  return `# RAG 性能证据报告

- 生成时间：${report.generatedAt}
- 证据级别：${report.evidenceLevel}
- 服务：${report.baseUrl}
- 并发：${report.concurrency}
- 门禁：${report.passed ? '通过' : '失败'}

| 模式 | 请求数 | 成功率 | 错误率 | P50(ms) | P95(ms) | 吞吐(req/s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${row(report.simple)}
${row(report.agentic)}

> 本报告证明指定环境的一次受控运行结果，不等同于生产长期 SLA。
`;
}
