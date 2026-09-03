#!/usr/bin/env node
/**
 * 图片索引/检索（以图搜图 / 文搜图）冒烟脚本（离线，不依赖 Milvus / DashScope）
 *
 * 覆盖链路（真实走 dist 编译产物的 MultimodalEmbeddingProvider + ImageIndexService）：
 *   1. 未配置 MULTIMODAL_EMBEDDING_API_KEY / DASHSCOPE_API_KEY：
 *      isEnabled()=false，embedText/embedImage 抛明确错误；
 *   2. 注入 fake fetch 的真实 Provider：
 *      - 请求行/头/体符合 DashScope multimodal-embedding 契约（Bearer Key、model、input.contents）；
 *      - base64 自动包装 data URI；HTTP 非 2xx 抛错；维度不匹配抛明确错误；
 *   3. indexImage → searchText → deleteByDoc 全链路（内存版向量存取）：
 *      - 文本查询能召回对应图片（docId/url/score）；
 *      - topK 截断与 userId 多租户过滤生效；
 *      - 同 docId 重复索引先删后写（幂等，不产生重复记录）；
 *      - deleteByDoc 后不再召回；
 *      - 向量库异常时 searchText 明确抛错（由上层 REST 降级）。
 *
 * 前置：先执行 `pnpm --filter backend run build`（脚本 import dist 编译产物）。
 * 通过标准：全部断言通过，exit 0。
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const distIndexPath = resolve(
  scriptDir,
  '../dist/src/modules/image-index/image-index.service.js',
);
const distEmbeddingPath = resolve(
  scriptDir,
  '../dist/src/providers/multimodal-embedding/multimodal-embedding.provider.js',
);

for (const p of [distIndexPath, distEmbeddingPath]) {
  if (!existsSync(p)) {
    console.error(
      `[smoke-image-search] dist 编译产物不存在：${p}\n` +
        '请先执行 `pnpm --filter backend run build` 再运行本脚本。',
    );
    process.exit(1);
  }
}

const indexModule = await import(pathToFileURL(distIndexPath));
const embeddingModule = await import(pathToFileURL(distEmbeddingPath));
const { ImageIndexService } = indexModule;
const { MultimodalEmbeddingProvider } = embeddingModule;

const failures = [];
function check(condition, label) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures.push(label);
  }
}

const DIM = 8;

/* ── 夹具：关键词 → 维度映射（文本/图片共用，保证跨模态可召回） ── */
const KEYWORD_DIMS = { sunset: 0, beach: 1, logo: 2, chart: 3, cat: 4 };

function vectorForContent(content) {
  const text = String(content).toLowerCase();
  for (const [keyword, dim] of Object.entries(KEYWORD_DIMS)) {
    if (text.includes(keyword)) {
      const vec = new Array(DIM).fill(0);
      vec[dim] = 1;
      return vec;
    }
  }
  const fallback = new Array(DIM).fill(0);
  fallback[7] = 1;
  return fallback;
}

function cosine(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

/* ── 内存版图片向量存取（stub Milvus client） ── */
function makeMemoryStore() {
  const rows = new Map();
  return {
    rows,
    async insertImages(records) {
      for (const record of records) rows.set(record.id, { ...record });
    },
    async searchImages(queryVector, k, userId) {
      const scored = [];
      for (const row of rows.values()) {
        if (userId && row.userId !== userId) continue;
        scored.push({
          id: row.id,
          docId: row.docId,
          userId: row.userId ?? '',
          url: row.url,
          meta: row.meta,
          score: cosine(queryVector, row.vector),
        });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, k);
    },
    async deleteImagesByDocId(docId, userId) {
      for (const [id, row] of rows) {
        if (row.docId === docId && (!userId || row.userId === userId)) {
          rows.delete(id);
        }
      }
    },
  };
}

function stubConfig(env = {}) {
  return { get: (key) => env[key] };
}

function makeJsonResponse(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  };
}

/* ── 1. 未配置 Key：isEnabled=false，方法抛明确错误 ── */
console.log('\n[1] 未配置 API Key 时降级行为');
{
  const provider = new MultimodalEmbeddingProvider(stubConfig({}));
  check(provider.isEnabled() === false, 'isEnabled() === false');
  check(typeof provider.getDimension() === 'number', 'getDimension() 返回数值');

  let textError = null;
  try {
    await provider.embedText('一张夕阳图');
  } catch (err) {
    textError = err;
  }
  check(
    textError !== null && String(textError.message).includes('MULTIMODAL_EMBEDDING_API_KEY'),
    `embedText 抛明确错误（含 Key 配置提示）：${textError ? textError.message.slice(0, 60) : '未抛错'}`,
  );

  let imageError = null;
  try {
    await provider.embedImage({ url: 'https://example.com/a.png' });
  } catch (err) {
    imageError = err;
  }
  check(imageError !== null, 'embedImage 未配置 Key 时同样抛错');

  const service = new ImageIndexService(provider, makeMemoryStore());
  check(service.isEnabled() === false, 'ImageIndexService.isEnabled() 跟随 provider 为 false');
}

