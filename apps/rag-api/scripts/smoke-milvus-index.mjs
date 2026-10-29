import 'dotenv/config';
import { MilvusClient, MetricType } from '@zilliz/milvus2-sdk-node';

const host = process.env.MILVUS_HOST ?? '127.0.0.1';
const port = Number(process.env.MILVUS_PORT ?? '19530');
const collection = process.env.MILVUS_COLLECTION ?? 'rag_chunks';
const dimension = Number(process.env.MILVUS_DIMENSION ?? '1024');
const timeoutMs = Number(process.env.MILVUS_SMOKE_TIMEOUT_MS ?? '5000');
const searchTimeoutMs = Number(process.env.MILVUS_SEARCH_TIMEOUT_MS ?? '800');
const warmupTimeoutMs = Number(process.env.MILVUS_WARMUP_TIMEOUT_MS ?? '1500');
const address = `${host}:${port}`;
const client = new MilvusClient({ address });

const startedAt = Date.now();
const report = {
  ok: false,
  address,
  collection,
  dimension,
  sdk: MilvusClient.sdkInfo,
  timeoutMs,
  checks: {},
};

try {
  await withTimeout(client.connectPromise, timeoutMs, 'connect');
  report.checks.health = await optional(() =>
    withTimeout(client.checkHealth(), timeoutMs, 'checkHealth'),
  );
  report.checks.version = await optional(() =>
    withTimeout(client.getVersion(), timeoutMs, 'getVersion'),
  );

  const hasCollection = await withTimeout(
    client.hasCollection({ collection_name: collection }),
    timeoutMs,
    'hasCollection',
  );
  report.checks.hasCollection = Boolean(hasCollection.value);

  if (!hasCollection.value) {
    report.error = `collection ${collection} does not exist`;
  } else {
    const describe = await withTimeout(
      client.describeCollection({ collection_name: collection }),
      timeoutMs,
      'describeCollection',
    );
    const fields = describe.schema?.fields ?? [];
    report.checks.fields = fields.map((field) => ({
      name: field.name,
      dataType: field.data_type,
      dim: field.type_params?.find((param) => param.key === 'dim')?.value,
    }));
    report.checks.hasUserIdField = fields.some((field) => field.name === 'user_id');

    const stats = await optional(() =>
      withTimeout(
        client.getCollectionStatistics({ collection_name: collection }),
        timeoutMs,
        'getCollectionStatistics',
      ),
    );
    report.checks.rowCount = readStat(stats, 'row_count');

    const indexes = await optional(() =>
      withTimeout(
        client.describeIndex({
          collection_name: collection,
          field_name: 'vector',
        }),
        timeoutMs,
        'describeIndex',
      ),
    );
    report.checks.indexes = indexes?.index_descriptions?.map((index) => ({
      indexName: index.index_name,
      fieldName: index.field_name,
      state: index.state,
      indexedRows: index.indexed_rows,
      totalRows: index.total_rows,
      params: index.params,
    }));

    await withTimeout(
      client.loadCollection({ collection_name: collection }),
      timeoutMs,
      'loadCollection',
    );
    report.checks.loadCollection = true;
    report.checks.loadState = await optional(() =>
      withTimeout(
        client.getLoadState({ collection_name: collection }),
        timeoutMs,
        'getLoadState',
      ),
    );
    report.checks.loadingProgress = await optional(() =>
      withTimeout(
        client.getLoadingProgress({ collection_name: collection }),
        timeoutMs,
        'getLoadingProgress',
      ),
    );

    const vector = Array(dimension).fill(0.01);
    const searchStartedAt = Date.now();
    const searchResult = await withTimeout(
      client.search({
        collection_name: collection,
        vector,
        limit: 1,
        metric_type: MetricType.COSINE,
        output_fields: ['id'],
        timeout: warmupTimeoutMs,
      }),
      Math.max(searchTimeoutMs, warmupTimeoutMs) + 500,
      'search',
    );
    report.checks.searchMs = Date.now() - searchStartedAt;
    report.checks.searchResultCount = searchResult.results?.length ?? 0;
    report.ok =
      report.checks.hasCollection === true &&
      report.checks.hasUserIdField === true &&
      report.checks.loadCollection === true;
  }
} catch (err) {
  report.error = err instanceof Error ? err.message : String(err);
} finally {
  report.elapsedMs = Date.now() - startedAt;
  await client.closeConnection().catch(() => undefined);
}

console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
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

async function optional(fn) {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

function readStat(stats, key) {
  const pairs = stats?.stats ?? stats?.data?.stats ?? [];
  const found = pairs.find((item) => item.key === key);
  return found ? Number(found.value) : undefined;
}
