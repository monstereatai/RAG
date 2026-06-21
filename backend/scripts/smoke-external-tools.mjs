import 'dotenv/config';

const qwenBaseUrl = (
  process.env.QWEN_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1'
).replace(/\/$/, '');
const rerankBaseUrl = (
  process.env.RERANK_BASE_URL ??
  'https://dashscope-intl.aliyuncs.com/compatible-api/v1/reranks'
).replace(/\/$/, '');
const requireKeys =
  process.env.EXTERNAL_SMOKE_REQUIRE_KEYS === 'true' ||
  process.argv.includes('--require-keys');

const report = {
  bocha: await smokeBocha(),
  rerank: await smokeRerank(),
  judge: await smokeJudge(),
};

report.ok = Object.values(report).every(
  (item) => item.ok === true || (item.skipped === true && !requireKeys),
);

console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  process.exitCode = 1;
}

async function smokeBocha() {
  const apiKey = process.env.BOCHA_API_KEY;
  if (!apiKey) return skippedOrMissing('BOCHA_API_KEY is empty');

  const response = await fetch('https://api.bochaai.com/v1/web-search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: 'RAG 检索增强生成',
      freshness: 'oneYear',
      summary: true,
      count: 2,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: await safeError(response),
    };
  }

  const payload = await response.json();
  const pages = payload?.webPages?.value ?? [];
  return {
    ok: pages.length > 0,
    status: response.status,
    resultCount: pages.length,
    hasUrl: pages.some((page) => typeof page?.url === 'string'),
  };
}

async function smokeRerank() {
  const apiKey = process.env.RERANK_API_KEY;
  if (!apiKey) return skippedOrMissing('RERANK_API_KEY is empty');

  const documents = [
    'RAG 会先检索知识库片段，再把相关上下文交给大模型生成答案。',
    '前端构建通常包含打包、压缩、缓存和部署。',
    '数据库迁移用于演进表结构，需要谨慎执行。',
  ];
  const response = await fetch(rerankBaseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.RERANK_MODEL ?? 'qwen3-rerank',
      query: 'RAG 如何生成答案？',
      documents,
      top_n: 2,
      instruct:
        'Given a web search query, retrieve relevant passages that answer the query.',
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: await safeError(response),
    };
  }

  const payload = await response.json();
  const results = payload?.results ?? payload?.output?.results ?? [];
  return {
    ok: results.length > 0,
    status: response.status,
    resultCount: results.length,
    topIndex: results[0]?.index,
    topScore: round(results[0]?.relevance_score),
  };
}

async function smokeJudge() {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) return skippedOrMissing('QWEN_API_KEY is empty');

  const response = await fetch(`${qwenBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.QWEN_MODEL ?? 'qwen-plus',
      messages: [
        {
          role: 'system',
          content:
            '你是 RAG smoke judge。只返回 JSON：{"score":0到1,"passed":boolean}。',
        },
        {
          role: 'user',
          content:
            '参考答案：RAG 会检索知识库并基于上下文生成回答。\n候选答案：RAG 先检索相关知识，再把上下文交给大模型生成答案。',
        },
      ],
      temperature: 0,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: await safeError(response),
    };
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content ?? '';
  const parsed = parseJsonObject(content);
  return {
    ok: parsed?.passed === true && Number(parsed?.score) >= 0.7,
    status: response.status,
    score: round(parsed?.score),
    passed: parsed?.passed === true,
  };
}

async function safeError(response) {
  const text = await response.text();
  return text.slice(0, 200);
}

function parseJsonObject(text) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function round(value) {
  return typeof value === 'number' ? Number(value.toFixed(4)) : undefined;
}

function skippedOrMissing(reason) {
  return requireKeys ? { ok: false, reason } : { skipped: true, reason };
}
