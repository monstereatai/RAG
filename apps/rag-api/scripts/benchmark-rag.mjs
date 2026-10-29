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
  autoP50Ms: Number(
    process.env.PERF_RAG_AUTO_P50_MS ??
      profileDefaults.autoP50Ms ??
      (profile === 'local' ? '8000' : '500'),
  ),
  agenticP50Ms: Number(process.env.PERF_RAG_AGENTIC_P50_MS ?? profileDefaults.agenticP50Ms),
  simpleP95Ms: Number(process.env.PERF_RAG_SIMPLE_P95_MS ?? profileDefaults.simpleP95Ms),
  autoP95Ms: Number(
    process.env.PERF_RAG_AUTO_P95_MS ??
      profileDefaults.autoP95Ms ??
      (profile === 'local' ? '12000' : '1500'),
  ),
  agenticP95Ms: Number(process.env.PERF_RAG_AGENTIC_P95_MS ?? profileDefaults.agenticP95Ms),
  maxErrorRate: Number(process.env.PERF_RAG_MAX_ERROR_RATE ?? '0.01'),
  maxCostUsdPerRequest: Number(
    process.env.PERF_RAG_MAX_COST_USD_PER_REQUEST ?? '0.05',
  ),
};
const serviceToken =
  process.env.PERF_RAG_SERVICE_TOKEN?.trim() ||
  process.env.RAG_SERVICE_TOKEN?.trim() ||
  null;
const costGateRequired = profile === 'strict';
const minimumCostCoverage = Number(
  process.env.PERF_RAG_MIN_COST_COVERAGE ?? '0.9',
);
if (
  !Number.isFinite(minimumCostCoverage) ||
  minimumCostCoverage < 0.9 ||
  minimumCostCoverage > 1
) {
  throw new Error('PERF_RAG_MIN_COST_COVERAGE 必须在 0.9 到 1 之间。');
}
const requestedModes = (process.env.PERF_RAG_MODES ?? 'simple,agentic')
  .split(',')
  .map((mode) => mode.trim())
  .filter(Boolean);
const validModes = new Set(['simple', 'auto', 'agentic']);
for (const mode of requestedModes) {
  if (validModes.has(mode) === false) {
    throw new Error(`PERF_RAG_MODES 包含不支持的 mode: ${mode}`);
  }
}
const modeQueries = {
  simple:
    process.env.PERF_RAG_QUERY_SIMPLE ??
    'RAG 性能基准：用一句话说明 RAG 是什么',
  auto:
    process.env.PERF_RAG_QUERY_AUTO ??
    'RAG 性能基准：RAG 系统有哪些关键组件？',
  agentic:
    process.env.PERF_RAG_QUERY_AGENTIC ??
    'RAG 性能基准：列出 RAG 回答的关键步骤',
};

const requestTimeoutMs = Number(
  process.env.PERF_RAG_REQUEST_TIMEOUT_MS ?? '120000',
);

const token = await getToken();
const measurements = {};
for (const mode of requestedModes) {
  measurements[mode] = await measure(mode, () =>
    postChat(modeQueries[mode], mode),
  );
}

const report = {
  schemaVersion: 1,
  evidenceLevel: 'local_real_api',
  generatedAt: new Date().toISOString(),
  baseUrl,
  samples,
  concurrency,
  profile,
  enforce,
  costMeasurement: {
    source: 'agent_runtime_event.cost.estimated',
    amountSemantics: 'estimated_cost_usd',
    serviceTokenConfigured: Boolean(serviceToken),
    gateRequired: costGateRequired,
    minimumCoverage: minimumCostCoverage,
  },
  thresholds,
  modes: requestedModes,
  results: measurements,
  simple: measurements.simple ?? null,
  auto: measurements.auto ?? null,
  agentic: measurements.agentic ?? null,
  passed: requestedModes.every((mode) => {
    const result = measurements[mode];
    const p50Limit =
      thresholds[`${mode}P50Ms`] ?? thresholds.agenticP50Ms;
    const p95Limit =
      thresholds[`${mode}P95Ms`] ?? thresholds.agenticP95Ms;
    return (
      result.p50Ms <= p50Limit &&
      result.p95Ms <= p95Limit &&
      result.errorRate <= thresholds.maxErrorRate &&
      (costGateRequired === false ||
        (result.costCoverage >= minimumCostCoverage &&
          result.maxCostUsd <= thresholds.maxCostUsdPerRequest))
    );
  }),
};

