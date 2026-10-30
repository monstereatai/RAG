import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { LangfuseClient } from '@langfuse/client';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeSDK } from '@opentelemetry/sdk-node';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..');
dotenv.config({ path: join(appRoot, '.env'), quiet: true });

const datasetName =
  process.env.LANGFUSE_EXPERIMENT_DATASET ??
  'langfuse-observability-regression';
const baseUrl = process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com';
const publicKey = process.env.LANGFUSE_PUBLIC_KEY ?? '';
const secretKey = process.env.LANGFUSE_SECRET_KEY ?? '';
const sourcePath = resolve(
  appRoot,
  process.env.LANGFUSE_OBSERVABILITY_DATASET ??
    'eval/langfuse-observability.dataset.json',
);
const sourceDataset = JSON.parse(await readFile(sourcePath, 'utf8'));
const runStartedAt = new Date();
const runName =
  process.env.LANGFUSE_EXPERIMENT_RUN_NAME ??
  `contract-${runStartedAt.toISOString().replace(/[-:.]/g, '')}`;
const experimentName =
  process.env.LANGFUSE_EXPERIMENT_NAME ??
  'Langfuse observability contract regression';
const reportPath =
  process.env.LANGFUSE_EXPERIMENT_REPORT ??
  join(
    appRoot,
    '.tmp',
    'evidence',
    `langfuse-observability-experiment-${runStartedAt
      .toISOString()
      .replace(/[-:.]/g, '')}.json`,
  );

if (!publicKey || !secretKey) {
  throw new Error(
    'LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are required to run a Langfuse experiment.',
  );
}

const syncResult = await syncHostedDataset(sourceDataset);
const contractReport = await runLocalContractReplay(reportPath);
validateContractReport(contractReport, sourceDataset);

const replayById = new Map(
  contractReport.results.map((result) => [result.id, result]),
);
const client = new LangfuseClient({ publicKey, secretKey, baseUrl });
const telemetry = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
});
telemetry.start();

let experimentResult;
try {
  const dataset = await client.dataset.get(datasetName);
  validateHostedDataset(dataset, sourceDataset);

  experimentResult = await dataset.runExperiment({
    name: experimentName,
    runName,
    description:
      'Replays hosted synthetic observability cases against a local mock ingestion endpoint and scores the LangfuseProvider trace contract. This does not validate Langfuse Cloud ingestion transport.',
    maxConcurrency: 1,
    metadata: {
      sourceVersion: sourceDataset.version,
      synthetic: sourceDataset.synthetic === true,
      evaluation: 'local_mock_ingestion_contract',
    },
    task: async (item) => {
      const scenarioId = item.input?.scenarioId;
      const result = replayById.get(scenarioId);
      if (!result) {
        throw new Error(
          `No contract replay result for dataset item: ${scenarioId}`,
        );
      }
      return {
        scenarioId,
        category: item.input.category,
        target: item.input.target,
        batchCount: result.batchCount,
        checks: result.checks,
        passed: result.passed,
      };
    },
    evaluators: [evaluateContract],
    runEvaluators: [evaluatePassRate],
  });

  await client.flush();
} finally {
  await telemetry.shutdown();
  await client.shutdown();
}

const itemScores = experimentResult.itemResults.map((itemResult) => {
  const score = itemResult.evaluations.find(
    (evaluation) => evaluation.name === 'observability_contract',
  );
  return {
    scenarioId: itemResult.output?.scenarioId ?? 'unknown',
    passed: score?.value === 1,
  };
});
const failedScenarioIds = itemScores
  .filter((item) => item.passed === false)
  .map((item) => item.scenarioId);
const passRate =
  itemScores.length === 0
    ? 0
    : itemScores.filter((item) => item.passed).length / itemScores.length;

console.log(
  JSON.stringify(
    {
      datasetName,
      sourceVersion: sourceDataset.version,
      runName: experimentResult.runName,
      experimentId: experimentResult.experimentId,
      experimentUrl: experimentResult.experimentUrl ?? null,
      items: itemScores.length,
      passed: itemScores.length - failedScenarioIds.length,
      failedScenarioIds,
      passRate,
      datasetItemsCreated: syncResult.created,
      datasetItemsUpdated: syncResult.updated,
      contractReport: reportPath,
    },
    null,
    2,
  ),
);

if (failedScenarioIds.length > 0) process.exitCode = 1;

