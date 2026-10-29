import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const baseUrl = (process.env.RAG_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');
const serviceToken = process.env.RAG_SERVICE_TOKEN ?? 'local-rag-service-token';
const limit = Math.min(Math.max(Number(process.env.BAD_CASE_REGRESSION_LIMIT ?? 20), 1), 200);
const modes = ['simple', 'auto', 'agentic'];
const outputPath = process.env.BAD_CASE_REGRESSION_OUTPUT ?? '.tmp/evidence/bad-case-regression.json';
const historyPath = process.env.BAD_CASE_REGRESSION_HISTORY ?? '.tmp/evidence/bad-case-regression-history.jsonl';
const minPassRate = Number(process.env.BAD_CASE_REGRESSION_MIN_PASS_RATE ?? 1);
const minCases = Math.max(Number(process.env.BAD_CASE_REGRESSION_MIN_CASES ?? 1), 0);

function normalize(value) {
  return String(value ?? '').replace(/\s+/g, '').toLowerCase();
}

function bigrams(value) {
  const text = normalize(value).replace(/[^\u4e00-\u9fff\da-z]/g, '');
  const result = new Set();
  for (let index = 0; index < text.length - 1; index += 1) {
    result.add(text.slice(index, index + 2));
  }
  return result;
}

function correctionCoverage(expected, actual) {
  const expectedBigrams = bigrams(expected);
  if (expectedBigrams.size === 0) return 0;
  const actualBigrams = bigrams(actual);
  let matched = 0;
  for (const phrase of expectedBigrams) {
    if (actualBigrams.has(phrase)) matched += 1;
  }
  return matched / expectedBigrams.size;
}

async function getActiveCases() {
  const response = await fetch(
    `${baseUrl}/rag/admin/agent-ops/bad-cases?limit=${limit}`,
    { headers: { Authorization: `Bearer ${serviceToken}` } },
  );
  if (!response.ok) throw new Error(`bad case list failed: ${response.status}`);
  const payload = await response.json();
  const items = Array.isArray(payload?.data) ? payload.data : payload;
  return items.filter(
    (item) =>
      item.feedback === 'negative' &&
      item.includeInRegression === true &&
      ['reviewed', 'resolved'].includes(item.status) &&
      item.query &&
      item.correctedAnswer,
  );
}

async function runCase(item, mode) {
  const response = await fetch(`${baseUrl}/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: item.query,
      mode,
      model: process.env.BAD_CASE_REGRESSION_MODEL ?? 'deepseek',
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`chat failed: ${response.status}`);
  const parsed = JSON.parse(body);
  const output = parsed?.data ?? parsed ?? {};
  const answer = String(output.answer ?? '');
  const references = Array.isArray(output.references) ? output.references : [];
  const coverage = correctionCoverage(item.correctedAnswer, answer);
  const forbiddenPhrases = Array.isArray(item.forbiddenPhrases)
    ? item.forbiddenPhrases
    : [];
  const forbiddenPassed = forbiddenPhrases.every(
    (phrase) => !normalize(answer).includes(normalize(phrase)),
  );
  const citationPassed =
    item.requireCitation === false ||
    (references.length > 0 && /\[片段\s*\d+\]/.test(answer));
  const retrievalPassed =
    item.expectRefusal === true || output.retrievalSufficient !== false;
  const routePassed = item.expectedRoute
    ? output.route === item.expectedRoute
    : true;
  const passed =
    Boolean(answer) &&
    normalize(answer) !== normalize(item.answer) &&
    coverage >= Number(process.env.BAD_CASE_REGRESSION_COVERAGE ?? 0.2) &&
    citationPassed &&
    retrievalPassed &&
    forbiddenPassed &&
    routePassed;
  return {
    id: item.id,
    query: item.query,
    mode,
    passed,
    coverage: Number(coverage.toFixed(3)),
    citationPassed,
    retrievalPassed,
    forbiddenPassed,
    routePassed,
    referenceCount: references.length,
    answer,
    route: output.route,
    retrievalSufficient: output.retrievalSufficient,
    retrievalReason: output.retrievalReason,
  };
}

let cases = [];
let collectionError = null;
try {
  cases = await getActiveCases();
} catch (error) {
  collectionError = error instanceof Error ? error.message : String(error);
}
const results = [];
for (const item of cases) {
  for (const mode of modes) {
    try {
      results.push(await runCase(item, mode));
    } catch (error) {
      results.push({
        id: item.id,
        query: item.query,
        mode,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

const passed = results.filter((result) => result.passed).length;
const report = {
  generatedAt: new Date().toISOString(),
  datasetHash: createHash('sha256')
    .update(JSON.stringify(cases))
    .digest('hex'),
  cases: cases.length,
  modes,
  total: results.length,
  passed,
  failed: results.length - passed,
  skipped: cases.length === 0,
  passRate: results.length ? Number((passed / results.length).toFixed(4)) : 0,
  minPassRate,
  minCases,
  collectionError,
  results,
  historyPath,
};
console.log(JSON.stringify(report, null, 2));
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
await mkdir(path.dirname(historyPath), { recursive: true });
await appendFile(historyPath, `${JSON.stringify({
  generatedAt: report.generatedAt,
  cases: report.cases,
  total: report.total,
  passed: report.passed,
  failed: report.failed,
  passRate: report.total ? report.passed / report.total : 0,
  datasetHash: report.datasetHash,
})}\n`);
if (collectionError) {
  console.error(`Bad Case regression collection failed: ${collectionError}`);
  process.exitCode = 1;
} else if (results.length === 0 || cases.length < minCases) {
  console.error('No active Bad Case regression samples found.');
  process.exitCode = 2;
} else if (report.passRate < minPassRate) {
  process.exitCode = 1;
}
