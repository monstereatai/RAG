/**
 * ES dense_vector kNN 通道冒烟测试（不依赖真实 Elasticsearch）
 *
 * 覆盖点：
 * 1. ensureIndex 新建索引的 mapping 含正确 dense_vector 定义（dims 来自 RAG_ES_EMBEDDING_DIM）
 * 2. 存量索引的幂等 putMapping 补字段逻辑（缺 embedding 才补 / 已存在不重复补 / 失败不阻塞不删索引）
 * 3. indexChunks 有向量 / 无向量（含 null、维度不符）两种写入体
 * 4. knnSearch 查询体（field / k / num_candidates / userId filter / draft 审批门禁 / deprecated）
 * 5. ES 未启用返回 []；client 抛错降级返回 []
 *
 * 前置：先执行 `pnpm --filter backend run build`（本脚本 import dist 编译产物）。
 * 运行：pnpm --filter backend exec node scripts/smoke-es-knn.mjs
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const distProviderPath = resolve(
  scriptDir,
  '../dist/src/providers/elasticsearch/elasticsearch.provider.js',
);

if (!existsSync(distProviderPath)) {
  console.error(
    `[smoke-es-knn] dist 编译产物不存在：${distProviderPath}\n` +
      '请先执行 `pnpm --filter backend run build`',
  );
  process.exit(1);
}

// dist 产物含 Nest 装饰器元数据，必须最先加载 reflect-metadata
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { ElasticsearchProvider } = require(distProviderPath);

// ---------- 断言基础设施 ----------
const failures = [];
let total = 0;

function check(name, condition, detail) {
  total += 1;
  const ok = Boolean(condition);
  if (!ok) failures.push(name);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`,
  );
}

// ---------- 测试替身 ----------

/** fake ConfigService：只支持按 key 读取注入的 env 表 */
function createFakeConfig(env = {}) {
  return {
    get: (key) => (Object.prototype.hasOwnProperty.call(env, key) ? env[key] : undefined),
  };
}

/**
 * 内存版 ES client stub：
 * - 记录每次调用的方法名与参数到 calls
 * - 返回结果可通过 overrides / searchResponse 编程
 */
function createStubClient(overrides = {}) {
  const calls = [];
  const record = (op) => async (args) => {
    calls.push({ op, args });
    return {};
  };
  // 包装 override：无论成功/抛错，都先记录调用参数再委托
  const withRecord = (op, override) => async (args) => {
    calls.push({ op, args });
    return override(args);
  };
  const client = {
    calls,
    indices: {
      exists: overrides.exists ?? (async () => false),
      getMapping:
        overrides.getMapping ??
        (async () => ({ rag_chunks: { mappings: { properties: {} } } })),
      create: record('indices.create'),
      putMapping: overrides.putMapping
        ? withRecord('indices.putMapping', overrides.putMapping)
        : record('indices.putMapping'),
      delete: record('indices.delete'),
    },
    bulk: overrides.bulk ? withRecord('bulk', overrides.bulk) : record('bulk'),
    search: overrides.search
      ? withRecord('search', overrides.search)
      : async (args) => {
          calls.push({ op: 'search', args });
          return overrides.searchResponse ?? { hits: { hits: [] } };
        },
  };
  return client;
}

/** 构造真实 provider（dist 产物）+ 注入 stub client，绕过 onModuleInit 的真实连接 */
function createProvider(env = {}, stubOverrides = {}) {
  const provider = new ElasticsearchProvider(createFakeConfig(env));
  const stub = createStubClient(stubOverrides);
  provider.enabled = true;
  provider.client = stub;
  return { provider, stub };
}

const propertiesOf = (getMappingResult) =>
  getMappingResult?.rag_chunks?.mappings?.properties ?? {};

const existingIndexMapping = (extra = {}) => ({
  rag_chunks: {
    mappings: {
      properties: {
        userId: { type: 'keyword' },
        sourceAuthority: { type: 'keyword' },
        projectId: { type: 'keyword' },
        content: { type: 'text' },
        ...extra,
      },
    },
  },
});

