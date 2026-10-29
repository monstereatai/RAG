import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const root = new URL('../', import.meta.url);
const datasetPath = process.env.GOLDEN_EVAL_DATASET ?? new URL('../eval/golden-business.dataset.json', import.meta.url);
const requireLive = process.env.GOLDEN_EVAL_REQUIRE_LIVE === 'true';
const baseUrl = (process.env.GOLDEN_EVAL_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

const manifest = JSON.parse(await readFile(datasetPath, 'utf8'));
const resolved = await resolveManifest(manifest);
const report = validateManifest(manifest, resolved);

if (!report.ok || !requireLive) {
  const offlineReport = { ...report, live: false, dataset: String(datasetPath), generatedAt: new Date().toISOString() };
  await writeReport(offlineReport, 'golden-business-latest.json');
  console.log(JSON.stringify(offlineReport, null, 2));
  if (!report.ok) process.exitCode = 1;
  if (!requireLive) process.exit(0);
}

const uploadedDocIds = [];
try {
  await assertServiceReady();
  const token = await login();
  for (const doc of resolved.documents) uploadedDocIds.push(await uploadDocument(token, doc));
  const results = [];
  for (const item of resolved.cases) {
    for (const mode of ['simple', 'auto', 'agentic']) {
      const threadId = item.turns?.length ? randomUUID() : undefined;
      for (const turn of item.turns ?? []) await ask(token, turn, mode, threadId);
      const response = await ask(token, item.finalQuery ?? item.query, mode, threadId);
      results.push(score(item, mode, response));
    }
  }
  const passed = results.filter((item) => item.passed).length;
  const score = Number((passed / results.length).toFixed(3));
  const liveReport = {
    generatedAt: new Date().toISOString(),
    ok: score >= Number(process.env.GOLDEN_EVAL_MIN_SCORE ?? '0.9'),
    live: true,
    dataset: String(datasetPath),
    caseCount: resolved.cases.length,
    score,
    summary: summarize(results),
    results,
  };
  await writeReport(liveReport, 'golden-business-latest.json');
  console.log(JSON.stringify(liveReport, null, 2));
  if (!liveReport.ok) process.exitCode = 1;
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  const blockedReport = { ok: false, live: true, blocked: true, generatedAt: new Date().toISOString(), dataset: String(datasetPath), reason: reason.slice(0, 300) };
  await writeReport(blockedReport, 'golden-business-latest.json');
  console.log(JSON.stringify(blockedReport, null, 2));
  process.exitCode = 1;
} finally {
  await cleanup(uploadedDocIds);
}

async function resolveManifest(value) {
  const datasets = new Map();
  for (const source of value.sourceDatasets ?? []) {
    const data = JSON.parse(await readFile(new URL(source.path, root), 'utf8'));
    datasets.set(source.id, data);
  }
  const cases = [];
  const documents = new Map();
  for (const group of value.groups ?? []) {
    const data = datasets.get(group.sourceDataset);
    const items = data?.items ?? data?.queries ?? [];
    for (const sourceId of group.ids ?? []) {
      const item = items.find((candidate) => candidate.id === sourceId);
      if (!item) throw new Error(`golden case source not found: ${group.sourceDataset}/${sourceId}`);
      const projectDocumentIds = item.sourceDocumentIds ?? [];
      for (const doc of data.documents ?? []) {
        const includeAllDocuments = ['project-simulated', 'hybrid-regression'].includes(group.sourceDataset);
        if (includeAllDocuments || projectDocumentIds.includes(doc.id)) {
          documents.set(doc.id, { id: doc.id, title: doc.title ?? doc.id, content: doc.content });
        }
      }
      if (item.sourceDocument?.content) documents.set(item.sourceDocument.id, { id: item.sourceDocument.id, title: item.sourceDocument.title, content: item.sourceDocument.content });
      cases.push({ ...item, id: sourceId, dimensions: group.dimensions, expectedSourcePolicy: group.expectedSourcePolicy, expectedAutoRoute: group.expectedAutoRoute, finalQuery: item.query, turns: [] });
    }
  }
  for (const item of value.conversationCases ?? []) cases.push(item);
  for (const doc of value.supportingDocuments ?? []) {
    documents.set(doc.id, { id: doc.id, title: doc.title ?? doc.id, content: doc.content });
  }
  return { cases, documents: [...documents.values()] };
}

function validateManifest(value, resolved) {
  const errors = [];
  const ids = new Set();
  for (const item of resolved.cases) {
    if (ids.has(item.id)) errors.push(`duplicate case: ${item.id}`);
    ids.add(item.id);
    if (!item.finalQuery) errors.push(`${item.id}: finalQuery/query required`);
    if (!Array.isArray(item.dimensions) || item.dimensions.length === 0) errors.push(`${item.id}: dimensions required`);
    if (!['direct_answer', 'local_only', 'web_allowed'].includes(item.expectedSourcePolicy)) errors.push(`${item.id}: invalid source policy`);
    if (!['simple', 'agentic'].includes(item.expectedAutoRoute)) errors.push(`${item.id}: invalid expected auto route`);
  }
  const dimensions = new Set(resolved.cases.flatMap((item) => item.dimensions ?? []));
  for (const dimension of value.dimensions ?? []) if (!dimensions.has(dimension)) errors.push(`missing dimension coverage: ${dimension}`);
  if (resolved.cases.length < 50 || resolved.cases.length > 100) errors.push(`case count must be 50..100, got ${resolved.cases.length}`);
  if (resolved.documents.length < 5) errors.push('at least 5 source documents required');
  return { ok: errors.length === 0, caseCount: resolved.cases.length, documentCount: resolved.documents.length, dimensions: [...dimensions], errors };
}

function score(item, mode, response) {
  const answer = response.answer ?? '';
  const keywords = item.expectedKeywords ?? [];
  const keywordHits = keywords.filter((keyword) => answer.includes(keyword));
  const minHits = item.minKeywordHits ?? (keywords.length ? Math.max(1, Math.ceil(keywords.length / 2)) : 0);
  const isRefusal = item.expectRefusal === true;
  const keywordPassed = isRefusal || keywordHits.length >= minHits;
  const conflictPassed = item.expectConflictHandling !== true || (/2026/.test(answer) && /(优先|最新|版本|旧版|历史)/.test(answer));
  const citationPassed = item.requireCitation !== true || (response.references.length > 0 && /\[片段\s*\d+\]/.test(answer));
  const refusalPassed = !isRefusal || (response.references.length === 0 && (response.retrievalSufficient === false || /未找到|不足以支撑|知识库中没有|未提及/.test(answer)));
  const routePassed = mode !== 'auto' || !item.expectedAutoRoute || response.route === item.expectedAutoRoute;
  return { id: item.id, mode, keywordHits, keywordPassed, conflictPassed, citationPassed, refusalPassed, routePassed, referenceCount: response.references.length, retrievalSufficient: response.retrievalSufficient, route: response.route, passed: keywordPassed && conflictPassed && citationPassed && refusalPassed && routePassed };
}

function summarize(results) {
  const summary = {};
  for (const result of results) {
    const bucket = summary[result.mode] ?? { total: 0, passed: 0 };
    bucket.total += 1;
    if (result.passed) bucket.passed += 1;
    summary[result.mode] = bucket;
  }
  return summary;
}

async function assertServiceReady() {
  const response = await fetch(`${baseUrl}/api/v1/health`, { signal: AbortSignal.timeout(2_000) });
  if (!response.ok) throw new Error(`service health failed: ${response.status}`);
}

async function login() {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.GOLDEN_EVAL_USERNAME ?? 'user', password: process.env.GOLDEN_EVAL_PASSWORD ?? 'user1234' }) });
  const body = await response.json();
  if (!response.ok) throw new Error(`login failed: ${response.status}`);
  return unwrap(body).accessToken;
}