/* ── 2. 注入 fake fetch 的真实 Provider：请求契约与错误路径 ── */
console.log('\n[2] MultimodalEmbeddingProvider HTTP 契约（注入 fake fetch）');
const captured = [];
function fakeDashScopeFetch(url, init) {
  const body = JSON.parse(init.body);
  const content = body.input.contents[0];
  const raw = content.text ?? content.image ?? '';
  const vector = vectorForContent(raw);
  captured.push({ url, init, body });
  return Promise.resolve(
    makeJsonResponse({
      output: { embeddings: [{ index: 0, embedding: vector, type: content.text ? 'text' : 'image' }] },
      usage: { total_tokens: 1 },
      request_id: 'smoke-req-1',
    }),
  );
}

const provider = new MultimodalEmbeddingProvider(
  stubConfig({
    MULTIMODAL_EMBEDDING_API_KEY: 'sk-smoke-test',
    MULTIMODAL_EMBEDDING_DIM: String(DIM),
    MULTIMODAL_EMBEDDING_BASE_URL: 'https://fake-dashscope.example.com',
  }),
  fakeDashScopeFetch,
);

{
  check(provider.isEnabled() === true, '配置 Key 后 isEnabled() === true');

  const textVector = await provider.embedText('A beautiful sunset over the sea');
  const textCall = captured.at(-1);
  check(
    textCall.url ===
      'https://fake-dashscope.example.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding',
    '请求 URL = BASE_URL + multimodal-embedding 路径',
  );
  check(
    textCall.init.headers.Authorization === 'Bearer sk-smoke-test',
    'Authorization: Bearer <MULTIMODAL_EMBEDDING_API_KEY>',
  );
  check(textCall.body.model === 'multimodal-embedding-v1', '默认模型 multimodal-embedding-v1');
  check(
    Array.isArray(textCall.body.input.contents) &&
      typeof textCall.body.input.contents[0].text === 'string',
    '请求体 input.contents[0].text 存在',
  );
  check(
    textVector.length === DIM && textVector[0] === 1,
    '文本嵌入返回 fake 向量（sunset → dim0）',
  );

  const b64Vector = await provider.embedImage({
    base64: 'QUJD',
    mimeType: 'image/jpeg',
  });
  const b64Call = captured.at(-1);
  check(
    b64Call.body.input.contents[0].image === 'data:image/jpeg;base64,QUJD',
    '纯 base64 自动包装为 data:image/jpeg;base64,...',
  );
  check(b64Vector.length === DIM, '图片嵌入返回 8 维向量');

  await provider.embedImage({ base64: 'data:image/png;base64,QUJD' });
  const dataUriCall = captured.at(-1);
  check(
    dataUriCall.body.input.contents[0].image === 'data:image/png;base64,QUJD',
    'data URI 输入保持原样',
  );

  // 正常路径再次调用确认不抛错（boom 无关键词 → 走 fallback 维度）
  const fallbackVector = await provider.embedText('boom');
  check(fallbackVector.length === DIM, '无关键词文本走 fallback 向量且不抛错');

  const failingProvider = new MultimodalEmbeddingProvider(
    stubConfig({
      MULTIMODAL_EMBEDDING_API_KEY: 'sk-smoke-test',
      MULTIMODAL_EMBEDDING_DIM: String(DIM),
    }),
    async () => makeJsonResponse({ code: 'InvalidParameter', message: 'bad input' }, false, 400),
  );
  let statusError = null;
  try {
    await failingProvider.embedText('anything');
  } catch (err) {
    statusError = err;
  }
  check(
    statusError !== null && String(statusError.message).includes('400'),
    `HTTP 400 抛错含状态码：${statusError ? statusError.message.slice(0, 50) : '未抛错'}`,
  );

  const mismatchProvider = new MultimodalEmbeddingProvider(
    stubConfig({ MULTIMODAL_EMBEDDING_API_KEY: 'sk-smoke-test' }),
    async () =>
      makeJsonResponse({
        output: { embeddings: [{ index: 0, embedding: [0.1, 0.2, 0.3], type: 'text' }] },
      }),
  );
  let dimError = null;
  try {
    await mismatchProvider.embedText('dimension mismatch');
  } catch (err) {
    dimError = err;
  }
  check(
    dimError !== null && String(dimError.message).includes('维度不匹配'),
    `维度不匹配抛明确错误：${dimError ? dimError.message.slice(0, 60) : '未抛错'}`,
  );
}