// ---------- 1. ensureIndex：新建索引 mapping ----------
console.log('\n== ensureIndex：新建索引 mapping ==');
{
  const { provider, stub } = createProvider({ RAG_ES_EMBEDDING_DIM: '768' });
  await provider.ensureIndex();
  const createCall = stub.calls.find((c) => c.op === 'indices.create');
  const props = createCall?.args?.mappings?.properties ?? {};
  const emb = props.embedding;
  check(
    '新建索引 mapping 含 dense_vector embedding（type/index/similarity 正确）',
    emb?.type === 'dense_vector' &&
      emb?.index === true &&
      emb?.similarity === 'cosine',
    emb,
  );
  check(
    'dims 来自 RAG_ES_EMBEDDING_DIM=768（字符串可解析）',
    emb?.dims === 768,
    emb?.dims,
  );
  check(
    '新建路径不触发 putMapping',
    !stub.calls.some((c) => c.op === 'indices.putMapping'),
  );
  check(
    '新建索引保留 IK 分词与 userId 关键词字段（原有能力不回退）',
    createCall?.args?.settings?.analysis?.analyzer?.ik_smart_analyzer
      ?.tokenizer === 'ik_smart' && props.userId?.type === 'keyword',
  );
}
{
  const { provider, stub } = createProvider({});
  await provider.ensureIndex();
  const emb =
    stub.calls.find((c) => c.op === 'indices.create')?.args?.mappings
      ?.properties?.embedding;
  check('未配置 env 时 dims 默认 1024', emb?.dims === 1024, emb?.dims);
}
{
  const { provider, stub } = createProvider({ RAG_ES_EMBEDDING_DIM: 'not-a-number' });
  await provider.ensureIndex();
  const emb =
    stub.calls.find((c) => c.op === 'indices.create')?.args?.mappings
      ?.properties?.embedding;
  check('env 非法值时 dims 回落默认 1024', emb?.dims === 1024, emb?.dims);
}

// ---------- 2. ensureIndex：存量索引幂等补字段 ----------
console.log('\n== ensureIndex：存量索引幂等 putMapping 补字段 ==');
{
  const { provider, stub } = createProvider(
    { RAG_ES_EMBEDDING_DIM: 1024 },
    { exists: async () => true, getMapping: async () => existingIndexMapping() },
  );
  await provider.ensureIndex();
  const putCall = stub.calls.find((c) => c.op === 'indices.putMapping');
  check(
    '存量索引缺 embedding 时通过 putMapping 补 dense_vector 字段',
    putCall?.args?.properties?.embedding?.type === 'dense_vector' &&
      putCall?.args?.properties?.embedding?.dims === 1024,
    putCall?.args?.properties,
  );
  check(
    '幂等补字段：projectId 已存在则不重复提交业务字段',
    !('projectId' in (putCall?.args?.properties ?? {})),
    putCall?.args?.properties,
  );
  check(
    '补字段路径绝不删除/重建存量索引',
    !stub.calls.some((c) => c.op === 'indices.delete') &&
      !stub.calls.some((c) => c.op === 'indices.create'),
  );
}
{
  const { provider, stub } = createProvider(
    { RAG_ES_EMBEDDING_DIM: 1024 },
    {
      exists: async () => true,
      getMapping: async () =>
        existingIndexMapping({
          embedding: { type: 'dense_vector', dims: 1024, index: true, similarity: 'cosine' },
        }),
    },
  );
  await provider.ensureIndex();
  check(
    'embedding 已存在（dims 一致）→ 幂等跳过，不调用 putMapping',
    !stub.calls.some((c) => c.op === 'indices.putMapping'),
  );
}
{
  const { provider, stub } = createProvider(
    { RAG_ES_EMBEDDING_DIM: 1024 },
    {
      exists: async () => true,
      getMapping: async () => existingIndexMapping(),
      putMapping: async () => {
        throw new Error('mapping conflict');
      },
    },
  );
  let threw = false;
  try {
    await provider.ensureIndex();
  } catch {
    threw = true;
  }
  check('putMapping 失败仅告警，不阻塞启动（ensureIndex 正常返回）', !threw);
  check('putMapping 失败不删除存量索引', !stub.calls.some((c) => c.op === 'indices.delete'));
}