async function uploadDocument(token, doc) {
  const form = new FormData();
  form.append('file', new Blob([doc.content], { type: 'text/plain' }), `${doc.id}.txt`);
  const response = await fetch(`${baseUrl}/api/v1/documents/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const body = await response.json();
  if (!response.ok) throw new Error(`upload failed: ${response.status}`);
  return unwrap(body).docId;
}

async function ask(token, query, mode, threadId) {
  const response = await fetch(`${baseUrl}/api/v1/chat`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, mode, ...(threadId ? { threadId } : {}) }) });
  const body = await response.json();
  if (!response.ok) throw new Error(`chat failed: ${response.status}`);
  const data = unwrap(body);
  return { answer: data.answer ?? '', references: Array.isArray(data.references) ? data.references : [], retrievalSufficient: data.retrievalSufficient, route: data.route };
}

async function cleanup(docIds) {
  if (docIds.length === 0) return;
  try {
    const token = await login();
    for (const docId of docIds) await fetch(`${baseUrl}/api/v1/documents/${docId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  } catch {
    // Best effort cleanup; the live report remains authoritative.
  }
}

function unwrap(body) {
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}

async function writeReport(value, filename) {
  const directory = process.env.EVAL_REPORT_DIR ?? '.tmp/evidence';
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/${filename}`, `${JSON.stringify(value, null, 2)}\n`);
}
