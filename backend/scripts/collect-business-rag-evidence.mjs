import { readFile } from 'node:fs/promises';
import {
  average,
  parseBoolean,
  percentile,
  rate,
  safeError,
  unwrap,
  writeEvidenceReport,
} from './lib/evidence-utils.mjs';

const baseUrl = (
  process.env.RAG_BUSINESS_BASE_URL ?? 'http://localhost:3000'
).replace(/\/$/, '');
const datasetPath =
  process.env.RAG_BUSINESS_DATASET ??
  'eval/private-business-regression.dataset.json';
const outputPath =
  process.env.RAG_BUSINESS_OUTPUT ?? '.tmp/evidence/rag-business.json';
const modes = (process.env.RAG_BUSINESS_MODES ?? 'simple,auto')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const maxCases = Number(process.env.RAG_BUSINESS_MAX_CASES ?? '0');
const minimumPassRate = Number(process.env.RAG_BUSINESS_MIN_PASS_RATE ?? '0.9');
const minimumCitationRate = Number(
  process.env.RAG_BUSINESS_MIN_CITATION_RATE ?? '0.9',
);
const includeAnswers = parseBoolean(process.env.RAG_BUSINESS_INCLUDE_ANSWERS);
const enforce = parseBoolean(process.env.RAG_BUSINESS_ENFORCE, true);
const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
const evidenceLevel = resolveEvidenceLevel(dataset);
const allCases = Array.isArray(dataset.items) ? dataset.items : [];
const cases = maxCases > 0 ? allCases.slice(0, maxCases) : allCases;
if (cases.length === 0) throw new Error('业务评测集没有 items。');

const token = await login();
const uploadedDocIds = [];
const startedAt = new Date();

try {
  await assertHealthy();
  const documents = uniqueSourceDocuments(cases);
  if (documents.length === 0) {
    throw new Error('业务评测集缺少可上传的 sourceDocument。');
  }
  for (const document of documents) {
    uploadedDocIds.push(await uploadDocument(token, document));
  }

  const results = [];
  for (const mode of modes) {
    for (const item of cases) {
      const started = performance.now();
      try {
        const response = await ask(token, item.query, mode);
        results.push(
          evaluateCase(
            item,
            mode,
            response,
            Number((performance.now() - started).toFixed(2)),
          ),
        );
      } catch (error) {
        results.push({
          id: item.id,
          category: item.category,
          mode,
          durationMs: Number((performance.now() - started).toFixed(2)),
          passed: false,
          error: safeError(error),
        });
      }
    }
  }

  const passed = results.filter((item) => item.passed).length;
  const citationRequired = results.filter((item) => item.citationRequired);
  const citationPassed = citationRequired.filter(
    (item) => item.citationPassed,
  ).length;
  const durations = results.map((item) => item.durationMs);
  const summary = {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: rate(passed, results.length),
    citationRate: rate(citationPassed, citationRequired.length),
    refusalRate: metricRate(results, 'refusalRequired', 'refusalPassed'),
    conflictHandlingRate: metricRate(
      results,
      'conflictHandlingRequired',
      'conflictHandlingPassed',
    ),
    averageKeywordCoverage: average(
      results.map((item) => item.keywordCoverage ?? 0),
    ),
    averageClaimCoverage: average(
      results.map((item) => item.claimCoverage ?? 0),
    ),
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
  };
  const report = {
    schemaVersion: 1,
    evidenceLevel,
    generatedAt: new Date().toISOString(),
    startedAt: startedAt.toISOString(),
    baseUrl,
    dataset: datasetPath,
    datasetVersion: dataset.version ?? 'unversioned',
    sourceCaseCount: allCases.length,
    evaluatedCaseCount: cases.length,
    uploadedDocumentCount: documents.length,
    modes,
    thresholds: { minimumPassRate, minimumCitationRate },
    summary,
    passed:
      summary.passRate >= minimumPassRate &&
      summary.citationRate >= minimumCitationRate,
    results,
  };

  await writeEvidenceReport(outputPath, report, renderMarkdown(report));
  console.log(JSON.stringify(report, null, 2));
  if (enforce && !report.passed) process.exitCode = 1;
} finally {
  await cleanup(token);
}

function resolveEvidenceLevel(dataset) {
  const realDataConfirmed =
    dataset.simulated === false ||
    parseBoolean(process.env.RAG_BUSINESS_REAL_DATA_CONFIRMED);
  const requested =
    process.env.RAG_BUSINESS_EVIDENCE_LEVEL ??
    (realDataConfirmed ? 'local_real_api' : 'simulated');
  if (requested !== 'simulated' && !realDataConfirmed) {
    throw new Error(
      '当前数据集未声明 simulated=false。确认它来自真实业务并已脱敏后，设置 RAG_BUSINESS_REAL_DATA_CONFIRMED=true。',
    );
  }
  if (requested !== 'production') return requested;
  if (!parseBoolean(process.env.EVIDENCE_PRODUCTION_CONFIRMED)) {
    throw new Error(
      '标记 production 证据前必须显式设置 EVIDENCE_PRODUCTION_CONFIRMED=true。',
    );
  }
  return requested;
}

