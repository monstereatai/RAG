#!/usr/bin/env node
/**
 * 冒烟：Karpathy 混合检索管线接入 ES kNN 向量通道 + DashScope 重排 + /rag/search 溯源字段
 *
 * 覆盖点（全部基于 dist 产物 + 手工 stub，不需要 Milvus / Elasticsearch / DashScope 真实服务）：
 *  1. RAG_ES_KNN_MODE=fallback：Milvus 抛错时向量候选来自 ES kNN（缺 chunkMeta 的命中跳过），
 *     markdown 内容与引用（toReferences 溯源字段）正常，/rag/search 返回 vectorSource/rerankApplied
 *  2. RAG_ES_KNN_MODE=always：Milvus 与 ES kNN 两路向量候选按 chunk id 去重合并
 *  3. RAG_ES_KNN_MODE=off：行为与旧版一致（不调用 knnSearch）
 *  4. fallback 且 Milvus 健康：不浪费 knnSearch 调用
 *  5. RAG_RERANK_*：重排生效（挂 rerankScore、顺序变化、totalScore 保留融合分）；
 *     重排失败保持原序不抛错；总开关关闭 / TOP_N=1 时不调用
 */
import { KarpathyRagService } from '../dist/src/rag/karpathy/karpathy-rag.service.js';
import { RagGatewayService } from '../dist/src/modules/rag-gateway/rag-gateway.service.js';

const USER = 'user-1';
const QUERY = '2026年住宿报销上限是多少';

// ---- 夹具 ----
// chunk-a：BM25/ES 关键词通道命中
const CHUNK_A = {
  id: 'chunk-a',
  content: '2026 版差旅制度规定一线城市住宿报销上限为 650 元，超标需提前审批。',
  docId: 'doc-a',
  chunkIndex: 0,
};
// chunk-b：只存在于 ES kNN 命中（meta 灌入 chunkMeta，但不进 BM25/ES search/Milvus）
const CHUNK_B_META = {
  content: '区块链审计日志的保留期限为 180 天。',
  docId: 'doc-b',
  chunkIndex: 0,
  userId: USER,
  docVersion: 'v2026.2',
  lifecycleStatus: 'effective',
  sourceAuthority: 'official',
};
// chunk-c：Milvus 命中（内容与查询词不相交，避免 BM25 通道干扰）
const CHUNK_C = {
  id: 'chunk-c',
  content: '客服工单升级处理与回访规范。',
  docId: 'doc-c',
  chunkIndex: 0,
};
// chunk-ghost：kNN 返回但 chunkMeta 缺失 → 必须被跳过
const KNN_FALLBACK_HITS = [
  { id: 'chunk-b', score: 0.93 },
  { id: 'chunk-ghost', score: 0.91 },
];
const KNN_ALWAYS_HITS = [
  { id: 'chunk-c', score: 0.9 }, // 与 Milvus 重复 → 必须按 id 去重
  { id: 'chunk-b', score: 0.93 },
  { id: 'chunk-ghost', score: 0.91 },
];
const ES_SEARCH_HITS = [
  {
    ...CHUNK_A,
    score: 7.2,
    docVersion: 'v2026.1',
    sourceAuthority: 'official',
    lifecycleStatus: 'effective',
  },
];
const MILVUS_C_HIT = { ...CHUNK_C, score: 0.88 };

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

// ---- stub 工厂（复刻 karpathy-rag.service.spec.ts 的构造方式）----
function makeConfig(map) {
  return { get: (key) => map[key] };
}

function makeEsStub({ knnHits }) {
  const calls = { search: 0, knn: 0, knnArgs: [] };
  return {
    calls,
    isEnabled: () => true,
    search: async () => {
      calls.search += 1;
      return ES_SEARCH_HITS;
    },
    knnSearch: async (vector, topK, userId, opts) => {
      calls.knn += 1;
      calls.knnArgs.push({ dim: vector.length, topK, userId, opts });
      return knnHits;
    },
  };
}

function makeRerankStub(program = {}) {
  const calls = [];
  return {
    calls,
    isEnabled: () => program.enabled !== false,
    rerank: async (query, chunks, topN) => {
      calls.push({ query, topN, ids: chunks.map((c) => c.id) });
      if (program.throw) {
        throw new Error('DashScope rerank timeout (stub)');
      }
      if (!program.scores) {
        // 模拟 rerank 服务短路：原样返回同一数组引用
        return chunks;
      }
      return [...chunks]
        .map((c) => ({ ...c, totalScore: program.scores[c.id] ?? c.totalScore }))
        .sort((a, b) => b.totalScore - a.totalScore);
    },
  };
}

