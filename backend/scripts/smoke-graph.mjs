import { readFile } from 'node:fs/promises';

const baseUrl = (process.env.GRAPH_SMOKE_BASE_URL ?? 'http://localhost:3000')
  .replace(/\/$/, '');
const datasetPath =
  process.env.GRAPH_SMOKE_DATASET ?? 'eval/graph-smoke.seed.json';
const shouldImport = process.env.GRAPH_SMOKE_IMPORT !== 'false';
const seed = JSON.parse(await readFile(datasetPath, 'utf8'));
const token = await login();

const before = await getSchema();
let importResult;
if (shouldImport) {
  importResult = await importGraph();
}
const after = await getSchema();
const queryResult = await queryGraph(seed.query);
const ok =
  after.enabled === true &&
  (!shouldImport || after.nodeCount >= before.nodeCount) &&
  queryResult.answerLength > 0;

console.log(
  JSON.stringify(
    {
      ok,
      baseUrl,
      imported: shouldImport,
      before,
      after,
      importResult,
      queryResult,
    },
    null,
    2,
  ),
);

if (!ok) {
  process.exitCode = 1;
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

async function getSchema() {
  const response = await fetch(`${baseUrl}/api/v1/graph/schema`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`schema failed: ${response.status}`);
  }
  const data = unwrap(body);
  return {
    enabled: data.enabled,
    nodeCount: data.nodeCount,
    relationshipCount: data.relationshipCount,
    labels: data.labels,
    relationshipTypes: data.relationshipTypes,
  };
}

async function importGraph() {
  const response = await fetch(`${baseUrl}/api/v1/graph/import`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: seed.text,
      sourceId: process.env.GRAPH_SMOKE_SOURCE_ID ?? seed.sourceId,
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`import failed: ${response.status}`);
  }
  const data = unwrap(body);
  return {
    sourceId: data.sourceId,
    nodeCount: data.nodeCount,
    relationshipCount: data.relationshipCount,
  };
}

async function queryGraph(query) {
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
    entities: data.entities,
    factCount: data.facts?.length ?? 0,
    answerLength: data.answer?.length ?? 0,
  };
}

function unwrap(body) {
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}
