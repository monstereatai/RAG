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
const profile = process.env.PERF_RAG_PROFILE ?? 'strict';
const profileDefaults =
  profile === 'local'
    ? {
        simpleP50Ms: '5000',
        agenticP50Ms: '10000',
        simpleP95Ms: '7000',
        agenticP95Ms: '15000',
      }
    : {
        simpleP50Ms: '300',
        agenticP50Ms: '800',
        simpleP95Ms: '1000',
        agenticP95Ms: '3000',
      };
const thresholds = {
  simpleP50Ms: Number(process.env.PERF_RAG_SIMPLE_P50_MS ?? profileDefaults.simpleP50Ms),
  agenticP50Ms: Number(process.env.PERF_RAG_AGENTIC_P50_MS ?? profileDefaults.agenticP50Ms),
  simpleP95Ms: Number(process.env.PERF_RAG_SIMPLE_P95_MS ?? profileDefaults.simpleP95Ms),
  agenticP95Ms: Number(process.env.PERF_RAG_AGENTIC_P95_MS ?? profileDefaults.agenticP95Ms),
  maxErrorRate: Number(process.env.PERF_RAG_MAX_ERROR_RATE ?? '0.01'),
  maxCostUsdPerRequest: Number(
    process.env.PERF_RAG_MAX_COST_USD_PER_REQUEST ?? '0.05',
  ),
};
const inputCostUsdPer1k = Number(
  process.env.PERF_RAG_INPUT_COST_USD_PER_1K ??
    process.env.LANGFUSE_INPUT_COST_USD_PER_1K ??
    '0',
);
const outputCostUsdPer1k = Number(
  process.env.PERF_RAG_OUTPUT_COST_USD_PER_1K ??
    process.env.LANGFUSE_OUTPUT_COST_USD_PER_1K ??
    '0',
);
const costGateRequired = profile === 'strict';

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
  profile,
  enforce,
  pricing: {
    inputUsdPer1k: inputCostUsdPer1k,
    outputUsdPer1k: outputCostUsdPer1k,
    configured: inputCostUsdPer1k > 0 || outputCostUsdPer1k > 0,
    gateRequired: costGateRequired,
  },
  thresholds,
  simple,
  agentic,
  passed:
    simple.p50Ms <= thresholds.simpleP50Ms &&
    agentic.p50Ms <= thresholds.agenticP50Ms &&
    simple.p95Ms <= thresholds.simpleP95Ms &&
    agentic.p95Ms <= thresholds.agenticP95Ms &&
    (!costGateRequired ||
      (simple.costConfigured &&
        agentic.costConfigured &&
        simple.maxCostUsd <= thresholds.maxCostUsdPerRequest &&
        agentic.maxCostUsd <= thresholds.maxCostUsdPerRequest)) &&
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
  const tokenCounts = [];
  const costs = [];
  const wallStarted = performance.now();
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < samples) {
      const index = nextIndex;
      nextIndex += 1;
      const start = performance.now();
      try {
        const result = await fn();
        durations.push(Number((performance.now() - start).toFixed(2)));
        if (result) {
          tokenCounts.push(result.inputTokens ?? 0, result.outputTokens ?? 0);
          costs.push(result.costUsd ?? 0);
        }
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
    inputTokens: tokenCounts
      .filter((_, index) => index % 2 === 0)
      .reduce((sum, value) => sum + value, 0),
    outputTokens: tokenCounts
      .filter((_, index) => index % 2 === 1)
      .reduce((sum, value) => sum + value, 0),
    costConfigured: inputCostUsdPer1k > 0 || outputCostUsdPer1k > 0,
    avgCostUsd: costs.length
      ? Number(
          (costs.reduce((sum, value) => sum + value, 0) / costs.length).toFixed(
            8,
          ),
        )
      : 0,
    maxCostUsd: costs.length ? Number(Math.max(...costs).toFixed(8)) : 0,
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
  const inputTokens = Math.ceil(queryTokenEstimate(query));
  const outputTokens = Math.ceil(queryTokenEstimate(answer));
  return {
    inputTokens,
    outputTokens,
    costUsd: Number(
      (
        (inputTokens / 1000) * inputCostUsdPer1k +
        (outputTokens / 1000) * outputCostUsdPer1k
      ).toFixed(8),
    ),
  };
}

function queryTokenEstimate(value) {
  const text = String(value ?? '');
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return cjk * 0.75 + Math.max(text.length - cjk, 0) / 4;
}

function unwrap(body) {
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}

function renderMarkdown(report) {
  const row = (item) =>
    `| ${item.name} | ${item.attempted} | ${item.successRate} | ${item.errorRate} | ${item.p50Ms} | ${item.p95Ms} | ${item.throughputPerSecond} | ${item.avgCostUsd} | ${item.maxCostUsd} |`;
  return `# RAG 性能证据报告

- 生成时间：${report.generatedAt}
- 证据级别：${report.evidenceLevel}
- 服务：${report.baseUrl}
- 并发：${report.concurrency}
- 门禁 Profile：${report.profile}
- 门禁：${report.passed ? '通过' : '失败'}

| 模式 | 请求数 | 成功率 | 错误率 | P50(ms) | P95(ms) | 吞吐(req/s) | 平均成本(USD) | 最大成本(USD) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${row(report.simple)}
${row(report.agentic)}

> local Profile 用于当前本地依赖和模型配置的工程回归；strict Profile 才是部署前延迟门禁。成本门禁要求配置输入／输出单价，否则报告会明确标记为未配置；两者都不等同于真实生产 SLA。
`;
}
