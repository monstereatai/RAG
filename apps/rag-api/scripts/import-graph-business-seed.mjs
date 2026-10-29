import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const baseUrl = (process.env.GRAPH_SMOKE_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const datasetPath = resolve(
  args.input ?? process.env.GRAPH_BUSINESS_SEED ?? 'eval/graph-business.seed.example.json',
);
const dryRun = args['dry-run'] === true;
const seed = JSON.parse(await readFile(datasetPath, 'utf8'));
const documents = normalizeDocuments(seed);
const errors = validateDocuments(documents);

if (errors.length > 0 || dryRun) {
  const report = {
    ok: errors.length === 0,
    mode: dryRun ? 'dry-run' : 'validate',
    datasetPath,
    documentCount: documents.length,
    queryCount: documents.filter((doc) => doc.query).length,
    sourceIds: documents.map((doc) => doc.sourceId),
    errors,
  };
  console.log(JSON.stringify(report, null, 2));
  if (errors.length > 0) process.exitCode = 1;
} else {
  const token = await login();
  const imports = [];
  const queries = [];

  for (const document of documents) {
    imports.push(await importGraph(token, document));
    if (document.query) {
      queries.push(await queryGraph(token, document.query));
    }
  }

  const ok =
    imports.every((item) => item.nodeCount > 0 || item.relationshipCount > 0) &&
    queries.every((item) => item.answerLength > 0);

  console.log(
    JSON.stringify(
      {
        ok,
        mode: 'import',
        baseUrl,
        datasetPath,
        documentCount: documents.length,
        imports,
        queries,
      },
      null,
      2,
    ),
  );
  if (!ok) process.exitCode = 1;
}

function normalizeDocuments(seedPayload) {
  if (Array.isArray(seedPayload)) return seedPayload.map(normalizeDocument);
  if (Array.isArray(seedPayload.documents)) {
    return seedPayload.documents.map(normalizeDocument);
  }
  return [normalizeDocument(seedPayload)];
}

function normalizeDocument(document, index) {
  return {
    sourceId: String(document.sourceId ?? `business-graph-${index + 1}`).trim(),
    title: String(document.title ?? '').trim(),
    text: String(document.text ?? '').trim(),
    query: document.query ? String(document.query).trim() : undefined,
  };
}

function validateDocuments(documents) {
  const errors = [];
  const ids = new Set();
  if (documents.length === 0) errors.push('documents[] is empty');
  for (const [index, document] of documents.entries()) {
    const label = document.sourceId || `documents[${index}]`;
    if (!document.sourceId) errors.push(`${label}: sourceId is required`);
    if (ids.has(document.sourceId)) errors.push(`${label}: duplicated sourceId`);
    ids.add(document.sourceId);
    if (!document.text) errors.push(`${label}: text is required`);
  }
  return errors;
}

async function login() {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.GRAPH_SMOKE_USERNAME ?? 'user',
      password: process.env.GRAPH_SMOKE_PASSWORD ?? 'user1234',
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`login failed: ${response.status}`);
  }
  return unwrap(body).accessToken;
}

async function importGraph(token, document) {
  const response = await fetch(`${baseUrl}/api/v1/graph/import`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: document.text,
      sourceId: document.sourceId,
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`import ${document.sourceId} failed: ${response.status}`);
  }
  const data = unwrap(body);
  return {
    sourceId: data.sourceId,
    nodeCount: data.nodeCount,
    relationshipCount: data.relationshipCount,
  };
}

async function queryGraph(token, query) {
  const response = await fetch(`${baseUrl}/api/v1/graph/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`query failed: ${response.status}`);
  }
  const data = unwrap(body);
  return {
    query,
    factCount: data.facts?.length ?? 0,
    answerLength: data.answer?.length ?? 0,
  };
}

function unwrap(body) {
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--dry-run') {
      parsed['dry-run'] = true;
    } else if (value.startsWith('--')) {
      const key = value.slice(2);
      const next = values[index + 1];
      if (next && !next.startsWith('--')) {
        parsed[key] = next;
        index += 1;
      } else {
        parsed[key] = true;
      }
    }
  }
  return parsed;
}
