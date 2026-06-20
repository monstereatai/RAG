const baseUrl = (process.env.PERF_RAG_BASE_URL ?? 'http://localhost:3001')
  .replace(/\/$/, '');
const samples = Number(process.env.PERF_RAG_SAMPLES ?? '3');
const enforce = process.env.PERF_RAG_ENFORCE === 'true';
const thresholds = {
  simpleP50Ms: Number(process.env.PERF_RAG_SIMPLE_P50_MS ?? '300'),
  agenticP50Ms: Number(process.env.PERF_RAG_AGENTIC_P50_MS ?? '800'),
};

const token = await getToken();
const simple = await measure('simple', () =>
  postChat('RAG 性能基准：用一句话说明 RAG 是什么', 'simple'),
);
const agentic = await measure('agentic', () =>
  postChat('RAG 性能基准：列出 RAG 回答的关键步骤', 'agentic'),
);

const report = {
  baseUrl,
  samples,
  enforce,
  thresholds,
  simple,
  agentic,
  passed:
    simple.p50Ms <= thresholds.simpleP50Ms &&
    agentic.p50Ms <= thresholds.agenticP50Ms,
};

console.log(JSON.stringify(report, null, 2));

if (enforce && !report.passed) {
  process.exitCode = 1;
}

async function measure(name, fn) {
  const durations = [];
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    await fn();
    durations.push(Number((performance.now() - start).toFixed(2)));
  }

  durations.sort((a, b) => a - b);
  return {
    name,
    minMs: durations[0],
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    maxMs: durations[durations.length - 1],
    durationsMs: durations,
  };
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const index = Math.ceil(values.length * p) - 1;
  return values[Math.max(0, Math.min(index, values.length - 1))];
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
    throw new Error(`${mode} chat failed: ${res.status} ${JSON.stringify(body)}`);
  }
  const answer = unwrap(body).answer;
  if (!answer) {
    throw new Error(`${mode} chat returned empty answer`);
  }
}

function unwrap(body) {
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}
