import 'dotenv/config';
import { MilvusClient, MetricType } from '@zilliz/milvus2-sdk-node';

const host = process.env.MILVUS_HOST ?? '127.0.0.1';
const port = Number(process.env.MILVUS_PORT ?? '19530');
const collection =
  process.env.MILVUS_BAD_CASE_COLLECTION ?? 'agent_bad_case_examples';
const dimension = Number(process.env.MILVUS_DIMENSION ?? '1024');
const timeoutMs = Number(
  process.env.MILVUS_BAD_CASE_SMOKE_TIMEOUT_MS ?? '8000',
);
const address = `${host}:${port}`;
const client = new MilvusClient({ address });
const id = `smoke_${Date.now()}`;
const vector = Array.from({ length: dimension }, (_, index) =>
  index === 0 ? 1 : 0,
);
const report = {
  ok: false,
  address,
  collection,
  sdk: MilvusClient.sdkInfo,
  checks: {},
};

try {
  await withTimeout(client.connectPromise, timeoutMs, 'connect');
  const version = await withTimeout(client.getVersion(), timeoutMs, 'version');
  report.checks.version = version.version;

  const exists = await withTimeout(
    client.hasCollection({ collection_name: collection }),
    timeoutMs,
    'hasCollection',
  );
  if (!exists.value) {
    throw new Error(`collection ${collection} does not exist`);
  }

  await withTimeout(
    client.loadCollection({ collection_name: collection }),
    timeoutMs,
    'loadCollection',
  );
  await withTimeout(
    client.insert({
      collection_name: collection,
      data: [
        {
          id,
          vector,
          query: 'Milvus Bad Case 真实链路 smoke',
          text: '临时审核样本，仅用于验证写入、检索、回读和清理。',
        },
      ],
    }),
    timeoutMs,
    'insert',
  );
  await withTimeout(
    client.flushSync({ collection_names: [collection] }),
    timeoutMs,
    'flush',
  );
  report.checks.inserted = true;

  const search = await withTimeout(
    client.search({
      collection_name: collection,
      vector,
      limit: 3,
      metric_type: MetricType.COSINE,
      params: { ef: 64 },
      output_fields: ['id', 'query', 'text'],
      timeout: timeoutMs,
    }),
    timeoutMs + 500,
    'search',
  );
  report.checks.searchHit = (search.results ?? []).some(
    (item) => item.id === id || item.ID === id,
  );

  const query = await withTimeout(
    client.query({
      collection_name: collection,
      expr: `id == "${id}"`,
      output_fields: ['id', 'query', 'text'],
      limit: 1,
    }),
    timeoutMs,
    'query',
  );
  report.checks.readBack = (query.data ?? []).some((item) => item.id === id);
  report.ok =
    report.checks.inserted === true &&
    report.checks.searchHit === true &&
    report.checks.readBack === true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  try {
    await withTimeout(
      client.deleteEntities({
        collection_name: collection,
        expr: `id == "${id}"`,
      }),
      timeoutMs,
      'cleanup',
    );
    report.checks.cleaned = true;
  } catch (error) {
    report.checks.cleaned = false;
    report.cleanupError =
      error instanceof Error ? error.message : String(error);
  }
  await client.closeConnection().catch(() => undefined);
}

console.log(JSON.stringify(report, null, 2));
if (!report.ok || !report.checks.cleaned) {
  process.exitCode = 1;
}

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timeout after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