console.log(JSON.stringify(report, null, 2));
await writeEvidenceReport(outputPath, report, renderMarkdown(report));

if (enforce && !report.passed) {
  process.exitCode = 1;
}

async function measure(name, fn) {
  const durations = [];
  const errors = [];
  const successfulResponses = [];
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
        successfulResponses.push(result);
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
  const usageRecords = await Promise.all(
    successfulResponses.map((result) => readEstimatedRunUsage(result.runId)),
  );
  const costs = usageRecords
    .filter((usage) => usage.status === 'available')
    .map((usage) => usage.costUsdEstimated);
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
    inputTokens: usageRecords
      .filter((usage) => usage.status === 'available')
      .reduce((sum, usage) => sum + usage.inputTokens, 0),
    outputTokens: usageRecords
      .filter((usage) => usage.status === 'available')
      .reduce((sum, usage) => sum + usage.outputTokens, 0),
    costAvailableCount: costs.length,
    costCoverage: rate(costs.length, durations.length),
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
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      `${mode} chat failed: ${res.status} ${JSON.stringify(body)}`,
    );
  }
  const response = unwrap(body);
  const answer = response.answer;
  if (!answer) {
    throw new Error(`${mode} chat returned empty answer`);
  }
  return { runId: response.runId };
}

async function readEstimatedRunUsage(runId) {
  if (!serviceToken || typeof runId !== 'string' || !runId.trim()) {
    return { status: 'unavailable' };
  }
  try {
    const response = await fetch(
      `${baseUrl}/api/v1/rag/admin/agent-ops/run-center/${encodeURIComponent(runId)}`,
      {
        headers: { 'x-service-token': serviceToken },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return { status: 'unavailable' };
    const run = unwrap(await response.json());
    const events = Array.isArray(run?.events) ? run.events : [];
    const costEvent = events
      .filter((event) => event?.eventType === 'cost.estimated')
      .at(-1);
    const payload = parseEventPayload(costEvent?.payload);
    const inputTokens = finiteNonNegativeNumber(payload?.inputTokens);
    const outputTokens = finiteNonNegativeNumber(payload?.outputTokens);
    const costUsdEstimated = finiteNonNegativeNumber(payload?.costUsd);
    if (
      inputTokens === null ||
      outputTokens === null ||
      costUsdEstimated === null
    ) {
      return { status: 'unavailable' };
    }
    return {
      status: 'available',
      inputTokens,
      outputTokens,
      costUsdEstimated,
    };
  } catch {
    return { status: 'unavailable' };
  }
}

function parseEventPayload(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function finiteNonNegativeNumber(value) {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function unwrap(body) {
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}

function renderMarkdown(report) {
  const row = (item) =>
    `| ${item.name} | ${item.attempted} | ${item.successRate} | ${item.errorRate} | ${item.costCoverage} | ${item.p50Ms} | ${item.p95Ms} | ${item.throughputPerSecond} | ${item.avgCostUsd} | ${item.maxCostUsd} |`;
  return `# RAG 性能证据报告

- 生成时间：${report.generatedAt}
- 证据级别：${report.evidenceLevel}
- 服务：${report.baseUrl}
- 并发：${report.concurrency}
- 门禁 Profile：${report.profile}
- 门禁：${report.passed ? '通过' : '失败'}

| 模式 | 请求数 | 成功率 | 错误率 | 成本覆盖 | P50(ms) | P95(ms) | 吞吐(req/s) | 平均成本(USD) | 最大成本(USD) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${report.modes.map((mode) => row(report.results[mode])).join('\n')}

> local Profile 用于当前本地依赖和模型配置的工程回归；strict Profile 才是部署前延迟门禁。成本来自运行记录中的估算事件，不是账单；strict Profile 要求运行记录成本覆盖达标。运行记录查询不计入问答延迟。
`;
}
