import { readFile } from 'node:fs/promises';

const baseUrl = (process.env.RAG_BUSINESS_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const datasetPath = process.env.GAME_MARKETING_PUBLIC_DATASET ?? 'eval/game-marketing-public-sources.dataset.json';
const maxDocuments = Number(process.env.GAME_MARKETING_IMPORT_MAX ?? '0');
const dryRun = process.argv.includes('--dry-run');
const onlyPublic = process.argv.includes('--only-public');
const requestedIds = new Set(
  (process.env.GAME_MARKETING_IMPORT_IDS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);
const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
const documents = Array.isArray(dataset.documents) ? dataset.documents : [];
const scopedDocuments = onlyPublic
  ? documents.filter((document) => document.metadata?.evidenceLevel === 'public_web_snapshot')
  : documents;
const idScopedDocuments = requestedIds.size > 0
  ? scopedDocuments.filter((document) => requestedIds.has(document.id))
  : scopedDocuments;
const selected = maxDocuments > 0 ? idScopedDocuments.slice(0, maxDocuments) : idScopedDocuments;

if (dryRun) {
  console.log(JSON.stringify({ ok: true, mode: 'dry-run', datasetPath, documents: selected.length }, null, 2));
} else {
  const token = await login();
  const results = [];
  for (const document of selected) {
    results.push(await upload(token, document));
  }
  console.log(JSON.stringify({
    ok: results.every((item) => item.ok),
    datasetPath,
    imported: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok),
    evidenceLevels: [...new Set(selected.map((item) => item.metadata?.evidenceLevel ?? 'unknown'))],
  }, null, 2));
}

async function login() {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: process.env.RAG_BUSINESS_USERNAME ?? 'user',
      password: process.env.RAG_BUSINESS_PASSWORD ?? 'user1234',
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`login failed: ${response.status}`);
  return unwrap(body).accessToken;
}

async function upload(token, document) {
  try {
    const form = new FormData();
    form.append('file', new Blob([document.content], { type: 'text/markdown' }), `${document.id}.md`);
    form.append('region', String(document.metadata?.region ?? '待确认'));
    form.append('channel', String(document.metadata?.platform ?? 'pc-h5'));
    form.append('documentType', normalizeDocumentType(document.metadata?.documentType));
    const response = await fetch(`${baseUrl}/api/v1/documents/upload/async`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(20000),
    });
    const body = await response.json();
    if (!response.ok) return { ok: false, id: document.id, status: response.status, error: body?.message };
    return { ok: true, id: document.id, taskId: unwrap(body)?.taskId, status: unwrap(body)?.status };
  } catch (error) {
    return { ok: false, id: document.id, error: error instanceof Error ? error.message : String(error) };
  }
}

function unwrap(body) {
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}

function normalizeDocumentType(value) {
  if (value === 'api' || value === 'design' || value === 'test' || value === 'config' || value === 'postmortem' || value === 'prd') return value;
  return 'general';
}