// ---------- 3. indexChunks：有向量 / 无向量写入体 ----------
console.log('\n== indexChunks：有向量 / 无向量写入体 ==');
{
  const { provider, stub } = createProvider({ RAG_ES_EMBEDDING_DIM: 3 });
  const chunkDocs = [
    { id: 'c1', content: '第一块', docId: 'd1', chunkIndex: 0, userId: 'u1' },
    { id: 'c2', content: '第二块', docId: 'd1', chunkIndex: 1, userId: 'u1' },
    { id: 'c3', content: '第三块', docId: 'd1', chunkIndex: 2, userId: 'u1' },
  ];
  await provider.indexChunks(chunkDocs, 'u1', [
    [0.1, 0.2, 0.3],
    null,
    undefined,
  ]);
  const bulkCall = stub.calls.find((c) => c.op === 'bulk');
  const docs = (bulkCall?.args?.operations ?? []).filter(
    (_, i) => i % 2 === 1,
  );
  check(
    '有向量的块写入 embedding（与 chunkDocs 一一对应）',
    Array.isArray(docs[0]?.embedding) &&
      docs[0].embedding.length === 3 &&
      docs[0].embedding[0] === 0.1 &&
      docs[0].embedding[2] === 0.3,
    docs[0]?.embedding,
  );
  check('向量为 null 的块缺省 embedding 字段，正文正常写入', !('embedding' in (docs[1] ?? {})) && docs[1]?.content === '第二块');
  check('vectors 缺位（undefined）的块缺省 embedding 字段', !('embedding' in (docs[2] ?? {})));
  check(
    '写入体保留关键词/过滤字段（docId/userId/chunkIndex）',
    docs[0]?.docId === 'd1' && docs[0]?.userId === 'u1' && docs[0]?.chunkIndex === 0,
    docs[0],
  );

  await provider.indexChunks(
    [{ id: 'c9', content: '维度不符', docId: 'd1', chunkIndex: 0 }],
    'u1',
    [[0.1, 0.2]],
  );
  const docDimMismatch = stub.calls
    .filter((c) => c.op === 'bulk')
    .at(-1)?.args?.operations?.[1];
  check(
    '向量维度与配置不符时不写 embedding（避免整批 bulk 失败）',
    !('embedding' in (docDimMismatch ?? {})) && docDimMismatch?.content === '维度不符',
    docDimMismatch,
  );

  await provider.indexChunks([chunkDocs[0]], 'u1');
  const docNoVectors = stub.calls
    .filter((c) => c.op === 'bulk')
    .at(-1)?.args?.operations?.[1];
  check('不传 vectors 参数时全部缺省 embedding（向后兼容）', !('embedding' in (docNoVectors ?? {})));
}

