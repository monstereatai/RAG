import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const datasetPath =
  process.env.EVAL_RAG_DATASET ??
  join(__dirname, '..', 'eval', 'rag-smoke.dataset.json');
const baseUrl = process.env.EVAL_RAG_BASE_URL?.replace(/\/$/, '');
const minAverageScore = Number(process.env.EVAL_RAG_MIN_AVG_SCORE ?? '0.65');

const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
const token = baseUrl ? await getToken(baseUrl) : undefined;
let seedDocId;

try {
  if (baseUrl && token) {
    seedDocId = await uploadSeedDocument(baseUrl, token, dataset);
  }

  const results = [];
  for (const item of dataset) {
    const response = baseUrl
      ? await askService(baseUrl, token, item.query)
      : {
          answer: item.referenceAnswer,
          references: item.referenceReferences ?? [],
          retrievalSufficient: item.referenceRetrievalSufficient ?? true,
        };
    const answer = response.answer;
    const score = keywordCoverage(answer, item.expectedKeywords);
    const keywordPassed = score >= item.minKeywordCoverage;
    const citationPassed =
      item.requireCitation === true
        ? hasCitation(answer) && response.references.length > 0
        : true;
    const claimResults = evaluateClaims(answer, item.expectedClaims ?? []);
    const claimsPassed = claimResults.every((claim) => claim.passed);
    const refusalPassed =
      item.expectRefusal === true
        ? response.references.length === 0 &&
          (response.retrievalSufficient === false ||
            answer.includes('未找到') ||
            answer.includes('不足以支撑') ||
            answer.includes('未提及'))
        : true;
    const conflictPassed =
      item.expectConflictHandling === true
        ? answer.includes('冲突') ||
          answer.includes('版本') ||
          answer.includes('优先')
        : true;
    const passed =
      keywordPassed &&
      citationPassed &&
      claimsPassed &&
      refusalPassed &&
      conflictPassed;

    results.push({
      id: item.id,
      category: item.category ?? 'uncategorized',
      department: item.department ?? 'unknown',
      documentType: item.documentType ?? 'unknown',
      mode: baseUrl ? 'online' : 'offline',
      score,
      threshold: item.minKeywordCoverage,
      keywordPassed,
      citationPassed,
      claimsPassed,
      conflictPassed,
      refusalPassed,
      claimResults,
      passed,
    });
  }

  const averageScore =
    results.reduce((sum, item) => sum + item.score, 0) / results.length;
  const passed =
    results.every((item) => item.passed) && averageScore >= minAverageScore;

  console.log(
    JSON.stringify(
      {
        passed,
        mode: baseUrl ? 'online' : 'offline',
        minAverageScore,
        averageScore: Number(averageScore.toFixed(3)),
        summary: summarize(results),
        seedDocId,
        results,
      },
      null,
      2,
    ),
  );

  if (!passed) {
    process.exitCode = 1;
  }
} finally {
  if (baseUrl && token && seedDocId) {
    await deleteDocument(baseUrl, token, seedDocId);
  }
}

function keywordCoverage(answer, expectedKeywords) {
  if (!answer || expectedKeywords.length === 0) return 0;
  const normalized = answer.toLowerCase();
  const hits = expectedKeywords.filter((keyword) =>
    normalized.includes(keyword.toLowerCase()),
  );
  return Number((hits.length / expectedKeywords.length).toFixed(3));
}

function hasCitation(answer) {
  return /\[片段\s*\d+\]/.test(answer ?? '');
}

function evaluateClaims(answer, claims) {
  if (!Array.isArray(claims) || claims.length === 0) return [];
  const normalized = (answer ?? '').toLowerCase();
  return claims.map((claim) => {
    const keywords = Array.isArray(claim.supportKeywords)
      ? claim.supportKeywords
      : [];
    const hits = keywords.filter((keyword) =>
      normalized.includes(String(keyword).toLowerCase()),
    );
    return {
      text: claim.text,
      score:
        keywords.length === 0
          ? 1
          : Number((hits.length / keywords.length).toFixed(3)),
      hits,
      passed: keywords.length === 0 || hits.length === keywords.length,
    };
  });
}

function summarize(results) {
  const byCategory = {};
  for (const result of results) {
    const key = result.category;
    const bucket = byCategory[key] ?? { total: 0, passed: 0 };
    bucket.total += 1;
    if (result.passed) bucket.passed += 1;
    byCategory[key] = bucket;
  }
  return { byCategory };
}

async function getToken(url) {
  const res = await fetch(`${url}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.EVAL_RAG_USERNAME ?? 'user',
      password: process.env.EVAL_RAG_PASSWORD ?? 'user1234',
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return unwrap(body).accessToken;
}

async function askService(url, accessToken, query) {
  const res = await fetch(`${url}/api/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query, mode: 'simple' }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`chat failed: ${res.status} ${JSON.stringify(body)}`);
  }
  const data = unwrap(body);
  return {
    answer: data.answer ?? '',
    references: Array.isArray(data.references) ? data.references : [],
    retrievalSufficient: data.retrievalSufficient,
  };
}

async function uploadSeedDocument(url, accessToken, items) {
  const seedText = items
    .map(
      (item) =>
        `Question: ${item.query}\nReference answer: ${item.referenceAnswer}`,
    )
    .join('\n\n');
  const form = new FormData();
  form.append(
    'file',
    new Blob([seedText], { type: 'text/plain' }),
    'rag-eval-smoke.txt',
  );

  const res = await fetch(`${url}/api/v1/documents/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`seed upload failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return unwrap(body).docId;
}

async function deleteDocument(url, accessToken, docId) {
  await fetch(`${url}/api/v1/documents/${docId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

function unwrap(body) {
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}
