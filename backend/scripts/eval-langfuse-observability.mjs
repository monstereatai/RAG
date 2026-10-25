import http from 'node:http';
import zlib from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const datasetPath =
  process.env.LANGFUSE_OBSERVABILITY_DATASET ??
  join(__dirname, '..', 'eval', 'langfuse-observability.dataset.json');
const reportPath =
  process.env.LANGFUSE_OBSERVABILITY_REPORT ??
  join(
    __dirname,
    '..',
    '..',
    '.tmp',
    'evidence',
    'langfuse-observability-latest.json',
  );
const require = createRequire(import.meta.url);

let LangfuseProvider;
try {
  ({ LangfuseProvider } = require(
    '../dist/src/providers/observability/langfuse.provider.js',
  ));
} catch (error) {
  console.error(
    'Unable to load compiled LangfuseProvider. Run pnpm --filter backend build first.',
  );
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
validateDataset(dataset);

const captures = [];
let nextCaptureId = 0;
const server = http.createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    let raw = Buffer.concat(chunks);
    const encoding = String(request.headers['content-encoding'] ?? '');
    if (encoding.includes('gzip')) {
      try {
        raw = zlib.gunzipSync(raw);
      } catch {
        // Keep the original body for the contract check to report.
      }
    }
    const bodyText = raw.toString('utf8');
    captures.push({
      id: nextCaptureId,
      url: request.url ?? '',
      bodyText,
      body: safeJson(bodyText),
    });
    nextCaptureId += 1;
    response.statusCode = 200;
    response.setHeader('content-type', 'application/json');
    response.end('{"success":true}');
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;
const baseUrl = `http://127.0.0.1:${port}`;

const results = [];
try {
  for (const scenario of dataset.scenarios) {
    const before = captures.length;
    const providerConfig = {
      ...dataset.defaults.baseConfig,
      ...(scenario.providerConfig ?? {}),
      baseUrl,
    };
    const provider = new LangfuseProvider(configService(providerConfig));
    const action = await runScenario(provider, scenario);
    if (scenario.target === 'rag_answer') {
      await waitFor(() => captures.length > before, 2_000);
    }
    await provider.flush();
    const captured = captures.slice(before);
    const batchText = captured.map((item) => item.bodyText).join('\n');
    const checks = [];

    for (const traceName of scenario.expected.traceNames ?? []) {
      checks.push({
        check: `trace:${traceName}`,
        passed: batchText.includes(traceName),
      });
    }
    for (const generationName of scenario.expected.generationNames ?? []) {
      checks.push({
        check: `generation:${generationName}`,
        passed: batchText.includes(generationName),
      });
    }
    for (const spanName of scenario.expected.spanNames ?? []) {
      checks.push({
        check: `span:${spanName}`,
        passed: batchText.includes(spanName),
      });
    }
    for (const marker of scenario.expected.contains ?? []) {
      checks.push({
        check: `contains:${marker.slice(0, 80)}`,
        passed: batchText.includes(marker),
      });
    }
    for (const forbidden of scenario.expected.absent ?? []) {
      checks.push({
        check: `absent:${forbidden.slice(0, 80)}`,
        passed: batchText.includes(forbidden) === false,
      });
    }

    const expectBatch = scenario.expected.batch === false ? false : true;
    checks.push({
      check: 'batch_delivery',
      passed: expectBatch ? captured.length > 0 : captured.length === 0,
    });

    for (const [key, expectedValue] of Object.entries(
      scenario.expected.result ?? {},
    )) {
      const actualValue = action[key];
      checks.push({
        check: `result:${key}`,
        expected: expectedValue,
        actual: actualValue,
        passed: actualValue === expectedValue,
      });
    }

    const failedChecks = checks.filter((item) => item.passed === false);
    results.push({
      id: scenario.id,
      category: scenario.category,
      target: scenario.target,
      description: scenario.description,
      batchCount: captured.length,
      checks,
      passed: failedChecks.length === 0,
    });

    await provider.onModuleDestroy();
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const failed = results.filter((item) => item.passed === false);
const report = {
  schema: 'rag.langfuse.observability.report.v1',
  generatedAt: new Date().toISOString(),
  dataset: datasetPath,
  datasetVersion: dataset.version,
  synthetic: dataset.synthetic === true,
  scenarios: results.length,
  passed: failed.length === 0,
  summary: {
    directions: dataset.directions,
    failedScenarioIds: failed.map((item) => item.id),
  },
  results,
};

await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      passed: report.passed,
      scenarios: report.scenarios,
      failedScenarioIds: report.summary.failedScenarioIds,
      dataset: datasetPath,
      reportPath,
      note:
        'Offline Langfuse ingestion contract test. It uses a local mock ingestion endpoint, not a real Langfuse cloud project.',
    },
    null,
    2,
  ),
);