async function syncHostedDataset(dataset) {
  const auth = Buffer.from(`${publicKey}:${secretKey}`).toString('base64');
  const headers = {
    authorization: `Basic ${auth}`,
    'content-type': 'application/json',
  };

  async function request(method, path, body) {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let result;
    try {
      result = text ? JSON.parse(text) : null;
    } catch {
      result = null;
    }
    if (!response.ok) {
      const error = new Error(
        `${method} ${path} failed with HTTP ${response.status}`,
      );
      error.status = response.status;
      throw error;
    }
    return result;
  }

  const encodedName = encodeURIComponent(datasetName);
  let remoteDataset = await request(
    'GET',
    `/api/public/v2/datasets/${encodedName}`,
  ).catch(async (error) => {
    if (error.status !== 404) throw error;
    await request('POST', '/api/public/v2/datasets', {
      name: datasetName,
      description:
        'Synthetic Langfuse observability contract regression cases from the RAG repository.',
      metadata: {
        sourceFile: 'apps/rag-api/eval/langfuse-observability.dataset.json',
        sourceVersion: dataset.version,
        synthetic: dataset.synthetic === true,
        directions: dataset.directions,
      },
    });
    return request('GET', `/api/public/v2/datasets/${encodedName}`);
  });

  if (
    remoteDataset.metadata?.sourceFile !==
      'apps/rag-api/eval/langfuse-observability.dataset.json' ||
    remoteDataset.metadata?.sourceVersion !== dataset.version
  ) {
    throw new Error(
      `Langfuse dataset ${datasetName} does not match source version ${dataset.version}.`,
    );
  }

  const itemResponse = await request(
    'GET',
    `/api/public/dataset-items?datasetName=${encodedName}&page=1&limit=100`,
  );
  const existingItems = Array.isArray(itemResponse.data)
    ? itemResponse.data
    : [];
  const existingById = new Map(existingItems.map((item) => [item.id, item]));
  const desiredItems = dataset.scenarios.map((scenario) => ({
    datasetName,
    id: `langfuse-observability-${scenario.id}`,
    input: {
      scenarioId: scenario.id,
      category: scenario.category,
      target: scenario.target,
      payload: scenario.payload ?? {},
      ...(scenario.providerConfig
        ? { providerConfig: scenario.providerConfig }
        : {}),
    },
    expectedOutput: scenario.expected,
    metadata: {
      scenarioId: scenario.id,
      category: scenario.category,
      target: scenario.target,
      description: scenario.description,
      sourceVersion: dataset.version,
      synthetic: dataset.synthetic === true,
    },
  }));
  const expectedIds = new Set(desiredItems.map((item) => item.id));
  const unexpectedIds = existingItems
    .map((item) => item.id)
    .filter((id) => !expectedIds.has(id));
  if (unexpectedIds.length > 0) {
    throw new Error(
      `Langfuse dataset has ${unexpectedIds.length} unexpected items; refusing to delete or overwrite them.`,
    );
  }

  let created = 0;
  let updated = 0;
  for (const item of desiredItems) {
    const existing = existingById.get(item.id);
    if (
      existing &&
      stableStringify({
        input: existing.input,
        expectedOutput: existing.expectedOutput,
        metadata: existing.metadata,
      }) ===
        stableStringify({
          input: item.input,
          expectedOutput: item.expectedOutput,
          metadata: item.metadata,
        })
    ) {
      continue;
    }
    await request('POST', '/api/public/dataset-items', item);
    if (existing) updated += 1;
    else created += 1;
  }

  const verified = await request(
    'GET',
    `/api/public/dataset-items?datasetName=${encodedName}&page=1&limit=100`,
  );
  const finalItems = Array.isArray(verified.data) ? verified.data : [];
  const finalById = new Map(finalItems.map((item) => [item.id, item]));
  for (const item of desiredItems) {
    const actual = finalById.get(item.id);
    if (
      !actual ||
      stableStringify({
        input: actual.input,
        expectedOutput: actual.expectedOutput,
        metadata: actual.metadata,
      }) !==
        stableStringify({
          input: item.input,
          expectedOutput: item.expectedOutput,
          metadata: item.metadata,
        })
    ) {
      throw new Error(`Langfuse dataset item verification failed: ${item.id}`);
    }
  }
  if (finalItems.length !== desiredItems.length) {
    throw new Error(
      `Expected ${desiredItems.length} Langfuse dataset items, found ${finalItems.length}.`,
    );
  }
  return { created, updated };
}

