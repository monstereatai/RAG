import { readFile } from 'node:fs/promises';

const baseUrl = (process.env.HYBRID_SMOKE_BASE_URL ?? 'http://localhost:3000')
  .replace(/\/$/, '');
const datasetPath =
  process.env.HYBRID_SMOKE_DATASET ?? 'eval/hybrid-regression.dataset.json';
const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
const token = await login();
const uploadedDocIds = [];

try {
  for (const doc of dataset.documents) {
    uploadedDocIds.push(await uploadDocument(doc));
  }

  const results = [];
  for (const item of dataset.queries) {
    const chunks = await debugChunks(item.query, item.k ?? 5);
    const joined = chunks.map((chunk) => chunk.content ?? '').join('\n');
    const keywordHits = item.expectedKeywords.filter((keyword) =>
      joined.includes(keyword),
    );
    results.push({
      id: item.id,
      query: item.query,
      chunkCount: chunks.length,
      keywordCoverage: Number(
        (keywordHits.length / item.expectedKeywords.length).toFixed(3),
      ),
      passed: keywordHits.length >= item.minKeywordHits,
      topScores: chunks.slice(0, 3).map((chunk) => ({
        totalScore: round(chunk.totalScore),
        bm25Score: round(chunk.bm25Score),
        cosineScore: round(chunk.cosineScore),
      })),
    });
  }

  const ok = results.every((item) => item.passed);
  console.log(
    JSON.stringify(
      {
        ok,
        baseUrl,
        uploadedCount: uploadedDocIds.length,
        results,
      },
      null,
      2,
    ),
  );
  if (!ok) process.exitCode = 1;
} finally {
  await cleanup();
}

async function login() {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.HYBRID_SMOKE_USERNAME ?? 'user',
      password: process.env.HYBRID_SMOKE_PASSWORD ?? 'user1234',
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`login failed: ${response.status}`);
  return unwrap(body).accessToken;
}

async function uploadDocument(doc) {
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

async function debugChunks(query, k) {
  const url = new URL(`${baseUrl}/api/v1/debug/chunks`);
  url.searchParams.set('query', query);
  url.searchParams.set('k', String(k));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`debug failed: ${response.status}`);
  return unwrap(body).chunks ?? [];
}

async function cleanup() {
  for (const docId of uploadedDocIds) {
    await fetch(`${baseUrl}/api/v1/documents/${docId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  }
}

function round(value) {
  return typeof value === 'number' ? Number(value.toFixed(4)) : undefined;
}

function unwrap(body) {
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}