// ---------- 4. knnSearch：查询体 ----------
console.log('\n== knnSearch：查询体构造 ==');
{
  const { provider, stub } = createProvider(
    { RAG_ES_EMBEDDING_DIM: 4 },
    {
      searchResponse: {
        hits: {
          hits: [
            { _id: 'chunk-a', _score: 0.98 },
            { _id: 'chunk-b', _score: 0.42 },
          ],
        },
      },
    },
  );
  const vector = [0.5, 0.5, 0.5, 0.5];
  const hits = await provider.knnSearch(vector, 5, 'user-1');

  const searchCall = stub.calls.find((c) => c.op === 'search');
  const knn = searchCall?.args?.knn;
  check('knnSearch 作用于 rag_chunks 索引', searchCall?.args?.index === 'rag_chunks');
  check('knn 查询 field=embedding', knn?.field === 'embedding');
  check('knn 查询 query_vector 原样传入', JSON.stringify(knn?.query_vector) === JSON.stringify(vector), knn?.query_vector);
  check('knn 查询 k=topK（5）', knn?.k === 5, knn?.k);
  check('knn 查询 num_candidates=topK*4（20）', knn?.num_candidates === 20, knn?.num_candidates);
  check('size 与 k 对齐', searchCall?.args?.size === 5);

  const filter = knn?.filter ?? [];
  check(
    'filter 带 userId（与 keyword 检索同口径）',
    filter.some((f) => f.term && f.term.userId === 'user-1'),
    filter,
  );
  check(
    '审批门禁：filter 必须排除 draft（与 search/searchDocuments 同款）',
    filter.some((f) => f.bool?.must_not?.[0]?.term?.lifecycleStatus === 'draft'),
    filter,
  );
  check(
    '默认排除 deprecated',
    filter.some((f) => f.bool?.must_not?.[0]?.term?.lifecycleStatus === 'deprecated'),
    filter,
  );
  check(
    '返回 [{id, score}] 列表',
    JSON.stringify(hits) ===
      JSON.stringify([
        { id: 'chunk-a', score: 0.98 },
        { id: 'chunk-b', score: 0.42 },
      ]),
    hits,
  );

  // num_candidates 上限 200
  await provider.knnSearch(vector, 60, 'user-1');
  const capped = stub.calls.filter((c) => c.op === 'search').at(-1)?.args?.knn;
  check('num_candidates 上限 200（topK=60 时 240 → 200）', capped?.num_candidates === 200, capped?.num_candidates);

  // includeDeprecated: true
  await provider.knnSearch(vector, 5, 'user-1', { includeDeprecated: true });
  const depFilter = stub.calls.filter((c) => c.op === 'search').at(-1)?.args?.knn?.filter ?? [];
  check(
    'includeDeprecated=true 时不再排除 deprecated，draft 门禁仍在',
    !depFilter.some((f) => f.bool?.must_not?.[0]?.term?.lifecycleStatus === 'deprecated') &&
      depFilter.some((f) => f.bool?.must_not?.[0]?.term?.lifecycleStatus === 'draft'),
    depFilter,
  );

  // 无 userId
  await provider.knnSearch(vector, 5);
  const anonFilter = stub.calls.filter((c) => c.op === 'search').at(-1)?.args?.knn?.filter ?? [];
  check(
    '无 userId 时 filter 不带 userId 条件（draft/deprecated 门禁仍在）',
    !anonFilter.some((f) => 'userId' in (f.term ?? {})) &&
      anonFilter.some((f) => f.bool?.must_not?.[0]?.term?.lifecycleStatus === 'draft'),
    anonFilter,
  );
}

// ---------- 5. 降级路径 ----------
console.log('\n== knnSearch / indexChunks：降级路径 ==');
{
  const { provider, stub } = createProvider({});
  provider.enabled = false;
  const hits = await provider.knnSearch([0.1, 0.2], 5, 'u1');
  await provider.indexChunks([{ id: 'c1', content: 'x', docId: 'd1', chunkIndex: 0 }], 'u1', [[0.1, 0.2]]);
  check('ES 未启用时 knnSearch 返回 []', Array.isArray(hits) && hits.length === 0);
  check('ES 未启用时不发起任何查询/写入', !stub.calls.some((c) => c.op === 'search' || c.op === 'bulk'));
}
{
  const { provider, stub } = createProvider(
    {},
    {
      search: async () => {
        throw new Error('connection refused');
      },
    },
  );
  const hits = await provider.knnSearch([0.1, 0.2], 5, 'u1');
  check('client 抛错时 knnSearch 降级返回 []（不向上抛）', Array.isArray(hits) && hits.length === 0);
  check('client 抛错前确实发起了查询', stub.calls.some((c) => c.op === 'search'));
}
{
  const { provider, stub } = createProvider({});
  const emptyVec = await provider.knnSearch([], 5, 'u1');
  check('空向量直接返回 [] 且不发起查询', emptyVec.length === 0 && !stub.calls.some((c) => c.op === 'search'));
}

// ---------- 汇总 ----------
console.log(
  `\n[smoke-es-knn] ${total - failures.length}/${total} checks passed`,
);
if (failures.length > 0) {
  console.error(`[smoke-es-knn] FAILED checks:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log('[smoke-es-knn] ALL PASS');
}