async function runLocalContractReplay(outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  const execution = spawnSync(
    process.execPath,
    [join(__dirname, 'eval-langfuse-observability.mjs')],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        LANGFUSE_OBSERVABILITY_DATASET: sourcePath,
        LANGFUSE_OBSERVABILITY_REPORT: outputPath,
      },
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  if (execution.error) throw execution.error;
  try {
    return JSON.parse(await readFile(outputPath, 'utf8'));
  } catch {
    throw new Error(
      `Local Langfuse contract replay did not produce a report (exit ${execution.status}).`,
    );
  }
}

function validateContractReport(report, dataset) {
  if (
    report.datasetVersion !== dataset.version ||
    report.synthetic !== (dataset.synthetic === true) ||
    !Array.isArray(report.results) ||
    report.results.length !== dataset.scenarios.length
  ) {
    throw new Error('Local contract replay does not match the source dataset.');
  }
}

function validateHostedDataset(dataset, source) {
  if (
    dataset.metadata?.sourceFile !==
      'apps/rag-api/eval/langfuse-observability.dataset.json' ||
    dataset.metadata?.sourceVersion !== source.version ||
    dataset.metadata?.synthetic !== (source.synthetic === true) ||
    dataset.items.length !== source.scenarios.length
  ) {
    throw new Error(
      `Hosted Langfuse dataset ${datasetName} does not match the local source dataset.`,
    );
  }

  const sourceById = new Map(source.scenarios.map((item) => [item.id, item]));
  const seenIds = new Set();
  for (const item of dataset.items) {
    const scenarioId = item.input?.scenarioId;
    const scenario = sourceById.get(scenarioId);
    if (
      !scenario ||
      seenIds.has(scenarioId) ||
      stableStringify(item.input) !== stableStringify(makeInput(scenario)) ||
      stableStringify(item.expectedOutput) !==
        stableStringify(scenario.expected)
    ) {
      throw new Error(
        `Hosted Langfuse dataset item does not match the source scenario: ${scenarioId ?? 'unknown'}.`,
      );
    }
    seenIds.add(scenarioId);
  }
}

function makeInput(scenario) {
  return {
    scenarioId: scenario.id,
    category: scenario.category,
    target: scenario.target,
    payload: scenario.payload ?? {},
    ...(scenario.providerConfig
      ? { providerConfig: scenario.providerConfig }
      : {}),
  };
}

async function evaluateContract({ output, expectedOutput }) {
  const expectedChecks = expectedCheckNames(expectedOutput);
  const actualChecks = new Map(
    (Array.isArray(output?.checks) ? output.checks : []).map((check) => [
      check.check,
      check,
    ]),
  );
  const failed = expectedChecks.filter(
    (name) => actualChecks.get(name)?.passed !== true,
  );
  const passed =
    expectedChecks.length > 0 && failed.length === 0 && output?.passed === true;
  return {
    name: 'observability_contract',
    dataType: 'NUMERIC',
    value: passed ? 1 : 0,
    comment: passed
      ? `${expectedChecks.length}/${expectedChecks.length} expected checks passed.`
      : `${expectedChecks.length - failed.length}/${expectedChecks.length} expected checks passed; failed: ${failed.slice(0, 8).join(', ') || 'local replay reported failure'}.`,
    metadata: {
      expectedChecks: expectedChecks.length,
      failedChecks: failed,
    },
  };
}

async function evaluatePassRate({ itemResults }) {
  const values = itemResults
    .map(
      (item) =>
        item.evaluations.find(
          (evaluation) => evaluation.name === 'observability_contract',
        )?.value,
    )
    .filter((value) => typeof value === 'number');
  const passed = values.filter((value) => value === 1).length;
  const total = itemResults.length;
  return {
    name: 'observability_contract_pass_rate',
    dataType: 'NUMERIC',
    value: total === 0 ? 0 : passed / total,
    comment: `${passed}/${total} hosted dataset scenarios passed the local mock-ingestion contract replay.`,
  };
}

function expectedCheckNames(expected) {
  if (!expected || typeof expected !== 'object') return [];
  return [
    ...(expected.traceNames ?? []).map((name) => `trace:${name}`),
    ...(expected.generationNames ?? []).map((name) => `generation:${name}`),
    ...(expected.spanNames ?? []).map((name) => `span:${name}`),
    ...(expected.contains ?? []).map(
      (value) => `contains:${value.slice(0, 80)}`,
    ),
    ...(expected.absent ?? []).map((value) => `absent:${value.slice(0, 80)}`),
    'batch_delivery',
    ...Object.keys(expected.result ?? {}).map((key) => `result:${key}`),
  ];
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