function buildService({ config = {}, milvus = 'ok', knnHits = KNN_FALLBACK_HITS, rerank }) {
  const rerankStub = rerank ?? makeRerankStub();
  const es = makeEsStub({ knnHits });
  const vectorStore = {
    similaritySearch:
      milvus === 'throw'
        ? async () => {
            throw new Error('Milvus connection refused (stub)');
          }
        : async () => [MILVUS_C_HIT],
    getRuntimeStatus: () => ({
      status: 'healthy',
      available: true,
      circuitState: 'closed',
      consecutiveFailures: 0,
      lastFailureAt: null,
      lastFailureMessage: null,
      circuitOpenUntil: null,
    }),
  };
  const service = new KarpathyRagService(
    { embedQuery: async () => [0.1, 0.2, 0.3] },
    vectorStore,
    { invoke: async () => 'unused', getModel: () => ({ stream: async function* () {} }) },
    makeConfig(config),
    es,
    { observeRetrievalHits: () => {}, observeRetrievalContext: () => {} },
    {
      search: async () => [],
      assessHits: () => ({ sufficient: false, reason: 'Obsidian 未命中' }),
      formatHitsForPrompt: () => '',
    },
    {
      retrieveMatches: async () => [],
      retrieveExactMatches: async () => [],
      formatPrompt: () => '',
    },
    { isEnabled: () => false, search: async () => [] },
    { decide: () => ({ allowed: false }) },
    { getAllowedDocIds: async () => null },
    rerankStub,
  );
  // onModuleInit 会读磁盘快照，这里只挂内存 stub
  service.bm25Store = { save: () => {} };
  service.indexChunks([CHUNK_A, CHUNK_C], USER);
  service.chunkMeta.set('chunk-b', CHUNK_B_META);
  return { service, es, rerankStub };
}

function buildGateway(service) {
  return new RagGatewayService(service, { match: async () => [] });
}

const idsOf = (chunks) => chunks.map((c) => c.id);

async function scenarioFallback() {
  console.log('\n[1] RAG_ES_KNN_MODE=fallback + Milvus 抛错 -> 向量候选来自 ES kNN');
  const { service, es } = buildService({
    config: { RAG_ES_KNN_MODE: 'fallback' },
    milvus: 'throw',
  });
  const result = await service.retrieveDetailed(QUERY, {}, USER);
  const ids = idsOf(result.chunks);

  check('vectorSource=elasticsearch', result.vectorSource === 'elasticsearch', String(result.vectorSource));
  check('knnSearch 被调用 1 次', es.calls.knn === 1, String(es.calls.knn));
  check('knn 入参正确（dim=3, topK=profile.candidateDepth, userId）',
    es.calls.knnArgs[0]?.dim === 3 &&
      es.calls.knnArgs[0]?.topK === result.diagnostics.candidateDepth &&
      es.calls.knnArgs[0]?.userId === USER,
    JSON.stringify(es.calls.knnArgs[0]));
  check('结果包含 ES-kNN 专属候选 chunk-b 且 cosineScore>0 / retrievalSource=vector',
    ids.includes('chunk-b') &&
      result.chunks.find((c) => c.id === 'chunk-b')?.cosineScore > 0 &&
      result.chunks.find((c) => c.id === 'chunk-b')?.retrievalSource === 'vector');
  check('结果包含关键词候选 chunk-a 且 bm25Score>0',
    ids.includes('chunk-a') && result.chunks.find((c) => c.id === 'chunk-a')?.bm25Score > 0);
  check('缺 chunkMeta 的 chunk-ghost 被跳过', !ids.includes('chunk-ghost'), JSON.stringify(ids));
  check('Milvus 抛错后 chunk-c 不出现', !ids.includes('chunk-c'), JSON.stringify(ids));
  check('rerank 未生效时 rerankApplied=false', result.rerankApplied === false);

  const refs = service.toReferences(result.chunks);
  const refB = refs.find((r) => r.docId === 'doc-b');
  check('引用溯源：docId/docVersion/sourceAuthority/lifecycleStatus 齐全',
    !!refB && refB.docVersion === 'v2026.2' && refB.sourceAuthority === 'official' &&
      refB.lifecycleStatus === 'effective',
    JSON.stringify(refB ?? {}));
  check('引用溯源：score=totalScore 且未生效时不带 rerankScore',
    !!refB && refB.score === refB.totalScore && !('rerankScore' in refB));

  const response = await buildGateway(service).search({ query: QUERY, limit: 5 }, USER);
  check('/rag/search 响应含 vectorSource/rerankApplied',
    response.vectorSource === 'elasticsearch' && response.rerankApplied === false,
    JSON.stringify({ vectorSource: response.vectorSource, rerankApplied: response.rerankApplied }));
  check('/rag/search results 内容与引用正常（docId/score/content）',
    response.results.length === 2 &&
      response.results[0]?.chunkId === 'chunk-b' &&
      response.results[0]?.content === CHUNK_B_META.content &&
      typeof response.results[0]?.score === 'number' &&
      response.results.every((r) => typeof r.docId === 'string'),
    JSON.stringify(response.results.map((r) => r.chunkId)));
  check('/rag/search 未生效时不携带 rerankScore', !('rerankScore' in response.results[0]));
}