if (report.passed === false) process.exitCode = 1;

async function runScenario(provider, scenario) {
  if (scenario.target === 'rag_answer') {
    provider.traceRagAnswer(scenario.payload);
    return {
      status: provider.getStatus(),
      health: provider.getHealth(),
    };
  }
  if (scenario.target === 'production_workflow') {
    await provider.traceProductionWorkflow(scenario.payload);
    return {
      status: provider.getStatus(),
      health: provider.getHealth(),
    };
  }
  if (scenario.target === 'scheduled_analysis') {
    await provider.traceScheduledAnalysis(scenario.payload);
    return {
      status: provider.getStatus(),
      health: provider.getHealth(),
    };
  }
  if (scenario.target === 'smoke') {
    const smoke = await provider.smoke();
    return {
      status: provider.getStatus(),
      health: provider.getHealth(),
      statusEnabled: provider.getStatus().enabled,
      healthEnabled: provider.getHealth().enabled,
      smokeEnabled: smoke.enabled,
      smokeSent: smoke.sent,
      smokeReason: smoke.reason ?? null,
    };
  }
  if (scenario.target === 'disabled') {
    const smoke = await provider.smoke();
    return {
      status: provider.getStatus(),
      health: provider.getHealth(),
      statusEnabled: provider.getStatus().enabled,
      healthEnabled: provider.getHealth().enabled,
      smokeEnabled: smoke.enabled,
      smokeSent: smoke.sent,
      smokeReason: smoke.reason ?? null,
    };
  }
  throw new Error(`unsupported Langfuse scenario target: ${scenario.target}`);
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}

function configService(config) {
  return {
    get: (key) => {
      const values = {
        'langfuse.enabled': config.enabled,
        'langfuse.publicKey':
          config.publicKey === undefined
            ? 'pk-lf-observability-dataset'
            : config.publicKey,
        'langfuse.secretKey':
          config.secretKey === undefined
            ? 'sk-lf-observability-dataset'
            : config.secretKey,
        'langfuse.baseUrl': config.baseUrl,
        'langfuse.redactContent': config.redactContent,
        'langfuse.inputCostUsdPer1k': config.inputCostUsdPer1k,
        'langfuse.outputCostUsdPer1k': config.outputCostUsdPer1k,
        nodeEnv: config.nodeEnv,
      };
      return values[key];
    },
  };
}

function validateDataset(value) {
  if (value == null || typeof value !== 'object') {
    throw new Error('Langfuse dataset must be an object');
  }
  if (value.schema !== 'rag.langfuse.observability.dataset.v1') {
    throw new Error(`invalid Langfuse dataset schema: ${value.schema}`);
  }
  if (Array.isArray(value.scenarios) === false || value.scenarios.length === 0) {
    throw new Error('Langfuse dataset requires at least one scenario');
  }
  const ids = new Set();
  for (const scenario of value.scenarios) {
    if (scenario.id == null || scenario.id.length === 0 || ids.has(scenario.id)) {
      throw new Error(`invalid or duplicate scenario id: ${scenario.id}`);
    }
    ids.add(scenario.id);
    const validTargets = [
      'rag_answer',
      'production_workflow',
      'scheduled_analysis',
      'smoke',
      'disabled',
    ];
    if (validTargets.includes(scenario.target) === false) {
      throw new Error(`invalid scenario target: ${scenario.target}`);
    }
    if (scenario.expected == null || typeof scenario.expected !== 'object') {
      throw new Error(`scenario ${scenario.id} requires expected assertions`);
    }
  }
  for (const key of [
    'trace_lifecycle',
    'token_usage_and_cost',
    'content_redaction',
  ]) {
    if (value.directions.includes(key) === false) {
      throw new Error(`Langfuse dataset is missing direction ${key}`);
    }
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