async function assertHealthy() {
  const response = await fetch(`${baseUrl}/api/v1/health`, {
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`health failed: ${response.status}`);
}

async function login() {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.RAG_BUSINESS_USERNAME ?? 'user',
      password: process.env.RAG_BUSINESS_PASSWORD ?? 'user1234',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`login failed: ${response.status}`);
  return unwrap(body).accessToken;
}

function uniqueSourceDocuments(items) {
  const documents = new Map();
  for (const item of items) {
    const document = item.sourceDocument;
    if (!document?.id || !document.content) continue;
    if (!documents.has(document.id)) documents.set(document.id, document);
  }
  return [...documents.values()];
}

async function uploadDocument(token, document) {
  const form = new FormData();
  form.append(
    'file',
    new Blob([document.content], { type: 'text/plain' }),
    `${document.id}.txt`,
  );
  const response = await fetch(`${baseUrl}/api/v1/documents/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`upload ${document.id} failed: ${response.status}`);
  }
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
    signal: AbortSignal.timeout(
      Number(process.env.RAG_BUSINESS_REQUEST_TIMEOUT_MS ?? '120000'),
    ),
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

function evaluateCase(item, mode, response, durationMs) {
  const expectedKeywords = stringArray(item.expectedKeywords);
  const keywordHits = expectedKeywords.filter((keyword) =>
    response.answer.includes(keyword),
  );
  const keywordCoverage = rate(keywordHits.length, expectedKeywords.length);
  const claimScores = (item.expectedClaims ?? []).map((claim) => {
    const keywords = stringArray(claim.supportKeywords);
    const hits = keywords.filter((keyword) =>
      response.answer.includes(keyword),
    );
    return rate(hits.length, keywords.length);
  });
  const claimCoverage = average(claimScores, 1);
  const citationRequired =
    item.requireCitation !== false && !item.expectRefusal;
  const citationPassed = citationRequired
    ? response.references.length > 0 && /\[片段\s*\d+\]/.test(response.answer)
    : true;
  const refusalRequired = item.expectRefusal === true;
  const refusalPassed = refusalRequired
    ? response.references.length === 0 &&
      (response.retrievalSufficient === false ||
        /(未找到|不足以支撑|未提及|无法确认|没有足够)/.test(response.answer))
    : true;
  const conflictHandlingRequired = item.expectConflictHandling === true;
  const conflictHandlingPassed = conflictHandlingRequired
    ? /(冲突|版本|生效|现行|较新|无法确认)/.test(response.answer) &&
      keywordCoverage >= Number(item.minKeywordCoverage ?? 0.5)
    : true;
  const minimumCoverage = Number(item.minKeywordCoverage ?? 0.5);
  const result = {
    id: item.id,
    category: item.category,
    department: item.department,
    mode,
    durationMs,
    keywordCoverage,
    claimCoverage,
    citationRequired,
    citationPassed,
    refusalRequired,
    refusalPassed,
    conflictHandlingRequired,
    conflictHandlingPassed,
    referenceCount: response.references.length,
    retrievalSufficient: response.retrievalSufficient,
    passed:
      keywordCoverage >= minimumCoverage &&
      claimCoverage >= minimumCoverage &&
      citationPassed &&
      refusalPassed &&
      conflictHandlingPassed,
  };
  if (includeAnswers) result.answer = response.answer;
  return result;
}

function metricRate(results, requiredKey, passedKey) {
  const required = results.filter((item) => item[requiredKey]);
  if (required.length === 0) return null;
  return rate(
    required.filter((item) => item[passedKey]).length,
    required.length,
  );
}

function stringArray(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

async function cleanup(token) {
  for (const docId of uploadedDocIds) {
    try {
      await fetch(`${baseUrl}/api/v1/documents/${docId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      // Evidence remains valid; cleanup is best effort and separately observable.
    }
  }
}

function renderMarkdown(report) {
  const summary = report.summary;
  return `# 真实业务 RAG 评测证据

- 生成时间：${report.generatedAt}
- 证据级别：${report.evidenceLevel}
- 数据集：${report.dataset}（${report.datasetVersion}）
- 用例：${report.evaluatedCaseCount} 条 × ${report.modes.length} 个模式
- 门禁：${report.passed ? '通过' : '失败'}

| 指标 | 结果 |
| --- | ---: |
| 通过率 | ${summary.passRate} |
| 引用通过率 | ${summary.citationRate} |
| 拒答通过率 | ${summary.refusalRate} |
| 冲突处理通过率 | ${summary.conflictHandlingRate} |
| 关键词覆盖率 | ${summary.averageKeywordCoverage} |
| Claim 覆盖率 | ${summary.averageClaimCoverage} |
| P50 | ${summary.p50Ms} ms |
| P95 | ${summary.p95Ms} ms |

> 默认报告不保存答案正文，避免真实业务内容进入证据文件。该结果只代表本次数据版本、模型配置和运行环境。
`;
}