async function scenarioAlways() {
  console.log('\n[2] RAG_ES_KNN_MODE=always + Milvus 健康 -> 两路向量按 id 去重合并');
  const { service, es } = buildService({
    config: { RAG_ES_KNN_MODE: 'always' },
    milvus: 'ok',
    knnHits: KNN_ALWAYS_HITS,
  });
  const result = await service.retrieveDetailed(QUERY, {}, USER);
  const ids = idsOf(result.chunks);
  const cCount = ids.filter((id) => id === 'chunk-c').length;

  check('knnSearch 被并行调用 1 次', es.calls.knn === 1, String(es.calls.knn));
  check('向量候选池去重后为 2（chunk-c + chunk-b）',
    result.diagnostics.stages?.vectorCandidates === 2,
    String(result.diagnostics.stages?.vectorCandidates));
  check('chunk-c 只出现一次（按 id 去重）', cCount === 1, String(cCount));
  check('chunk-b 与 chunk-c 均带 cosineScore>0',
    result.chunks.find((c) => c.id === 'chunk-b')?.cosineScore > 0 &&
      result.chunks.find((c) => c.id === 'chunk-c')?.cosineScore > 0);
  check('chunk-ghost 仍被跳过', !ids.includes('chunk-ghost'));
  check('vectorSource=milvus（主通道）', result.vectorSource === 'milvus', String(result.vectorSource));
}

async function scenarioOff() {
  console.log('\n[3] RAG_ES_KNN_MODE=off + Milvus 健康 -> 行为与旧版一致');
  const { service, es } = buildService({ config: { RAG_ES_KNN_MODE: 'off' }, milvus: 'ok' });
  const result = await service.retrieveDetailed(QUERY, {}, USER);
  const ids = idsOf(result.chunks);

  check('knnSearch 未被调用', es.calls.knn === 0, String(es.calls.knn));
  check('vectorSource=milvus', result.vectorSource === 'milvus', String(result.vectorSource));
  check('向量候选仅来自 Milvus（vectorCandidates=1）',
    result.diagnostics.stages?.vectorCandidates === 1,
    String(result.diagnostics.stages?.vectorCandidates));
  check('chunk-c 命中、chunk-b 不出现', ids.includes('chunk-c') && !ids.includes('chunk-b'));
}

async function scenarioFallbackHealthy() {
  console.log('\n[4] RAG_ES_KNN_MODE=fallback + Milvus 健康 -> 不浪费 knnSearch');
  const { service, es } = buildService({ config: { RAG_ES_KNN_MODE: 'fallback' }, milvus: 'ok' });
  const result = await service.retrieveDetailed(QUERY, {}, USER);
  check('knnSearch 未被调用（Milvus 正常）', es.calls.knn === 0, String(es.calls.knn));
  check('vectorSource=milvus', result.vectorSource === 'milvus', String(result.vectorSource));
  check('结果含 chunk-c', idsOf(result.chunks).includes('chunk-c'));
}

