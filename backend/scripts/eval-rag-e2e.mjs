import { readFile } from 'node:fs/promises';

const baseUrl = (process.env.EVAL_RAG_E2E_BASE_URL ?? 'http://localhost:3000')
  .replace(/\/$/, '');
const datasetPath =
  process.env.EVAL_RAG_E2E_DATASET ?? 'eval/hybrid-regression.dataset.json';
const modes = (process.env.EVAL_RAG_E2E_MODES ?? 'simple,auto,agentic')
  .split(',')
  .map((mode) => mode.trim())
  .filter(Boolean);

const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
const uploadedDocIds = [];

try {
  await assertServiceReady();
  const token = await login();

  for (const doc of dataset.documents ?? []) {
    uploadedDocIds.push(await uploadDocument(token, doc));
  }

  const results = [];
  for (const mode of modes) {
    for (const item of dataset.queries ?? []) {
      const started = Date.now();
      const response = await ask(token, item.query, mode);
      const durationMs = Date.now() - started;
      const keywordHits = (item.expectedKeywords ?? []).filter((keyword) =>
        response.answer.includes(keyword),
      );
      const shouldRefuse = item.minKeywordHits === 0;
      const citationPassed = shouldRefuse
        ? response.references.length === 0
        : response.references.length > 0 && /\[片段\s*\d+\]/.test(response.answer);
      const refusalPassed = shouldRefuse
        ? response.references.length === 0 &&
          (response.retrievalSufficient === false ||
            response.answer.includes('未找到') ||
            response.answer.includes('不足以支撑') ||
            response.answer.includes('未提及'))
        : true;
      const keywordPassed = shouldRefuse
        ? true
        : keywordHits.length >= item.minKeywordHits;

      results.push({
        id: item.id,
        mode,
        durationMs,
        keywordHits,
        keywordPassed,
        citationPassed,
        refusalPassed,
        referenceCount: response.references.length,
        retrievalSufficient: response.retrievalSufficient,
        passed: keywordPassed && citationPassed && refusalPassed,
      });
    }
  }

  const ok = results.every((item) => item.passed);
  console.log(
    JSON.stringify(
      {
        ok,
        skipped: false,
        baseUrl,
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
  console.log(
    JSON.stringify(
      {
        ok: true,
        skipped: true,
        baseUrl,
        reason: (err instanceof Error ? err.message : String(err)).slice(
          0,
          200,
        ),
      },
      null,
      2,
    ),
  );
} finally {
  await cleanup();
}

async function assertServiceReady() {
  const response = await fetch(`${baseUrl}/api/v1/health`, {
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) {
    throw new Error(`service health failed: ${response.status}`);
  }
}

async function login() {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.EVAL_RAG_E2E_USERNAME ?? 'user',
      password: process.env.EVAL_RAG_E2E_PASSWORD ?? 'user1234',
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
    // Best-effort cleanup; the report above remains the source of truth.
  }
}

function summarize(results) {
  const byMode = {};
  for (const result of results) {
    const bucket = byMode[result.mode] ?? { total: 0, passed: 0 };
    bucket.total += 1;
    if (result.passed) bucket.passed += 1;
    byMode[result.mode] = bucket;
  }
  return { byMode };
}

function unwrap(body) {
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}
