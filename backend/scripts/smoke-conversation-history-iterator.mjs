import 'dotenv/config';
import { ConsistencyLevelEnum, MilvusClient } from '@zilliz/milvus2-sdk-node';

const host = process.env.MILVUS_HOST ?? '127.0.0.1';
const port = Number(process.env.MILVUS_PORT ?? '19530');
const collection =
  process.env.MILVUS_CONVERSATION_COLLECTION ?? 'conversation_chunks_v2';
const sampleLimit = Number(
  process.env.MILVUS_HISTORY_SMOKE_SAMPLE_LIMIT ?? '1000',
);
const client = new MilvusClient({ address: `${host}:${port}` });

function assertSucceeded(result, operation) {
  const code = result?.status?.error_code;
  const succeeded =
    code === 'Success' ||
    Number(code) === 0 ||
    Number(result?.status?.code) === 0;
  if (!succeeded) {
    throw new Error(
      `${operation} failed: ${result?.status?.reason || code || 'unknown error'}`,
    );
  }
}

function quoteMilvusString(value) {
  return `"${String(value)
    .replace(/\\/gu, '\\\\')
    .replace(/"/gu, '\\"')
    .replace(/\n/gu, '\\n')
    .replace(/\r/gu, '\\r')
    .replace(/\t/gu, '\\t')}"`;
}

async function countRecords(expr) {
  const result = await client.query({
    collection_name: collection,
    expr,
    output_fields: ['count(*)'],
    consistency_level: ConsistencyLevelEnum.Strong,
  });
  assertSucceeded(result, 'Strong count');
  const count = Number(result.data?.[0]?.['count(*)']);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Milvus returned an invalid count.');
  }
  return count;
}

const report = {
  ok: false,
  collection,
  sampleLimit,
  writesPerformed: false,
};

try {
  if (!Number.isSafeInteger(sampleLimit) || sampleLimit < 1) {
    throw new Error('MILVUS_HISTORY_SMOKE_SAMPLE_LIMIT must be a positive integer.');
  }

  await client.connectPromise;
  const hasCollection = await client.hasCollection({ collection_name: collection });
  if (!hasCollection.value) {
    throw new Error(`Milvus collection does not exist: ${collection}`);
  }
  await client.loadCollection({ collection_name: collection });

  const sample = await client.query({
    collection_name: collection,
    expr: 'user_id != ""',
    output_fields: ['thread_id', 'query_key', 'user_id'],
    limit: sampleLimit,
    consistency_level: ConsistencyLevelEnum.Strong,
  });
  assertSucceeded(sample, 'Strong metadata sample');

  const groups = new Map();
  for (const row of sample.data ?? []) {
    const key = JSON.stringify([row.thread_id, row.query_key, row.user_id]);
    const group = groups.get(key) ?? { row, count: 0 };
    group.count += 1;
    groups.set(key, group);
  }

  const duplicateGroup = [...groups.values()].find((group) => group.count > 1);
  report.sampledRecords = sample.data?.length ?? 0;
  report.sampledGroups = groups.size;
  report.duplicateVersionGroupFound = Boolean(duplicateGroup);
  if (!duplicateGroup) {
    throw new Error(
      'The bounded sample contains no repeated query group; increase MILVUS_HISTORY_SMOKE_SAMPLE_LIMIT.',
    );
  }

  const { thread_id: threadId, query_key: queryKey, user_id: userId } =
    duplicateGroup.row;
  const expr =
    `(thread_id == ${quoteMilvusString(threadId)} && ` +
    `query_key == ${quoteMilvusString(queryKey)} && ` +
    `user_id == ${quoteMilvusString(userId)})`;
  const countBefore = await countRecords(expr);
  const iterator = await client.queryIterator({
    collection_name: collection,
    expr,
    output_fields: ['id', 'thread_id', 'query_key', 'created_at', 'version'],
    batchSize: 256,
    consistency_level: ConsistencyLevelEnum.Strong,
  });
  const versions = [];
  for await (const page of iterator) {
    if (!Array.isArray(page)) {
      throw new Error('Milvus queryIterator yielded a non-array page.');
    }
    versions.push(...page);
  }
  const countAfter = await countRecords(expr);

  const latest = versions.reduce((current, row) => {
    const version = Number(row.version ?? row.created_at ?? 0);
    const createdAt = Number(row.created_at ?? 0);
    if (
      !current ||
      version > current.version ||
      (version === current.version && createdAt > current.createdAt) ||
      (version === current.version &&
        createdAt === current.createdAt &&
        row.id > current.id)
    ) {
      return { id: row.id, version, createdAt };
    }
    return current;
  }, null);
  if (!latest?.id) throw new Error('Milvus returned no version rows.');

  const latestResult = await client.get({
    collection_name: collection,
    ids: [latest.id],
    output_fields: ['id'],
    consistency_level: ConsistencyLevelEnum.Strong,
  });
  assertSucceeded(latestResult, 'Strong latest-version fetch');

  report.recordsBefore = countBefore;
  report.recordsIterated = versions.length;
  report.recordsAfter = countAfter;
  report.latestRowFetchCount = latestResult.data?.length ?? 0;
  report.ok =
    countBefore > 1 &&
    countBefore === versions.length &&
    countAfter === countBefore &&
    report.latestRowFetchCount === 1 &&
    latestResult.data?.[0]?.id === latest.id;

  if (!report.ok) {
    throw new Error('Milvus count, iterator, or latest-row fetch did not agree.');
  }
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  await client.closeConnection().catch(() => undefined);
}

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