async function scenarioRerankReorder() {
  console.log('\n[5] rerank 生效 -> 顺序按重排分变化、挂 rerankScore、totalScore 保留融合分');
  const { service, rerankStub } = buildService({
    config: { RAG_ES_KNN_MODE: 'off' },
    milvus: 'ok',
    rerank: makeRerankStub({ scores: { 'chunk-a': 0.9, 'chunk-c': 0.1 } }),
  });
  const result = await service.retrieveDetailed(QUERY, {}, USER);
  const [first, second] = result.chunks;

  check('rerankApplied=true', result.rerankApplied === true);
  check('重排后顺序变化：chunk-a 升到第一', first?.id === 'chunk-a' && second?.id === 'chunk-c',
    JSON.stringify(idsOf(result.chunks)));
  check('chunk-a 挂上 rerankScore=0.9', first?.rerankScore === 0.9, String(first?.rerankScore));
  check('chunk-c 挂上 rerankScore=0.1', second?.rerankScore === 0.1, String(second?.rerankScore));
  check('totalScore 保留融合分（chunk-a≈0.3，未被重排分 0.9 覆盖）',
    Math.abs(first?.totalScore - 0.3) < 1e-6, String(first?.totalScore));
  check('rerank 收到前 TOP_N 候选（顺序=融合序，topN=20 默认）',
    rerankStub.calls.length === 1 &&
      JSON.stringify(rerankStub.calls[0].ids) === JSON.stringify(['chunk-c', 'chunk-a']) &&
      rerankStub.calls[0].topN === 20,
    JSON.stringify(rerankStub.calls[0]));

  const response = await buildGateway(service).search({ query: QUERY, limit: 5 }, USER);
  check('/rag/search 响应 rerankApplied=true 且 results 携带 rerankScore',
    response.rerankApplied === true && response.results[0]?.rerankScore === 0.9 &&
      response.vectorSource === 'milvus',
    JSON.stringify({ rerankApplied: response.rerankApplied, vectorSource: response.vectorSource }));
}

async function scenarioRerankFailure() {
  console.log('\n[6] rerank 调用失败 -> 保持原序、不抛错');
  const { service } = buildService({
    config: { RAG_ES_KNN_MODE: 'off' },
    milvus: 'ok',
    rerank: makeRerankStub({ throw: true }),
  });
  let result;
  try {
    result = await service.retrieveDetailed(QUERY, {}, USER);
  } catch (err) {
    check('rerank 失败不阻断检索', false, String(err));
    return;
  }
  check('rerank 失败不阻断检索（正常返回）', Array.isArray(result.chunks));
  check('保持原序 [chunk-c, chunk-a]',
    JSON.stringify(idsOf(result.chunks)) === JSON.stringify(['chunk-c', 'chunk-a']),
    JSON.stringify(idsOf(result.chunks)));
  check('rerankApplied=false 且不携带 rerankScore',
    result.rerankApplied === false &&
      result.chunks.every((c) => !('rerankScore' in c)));
}

async function scenarioRerankDisabled() {
  console.log('\n[7] RAG_RERANK_ENABLED=false -> 总开关关闭，不调用 rerank');
  const { service, rerankStub } = buildService({
    config: { RAG_ES_KNN_MODE: 'off', RAG_RERANK_ENABLED: 'false' },
    milvus: 'ok',
    rerank: makeRerankStub({ scores: { 'chunk-a': 0.9, 'chunk-c': 0.1 } }),
  });
  const result = await service.retrieveDetailed(QUERY, {}, USER);
  check('rerank 未被调用', rerankStub.calls.length === 0, String(rerankStub.calls.length));
  check('rerankApplied=false 且保持原序',
    result.rerankApplied === false &&
      JSON.stringify(idsOf(result.chunks)) === JSON.stringify(['chunk-c', 'chunk-a']),
    JSON.stringify(idsOf(result.chunks)));
}

async function scenarioRerankTopN() {
  console.log('\n[8] RAG_RERANK_TOP_N=1（字符串 env 解析）-> 候选不足 2 条跳过重排');
  const { service, rerankStub } = buildService({
    config: { RAG_ES_KNN_MODE: 'off', RAG_RERANK_TOP_N: '1' },
    milvus: 'ok',
    rerank: makeRerankStub({ scores: { 'chunk-a': 0.9, 'chunk-c': 0.1 } }),
  });
  const result = await service.retrieveDetailed(QUERY, {}, USER);
  check('TOP_N=1 时不调用 rerank', rerankStub.calls.length === 0, String(rerankStub.calls.length));
  check('rerankApplied=false', result.rerankApplied === false);
}

try {
  await scenarioFallback();
  await scenarioAlways();
  await scenarioOff();
  await scenarioFallbackHealthy();
  await scenarioRerankReorder();
  await scenarioRerankFailure();
  await scenarioRerankDisabled();
  await scenarioRerankTopN();
} catch (err) {
  console.error('\nSMOKE CRASH:', err);
  process.exit(1);
}

console.log(`\n=== smoke-rag-pipeline: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