/* ── 3. ImageIndexService 全链路：indexImage → searchText → deleteByDoc ── */
console.log('\n[3] ImageIndexService indexImage → searchText → deleteByDoc 全链路');
const store = makeMemoryStore();
const service = new ImageIndexService(provider, store);

{
  const indexA = await service.indexImage({
    docId: 'doc-a',
    userId: 'user-a',
    url: 'https://cdn.example.com/sunset-beach.png',
    meta: { filename: 'sunset-beach.png', scene: '自然风光' },
  });
  check(indexA.docId === 'doc-a' && indexA.id === 'img_doc-a', 'indexImage 返回 docId 与确定性 id');
  check(indexA.dimension === DIM, '写入向量维度与配置一致');

  await service.indexImage({
    docId: 'doc-b',
    userId: 'user-b',
    url: 'https://cdn.example.com/sales-chart.png',
  });
  check(store.rows.size === 2, '两条图片记录入库');

  const hits = await service.searchText('a beautiful sunset', { topK: 5 });
  check(hits.length === 2, '不设 userId 时可跨租户召回');
  check(
    hits[0] && hits[0].docId === 'doc-a',
    `文本查询 top1 命中对应图片（doc-a，score=${hits[0] ? hits[0].score.toFixed(3) : 'n/a'}）`,
  );
  check(
    hits[0] &&
      hits[0].url === 'https://cdn.example.com/sunset-beach.png' &&
      typeof hits[0].score === 'number',
    '返回项包含 docId/url/score',
  );
  check(
    hits[0] && hits[0].meta && hits[0].meta.filename === 'sunset-beach.png',
    'meta JSON 反序列化回传',
  );

  const scoped = await service.searchText('a beautiful sunset', {
    topK: 5,
    userId: 'user-a',
  });
  check(
    scoped.length === 1 && scoped[0].docId === 'doc-a',
    'userId 过滤：user-a 只能看到自己的图片',
  );

  const otherTenant = await service.searchText('sales chart', {
    topK: 5,
    userId: 'user-a',
  });
  check(
    !otherTenant.some((h) => h.docId === 'doc-b'),
    'user-a 搜不到 user-b 的图片（doc-b 不在结果中）',
  );

  const top1 = await service.searchText('sunset beach', { topK: 1, userId: 'user-a' });
  check(top1.length === 1, 'topK=1 只返回 1 条');

  // 幂等：同 docId 重复索引先删后写
  await service.indexImage({
    docId: 'doc-a',
    userId: 'user-a',
    url: 'https://cdn.example.com/sunset-v2.png',
  });
  const docARows = [...store.rows.values()].filter((r) => r.docId === 'doc-a');
  check(
    docARows.length === 1 && docARows[0].url === 'https://cdn.example.com/sunset-v2.png',
    '同 docId 重复索引幂等（先删后写，保留最新 url）',
  );

  const emptyQuery = await service.searchText('   ', { topK: 5 });
  check(Array.isArray(emptyQuery) && emptyQuery.length === 0, '空查询返回空列表');

  await service.deleteByDoc('doc-a', 'user-a');
  const afterDelete = await service.searchText('sunset', { topK: 5 });
  check(
    !afterDelete.some((h) => h.docId === 'doc-a'),
    'deleteByDoc 后 doc-a 不再被召回',
  );
  const remaining = await service.searchText('sales chart', { topK: 5, userId: 'user-b' });
  check(remaining.length === 1 && remaining[0].docId === 'doc-b', '删除不影响其他文档');

  const failingService = new ImageIndexService(provider, {
    insertImages: async () => {},
    searchImages: async () => {
      throw new Error('Milvus image search circuit is open');
    },
    deleteImagesByDocId: async () => {},
  });
  let searchError = null;
  try {
    await failingService.searchText('sunset', { topK: 3 });
  } catch (err) {
    searchError = err;
  }
  check(
    searchError !== null && String(searchError.message).includes('circuit is open'),
    '向量库异常时 searchText 抛错（上层 REST 捕获后降级）',
  );
}

console.log('\n──────────────────────────────');
if (failures.length > 0) {
  console.error(`FAIL: ${failures.length} 项断言未通过`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('PASS: 图片索引/检索冒烟全部通过');
