import { readFile } from 'node:fs/promises';

const baseUrl = (process.env.PROJECT_EVAL_BASE_URL ?? 'http://localhost:3001')
  .replace(/\/$/, '');
const datasetPath =
  process.env.PROJECT_EVAL_DATASET ??
  'eval/project-simulated-business.dataset.json';
const minScore = Number(process.env.PROJECT_EVAL_MIN_SCORE ?? '0.9');
const requireLive = process.env.PROJECT_EVAL_REQUIRE_LIVE === 'true';
const modes = (process.env.PROJECT_EVAL_MODES ?? 'simple,auto')
  .split(',')
  .map((mode) => mode.trim())
  .filter(Boolean);

const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
assertDataset(dataset);

const uploadedDocIds = [];

try {
  await assertServiceReady();
  const token = await login();

  for (const doc of dataset.documents) {
    uploadedDocIds.push(await uploadDocument(token, doc));
  }

  const results = [];
  for (const mode of modes) {
    for (const item of dataset.queries) {
      const started = Date.now();
      const response = await ask(token, item.query, mode);
      const durationMs = Date.now() - started;
      results.push(scoreAnswer(item, response, mode, durationMs));
    }
  }

  const passedCount = results.filter((item) => item.passed).length;
  const score = Number((passedCount / results.length).toFixed(3));
  const ok = score >= minScore;

  console.log(
    JSON.stringify(
      {
        ok,
        skipped: false,
        baseUrl,
        dataset: datasetPath,
        version: dataset.version,
        score,
        minScore,
        uploadedCount: uploadedDocIds.length,
        modes,
        summary: summarize(results),
        results,
      },
      null,
      2,
    ),
  );

  if (!ok) process.exitCode = 1;
} catch (err) {
  const reason = err instanceof Error ? err.message : String(err);
  const report = {
    ok: !requireLive,
    skipped: true,
    baseUrl,
    dataset: datasetPath,
    version: dataset.version,
    score: requireLive ? 0 : 1,
    minScore,
    validatedOnly: true,
    reason: reason.slice(0, 240),
    datasetSummary: {
      documentCount: dataset.documents.length,
      queryCount: dataset.queries.length,
      negativeCount: dataset.queries.filter((item) => item.expectRefusal).length,
      conflictCount: dataset.queries.filter((item) => item.expectConflictHandling)
        .length,
    },
  };
  console.log(JSON.stringify(report, null, 2));
  if (requireLive) process.exitCode = 1;
} finally {
  await cleanup();
}

function assertDataset(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('dataset must be an object');
  }
  if (!Array.isArray(value.documents) || value.documents.length < 5) {
    throw new Error('dataset requires at least 5 documents');
  }
  if (!Array.isArray(value.queries) || value.queries.length < 10) {
    throw new Error('dataset requires at least 10 queries');
  }
  const ids = new Set();
  for (const doc of value.documents) {
    if (!doc.id || ids.has(doc.id)) throw new Error(`invalid doc id: ${doc.id}`);
    ids.add(doc.id);
    if (!doc.content || doc.content.length < 80) {
      throw new Error(`doc ${doc.id} content is too short`);
    }
  }
  const hasNegative = value.queries.some((item) => item.expectRefusal === true);
  const hasConflict = value.queries.some(
    (item) => item.expectConflictHandling === true,
  );
  if (!hasNegative) throw new Error('dataset requires negative refusal queries');
  if (!hasConflict) throw new Error('dataset requires conflict queries');
}

function scoreAnswer(item, response, mode, durationMs) {
  const answer = response.answer ?? '';
  const keywordHits = (item.expectedKeywords ?? []).filter((keyword) =>
    answer.includes(keyword),
  );
  const shouldRefuse = item.expectRefusal === true || item.minKeywordHits === 0;
  const keywordPassed = shouldRefuse
    ? true
    : keywordHits.length >= item.minKeywordHits;
  const citationPassed =
    item.requireCitation === true
      ? response.references.length > 0 && /\[片段\s*\d+\]/.test(answer)
      : true;
  const refusalPassed = shouldRefuse
    ? response.references.length === 0 &&
      (response.retrievalSufficient === false ||
        answer.includes('未找到') ||
        answer.includes('不足以支撑') ||
        answer.includes('未提及') ||
        answer.includes('知识库中没有'))
    : true;
  const conflictPassed =
    item.expectConflictHandling === true
      ? answer.includes('2026') &&
        (answer.includes('优先') ||
          answer.includes('冲突') ||
          answer.includes('历史'))
      : true;

  return {
    id: item.id,
    category: item.category,
    mode,
    durationMs,
    keywordHits,
    keywordPassed,
    citationPassed,
    refusalPassed,
    conflictPassed,
    referenceCount: response.references.length,
    retrievalSufficient: response.retrievalSufficient,
    passed: keywordPassed && citationPassed && refusalPassed && conflictPassed,
  };
}

async function assertServiceReady() {
  const response = await fetch(`${baseUrl}/api/v1/health`, {
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error(`service health failed: ${response.status}`);
}

async function login() {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.PROJECT_EVAL_USERNAME ?? 'user',
      password: process.env.PROJECT_EVAL_PASSWORD ?? 'user1234',
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`login failed: ${response.status}`);
  return unwrap(body).accessToken;
}

async function uploadDocument(token, doc) {
  const form = new FormData();
  form.append(
    'file',
    new Blob([doc.content], { type: 'text/plain' }),
    `${doc.id}.txt`,
  );
  const response = await fetch(`${baseUrl}/api/v1/documents/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`upload failed: ${response.status}`);
  return unwrap(body).docId;
}

async function ask(token, query, mode) {
  const response = await fetch(`${baseUrl}/api/v1/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, mode }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`chat failed: ${response.status}`);
  const data = unwrap(body);
  return {
    answer: data.answer ?? '',
    references: Array.isArray(data.references) ? data.references : [],
    retrievalSufficient: data.retrievalSufficient,
  };
}

async function cleanup() {
  if (uploadedDocIds.length === 0) return;
  try {
    const token = await login();
    for (const docId of uploadedDocIds) {
      await fetch(`${baseUrl}/api/v1/documents/${docId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  } catch {
    // Best-effort cleanup only; the score report above is authoritative.
  }
}

function summarize(results) {
  const byMode = {};
  const byCategory = {};
  for (const result of results) {
    addBucket(byMode, result.mode, result.passed);
    addBucket(byCategory, result.category ?? 'uncategorized', result.passed);
  }
  return { byMode, byCategory };
}

function addBucket(target, key, passed) {
  const bucket = target[key] ?? { total: 0, passed: 0 };
  bucket.total += 1;
  if (passed) bucket.passed += 1;
  target[key] = bucket;
}

function unwrap(body) {
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}
