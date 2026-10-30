import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  relatedDocumentIdsForQuery,
  validateProjectEvalDataset,
} from './lib/project-eval-dataset.mjs';

const baseUrl = (
  process.env.PROJECT_EVAL_BASE_URL ?? 'http://localhost:3000'
).replace(/\/$/, '');
const datasetPath =
  process.env.PROJECT_EVAL_DATASET ??
  'eval/project-simulated-business.dataset.json';
const minScore = Number(process.env.PROJECT_EVAL_MIN_SCORE ?? '0.9');
const requireLive = process.env.PROJECT_EVAL_REQUIRE_LIVE === 'true';
const allowSkip = process.env.PROJECT_EVAL_ALLOW_SKIP === 'true';
const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
assertDataset(dataset);
const requestedSplit = process.env.PROJECT_EVAL_SPLIT ?? 'all';
if (!['all', 'development', 'holdout'].includes(requestedSplit)) {
  throw new Error('PROJECT_EVAL_SPLIT must be all, development, or holdout');
}
const evalQueries =
  requestedSplit === 'all'
    ? dataset.queries
    : dataset.queries.filter((item) => item.split === requestedSplit);
if (evalQueries.length === 0) {
  throw new Error(`No evaluation queries found for split: ${requestedSplit}`);
}
const defaultModes = Array.isArray(dataset.defaultModes)
  ? dataset.defaultModes
  : ['simple', 'auto', 'agentic'];
const modes = (process.env.PROJECT_EVAL_MODES ?? defaultModes.join(','))
  .split(',')
  .map((mode) => mode.trim())
  .filter(Boolean);
const variants = buildEvalVariants();
const chatTimeoutMs = Number(
  process.env.PROJECT_EVAL_CHAT_TIMEOUT_MS ?? '120000',
);
const chatRetries = Number(process.env.PROJECT_EVAL_CHAT_RETRIES ?? '1');
const liveJudgeMarker = 'RAG_LIVE_JUDGE_INPUT=';
const serviceToken =
  process.env.PROJECT_EVAL_SERVICE_TOKEN?.trim() ||
  process.env.RAG_SERVICE_TOKEN?.trim() ||
  null;

const uploadedDocIds = [];
const uploadedDocIdByDatasetId = new Map();
const liveJudgeCases = [];
const evaluationProjectId = `eval-${randomUUID()}`;
let cleanupToken = null;

try {
  await assertServiceReady();
  await assertProfilesAvailable();
  const token = await login();
  cleanupToken = token;

  for (const doc of dataset.documents) {
    const uploadedDocId = await uploadDocument(
      token,
      doc,
      evaluationProjectId,
    );
    uploadedDocIds.push(uploadedDocId);
    uploadedDocIdByDatasetId.set(doc.id, uploadedDocId);
  }

  const results = [];
  for (const mode of modes) {
    for (const [queryIndex, item] of evalQueries.entries()) {
      // 轮换执行顺序，避免同一配置总是先跑或后跑。
      const orderedVariants =
        queryIndex % 2 === 0 ? variants : [...variants].reverse();
      for (const variant of orderedVariants) {
        const started = Date.now();
        let response = null;
        let queryError = null;
        try {
          response = await askWithRetry(
            token,
            item.query,
            mode,
            variant.knowledgeBaseKey,
            evaluationProjectId,
          );
        } catch (error) {
          queryError = error instanceof Error ? error.message : String(error);
        }
        const durationMs = Date.now() - started;
        const scoredResult =
          queryError == null
            ? scoreAnswer(
                item,
                response,
                mode,
                variant.name,
                durationMs,
                uploadedDocIdByDatasetId,
              )
            : scoreQueryError(
                item,
                mode,
                variant.name,
                durationMs,
                queryError,
                uploadedDocIdByDatasetId,
              );
        const estimatedUsage =
          queryError == null
            ? await readEstimatedRunUsage(response?.runId, serviceToken)
            : unavailableUsage('chat_failed');
        results.push({
          ...scoredResult,
          runId: response?.runId ?? null,
          estimatedUsage,
        });
        if (queryError == null && !isRefusalQuery(item)) {
          liveJudgeCases.push(
            toLiveJudgeCase(item, response, mode, variant.name),
          );
        }
      }
    }
  }

  const passedCount = results.filter((item) => item.passed).length;
  const score = Number((passedCount / results.length).toFixed(3));
  const variantScores = Object.fromEntries(
    variants.map((variant) => {
      const variantResults = results.filter(
        (item) => item.variant === variant.name,
      );
      const variantPassed = variantResults.filter((item) => item.passed).length;
      return [
        variant.name,
        Number(
          (variantPassed / Math.max(variantResults.length, 1)).toFixed(3),
        ),
      ];
    }),
  );
  const modeVariantScores = Object.fromEntries(
    modes.flatMap((mode) =>
      variants.map((variant) => {
        const groupResults = results.filter(
          (item) => item.mode === mode && item.variant === variant.name,
        );
        const groupPassed = groupResults.filter((item) => item.passed).length;
        return [
          `${mode}:${variant.name}`,
          Number((groupPassed / Math.max(groupResults.length, 1)).toFixed(3)),
        ];
      }),
    ),
  );
  const ok = Object.values(modeVariantScores).every((groupScore) =>
    Number.isFinite(minScore) && groupScore >= minScore,
  );

  const report = {
    generatedAt: new Date().toISOString(),
    ok,
    skipped: false,
    qualityMeasured: true,
    synthetic: typeof dataset.synthetic === 'boolean' ? dataset.synthetic : null,
    provenanceKind: dataset.provenance?.kind ?? 'unspecified',
    baseUrl,
    dataset: datasetPath,
    version: dataset.version,
    split: requestedSplit,
    score,
    variantScores,
    modeVariantScores,
    minScore,
    uploadedCount: uploadedDocIds.length,
    modes,
    variants: variants.map((variant) => ({
      name: variant.name,
      knowledgeBaseKey: variant.knowledgeBaseKey ?? null,
      retrievalConfig: variant.retrievalConfig ?? null,
    })),
    costMeasurement: {
      source: 'agent_runtime_event.cost.estimated',
      amountSemantics: 'estimated_cost_usd',
      tokenSemantics:
        'source identifies whether token counts were provider-reported or estimated',
      serviceTokenConfigured: Boolean(serviceToken),
    },
    summary: summarize(results),
    summaryBySplit: summarizeBySplit(results),
    metrics: summarizeMetrics(results),
    costMetrics: summarizeEstimatedUsage(results, variants, modes),
    pairedComparison: compareVariants(results, variants, modes),
    results,
  };
  await writeReport(report, 'project-rag-e2e-latest.json');
  if (process.env.PROJECT_EVAL_JUDGE_STDOUT === 'true') {
    process.stdout.write(
      `${liveJudgeMarker}${JSON.stringify({
        results: liveJudgeCases,
        dataset: datasetPath,
        expectedCaseCount:
          modes.length *
          variants.length *
          evalQueries.filter((item) => !isRefusalQuery(item)).length,
      })}\n`,
    );
  }
  console.log(JSON.stringify(report, null, 2));

  if (!ok) process.exitCode = 1;
} catch (err) {
  const reason = err instanceof Error ? err.message : String(err);
  const skippedReport = {
    generatedAt: new Date().toISOString(),
    ok: false,
    skipped: true,
    qualityMeasured: false,
    synthetic: typeof dataset.synthetic === 'boolean' ? dataset.synthetic : null,
    provenanceKind: dataset.provenance?.kind ?? 'unspecified',
    baseUrl,
    dataset: datasetPath,
    version: dataset.version,
    split: requestedSplit,
    score: 0,
    minScore,
    validatedOnly: true,
    reason: reason.slice(0, 240),
    datasetSummary: {
      documentCount: dataset.documents.length,
      queryCount: dataset.queries.length,
      negativeCount: dataset.queries.filter((item) => item.expectRefusal)
        .length,
      conflictCount: dataset.queries.filter(
        (item) => item.expectConflictHandling,
      ).length,
    },
  };
  await writeReport(skippedReport, 'project-rag-e2e-latest.json');
  console.log(JSON.stringify(skippedReport, null, 2));
  if (requireLive || allowSkip === false) process.exitCode = 1;
} finally {
  await cleanup();
}

function assertDataset(value) {
  const errors = validateProjectEvalDataset(value);
  if (errors.length > 0) {
    throw new Error(`invalid project evaluation dataset: ${errors.join('; ')}`);
  }
}

function buildEvalVariants() {
  const baseline = process.env.PROJECT_EVAL_PROFILE_A?.trim();
  const candidate = process.env.PROJECT_EVAL_PROFILE_B?.trim();
  if (Boolean(baseline) !== Boolean(candidate)) {
    throw new Error(
      'Set both PROJECT_EVAL_PROFILE_A and PROJECT_EVAL_PROFILE_B to compare retrieval profiles.',
    );
  }
  if (!baseline) return [{ name: 'default' }];
  if (baseline === candidate) {
    throw new Error('A/B retrieval profile keys must be different.');
  }
  for (const [name, key] of [
    ['A', baseline],
    ['B', candidate],
  ]) {
    if (key.length > 128) {
      throw new Error(`PROJECT_EVAL_PROFILE_${name} must be 128 characters or fewer.`);
    }
  }
  return [
    { name: 'A', knowledgeBaseKey: baseline },
    { name: 'B', knowledgeBaseKey: candidate },
  ];
}

async function assertProfilesAvailable() {
  if (variants.length < 2) return;
  if (!serviceToken) {
    throw new Error(
      'Profile A/B evaluation requires PROJECT_EVAL_SERVICE_TOKEN or RAG_SERVICE_TOKEN to validate the selected profiles.',
    );
  }
  const response = await fetch(
    `${baseUrl}/api/v1/platform-governance/knowledge-base-profiles?workspaceId=default`,
    { headers: { 'x-service-token': serviceToken } },
  );
  if (!response.ok) {
    throw new Error(`retrieval profile lookup failed: ${response.status}`);
  }
  const profiles = unwrap(await response.json());
  const profileByKey = new Map(
    (Array.isArray(profiles) ? profiles : []).map((profile) => [
      profile.key,
      profile,
    ]),
  );
  for (const variant of variants) {
    const profile = profileByKey.get(variant.knowledgeBaseKey);
    if (!profile) {
      throw new Error(
        `retrieval profile ${variant.knowledgeBaseKey} was not found or is disabled`,
      );
    }
    try {
      variant.retrievalConfig =
        typeof profile.retrievalConfig === 'string'
          ? JSON.parse(profile.retrievalConfig)
          : profile.retrievalConfig ?? {};
    } catch {
      throw new Error(
        `retrieval profile ${variant.knowledgeBaseKey} has invalid configuration`,
      );
    }
    if (
      !variant.retrievalConfig ||
      typeof variant.retrievalConfig !== 'object' ||
      Array.isArray(variant.retrievalConfig)
    ) {
      throw new Error(
        `retrieval profile ${variant.knowledgeBaseKey} configuration must be an object`,
      );
    }
  }
  if (
    JSON.stringify(sortedConfigEntries(variants[0].retrievalConfig)) ===
    JSON.stringify(sortedConfigEntries(variants[1].retrievalConfig))
  ) {
    throw new Error('retrieval profile A and B have identical configurations');
  }
}

async function readEstimatedRunUsage(runId, token) {
  if (!token) return unavailableUsage('service_token_missing');
  if (typeof runId !== 'string' || !runId.trim()) {
    return unavailableUsage('run_id_missing');
  }
  try {
    const response = await fetch(
      `${baseUrl}/api/v1/rag/admin/agent-ops/run-center/${encodeURIComponent(runId)}`,
      {
        headers: { 'x-service-token': token },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) {
      return unavailableUsage(`run_detail_http_${response.status}`);
    }
    const run = unwrap(await response.json());
    const costEvents = Array.isArray(run?.events)
      ? run.events.filter((event) => event?.eventType === 'cost.estimated')
      : [];
    if (costEvents.length === 0) return unavailableUsage('cost_event_missing');

    const payload = parseEventPayload(costEvents.at(-1)?.payload);
    const inputTokens = finiteNonNegativeNumber(payload?.inputTokens);
    const outputTokens = finiteNonNegativeNumber(payload?.outputTokens);
    const costUsdEstimated = finiteNonNegativeNumber(payload?.costUsd);
    if (
      inputTokens == null ||
      outputTokens == null ||
      costUsdEstimated == null
    ) {
      return unavailableUsage('cost_event_invalid');
    }
    return {
      status: 'available',
      inputTokens,
      outputTokens,
      costUsdEstimated,
      source:
        typeof payload.source === 'string'
          ? payload.source.slice(0, 100)
          : 'unspecified',
      costEventCount: costEvents.length,
    };
  } catch {
    // 不把请求异常、响应正文或鉴权信息写入评测报告。
    return unavailableUsage('run_detail_request_failed');
  }
}

function parseEventPayload(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function finiteNonNegativeNumber(value) {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function unavailableUsage(reason) {
  return { status: 'unavailable', reason };
}

function sortedConfigEntries(config) {
  return Object.fromEntries(
    Object.entries(config ?? {}).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

function scoreAnswer(
  item,
  response,
  mode,
  variant,
  durationMs,
  uploadedDocIdByDatasetId,
) {
  const answer = response.answer ?? '';
  const references = Array.isArray(response.references)
    ? response.references
    : [];
  const keywordHits = (item.expectedKeywords ?? []).filter((keyword) =>
    answer.includes(keyword),
  );
  const shouldRefuse = isRefusalQuery(item);
  const keywordPassed = shouldRefuse
    ? true
    : keywordHits.length >= item.minKeywordHits;
  const expectedDatasetDocIds = relatedDocumentIdsForQuery(item);
  const expectedDocIds = expectedDatasetDocIds.map((docId) => {
    const uploaded = uploadedDocIdByDatasetId.get(docId);
    return uploaded ?? docId;
  });
  const citationIndexes = [...answer.matchAll(/\[片段\s*(\d+)\]/g)].map(
    (match) => Number(match[1]),
  );
  const citationPassed =
    item.requireCitation === true
      ? references.length > 0 &&
        citationIndexes.length > 0 &&
        citationIndexes.every((index) => {
          const reference = index >= 1 ? references[index - 1] : null;
          return (
            reference != null &&
            (expectedDocIds.length === 0 ||
              expectedDocIds.includes(reference.docId))
          );
        })
      : true;
  const refusalPassed = shouldRefuse
    ? references.length === 0 &&
      clearlyRefuses(answer)
    : true;
  const expectedConflictVersions = [
    ...new Set(
      [...(item.expectedKeywords ?? []), item.query]
        .flatMap((text) => String(text).match(/\b(?:19|20)\d{2}\b/g) ?? []),
    ),
  ];
  const conflictCueWords = ['优先', '冲突', '历史', '替代', '生效'];
  const conflictPassed =
    item.expectConflictHandling === true
      ? expectedConflictVersions.length >= 2 &&
        expectedConflictVersions.every((version) => answer.includes(version)) &&
        conflictCueWords.some((cue) => answer.includes(cue))
      : true;

  const referenceDocIds = [
    ...new Set(references.map((reference) => reference.docId).filter(Boolean)),
  ];
  const rankedReferenceDocIds = [...new Set(referenceDocIds)];
  const retrievalApplicable = expectedDocIds.length > 0 && shouldRefuse === false;
  const firstRelevantRank = retrievalApplicable
    ? rankedReferenceDocIds.findIndex((docId) => expectedDocIds.includes(docId))
    : -1;
  const retrievalHit = retrievalApplicable ? firstRelevantRank >= 0 : null;
  const reciprocalRank =
    retrievalApplicable && firstRelevantRank >= 0
      ? Number((1 / (firstRelevantRank + 1)).toFixed(4))
      : retrievalApplicable
        ? 0
        : null;
  const ndcg = retrievalApplicable
    ? calculateDocumentNdcg(expectedDocIds, rankedReferenceDocIds)
    : null;
  const retrievalPassed = retrievalApplicable ? retrievalHit === true : true;

  return {
    id: item.id,
    split: item.split ?? 'unassigned',
    category: item.category,
    department: item.department,
    mode,
    variant,
    durationMs,
    synthetic: typeof dataset.synthetic === 'boolean' ? dataset.synthetic : null,
    keywordHits,
    keywordPassed,
    citationApplicable: item.requireCitation === true,
    refusalApplicable: shouldRefuse,
    conflictApplicable: item.expectConflictHandling === true,
    retrievalApplicable,
    citationPassed,
    refusalPassed,
    conflictPassed,
    retrievalPassed,
    expectedDatasetDocIds,
    expectedDocIds,
    referenceDocIds,
    retrievalHit,
    reciprocalRank,
    ndcg,
    referenceCount: references.length,
    retrievalSufficient: response.retrievalSufficient,
    passed:
      keywordPassed &&
      citationPassed &&
      refusalPassed &&
      conflictPassed &&
      retrievalPassed,
  };
}

function clearlyRefuses(answer) {
  return [
    '未找到',
    '未能找到',
    '不足以支撑',
    '资料不足',
    '无法确认',
    '无法确定',
    '无法回答',
    '未提及',
    '知识库中没有',
    '没有足够资料',
  ].some((phrase) => answer.includes(phrase));
}

function calculateDocumentNdcg(expectedDocIds, rankedReferenceDocIds) {
  const cutoff = Math.max(expectedDocIds.length, rankedReferenceDocIds.length);
  const relevant = new Set(expectedDocIds);
  const dcg = rankedReferenceDocIds
    .slice(0, cutoff)
    .reduce(
      (score, docId, index) =>
        score + (relevant.has(docId) ? 1 / Math.log2(index + 2) : 0),
      0,
    );
  const idealRelevantCount = Math.min(expectedDocIds.length, cutoff);
  const idcg = Array.from({ length: idealRelevantCount }, (_, index) =>
    1 / Math.log2(index + 2),
  ).reduce((sum, score) => sum + score, 0);
  return idcg === 0 ? 0 : Number((dcg / idcg).toFixed(4));
}

function isRefusalQuery(item) {
  return item.expectRefusal === true || item.minKeywordHits === 0;
}

function toLiveJudgeCase(item, response, mode, variant) {
  const references = Array.isArray(response.references)
    ? response.references
    : [];
  const evidence = references
    .filter((reference) => typeof reference.content === 'string' && reference.content.trim())
    .map(
      (reference) =>
        `[docId=${reference.docId ?? 'unknown'}, chunk=${reference.chunkIndex ?? 'unknown'}]\n${reference.content}`,
    )
    .join('\n\n---\n\n');
  const claims = Array.isArray(item.expectedClaims) && item.expectedClaims.length > 0
    ? item.expectedClaims
    : item.referenceAnswer
      ? [{ text: item.referenceAnswer.replace(/\[片段\s*\d+\]/g, '').trim() }]
      : (item.expectedKeywords ?? []).map((text) => ({ text }));
  return {
    id: `${mode}:${variant}:${item.id}`,
    sourceId: item.id,
    split: item.split ?? 'unassigned',
    mode,
    variant,
    answer: response.answer ?? '',
    evidence,
    claims,
  };
}

async function assertServiceReady() {
  const response = await fetch(`${baseUrl}/api/v1/health`, {
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok)
    throw new Error(`service health failed: ${response.status}`);
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

async function uploadDocument(token, doc, projectId) {
  const form = new FormData();
  form.append(
    'file',
    new Blob([doc.content], { type: 'text/plain' }),
    `${doc.id}.txt`,
  );
  form.append('projectId', projectId);
  const response = await fetch(`${baseUrl}/api/v1/documents/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`upload failed: ${response.status}`);
  return unwrap(body).docId;
}

async function ask(token, query, mode, knowledgeBaseKey, projectId) {
  const response = await fetch(`${baseUrl}/api/v1/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      mode,
      useLongTermMemory: false,
      scope: { projectId },
      ...(knowledgeBaseKey ? { knowledgeBaseKey } : {}),
    }),
    signal: AbortSignal.timeout(chatTimeoutMs),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`chat failed: ${response.status}`);
  const data = unwrap(body);
  return {
    answer: data.answer ?? '',
    references: Array.isArray(data.references) ? data.references : [],
    retrievalSufficient: data.retrievalSufficient,
    runId: typeof data.runId === 'string' ? data.runId : null,
  };
}

async function askWithRetry(
  token,
  query,
  mode,
  knowledgeBaseKey,
  projectId,
) {
  let lastError = null;
  for (let attempt = 0; attempt <= chatRetries; attempt += 1) {
    try {
      return await ask(token, query, mode, knowledgeBaseKey, projectId);
    } catch (error) {
      lastError = error;
      if (attempt < chatRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1_500 * (attempt + 1)));
      }
    }
  }
  throw lastError ?? new Error('chat failed without error detail');
}

function scoreQueryError(
  item,
  mode,
  variant,
  durationMs,
  queryError,
  uploadedDocIdByDatasetId,
) {
  const expectedDatasetDocIds = relatedDocumentIdsForQuery(item);
  const expectedDocIds = expectedDatasetDocIds.map(
    (docId) => uploadedDocIdByDatasetId.get(docId) ?? docId,
  );
  const shouldRefuse = item.expectRefusal === true || item.minKeywordHits === 0;
  const retrievalApplicable = expectedDocIds.length > 0 && shouldRefuse === false;
  return {
    id: item.id,
    split: item.split ?? 'unassigned',
    category: item.category,
    department: item.department,
    mode,
    variant,
    durationMs,
    keywordHits: [],
    keywordPassed: false,
    citationApplicable: item.requireCitation === true,
    refusalApplicable: shouldRefuse,
    conflictApplicable: item.expectConflictHandling === true,
    retrievalApplicable,
    citationPassed: false,
    refusalPassed: shouldRefuse,
    conflictPassed: false,
    retrievalPassed: false,
    expectedDatasetDocIds,
    expectedDocIds,
    referenceDocIds: [],
    retrievalHit: retrievalApplicable ? false : null,
    reciprocalRank: retrievalApplicable ? 0 : null,
    ndcg: retrievalApplicable ? 0 : null,
    referenceCount: 0,
    retrievalSufficient: false,
    queryError,
    passed: false,
  };
}

async function cleanup() {
  if (uploadedDocIds.length === 0) return;
  if (!cleanupToken) {
    process.exitCode = 1;
    console.error(
      `Evaluation cleanup failed: ${uploadedDocIds.length} uploaded document(s) have no reusable auth token.`,
    );
    return;
  }

  const failures = [];
  for (const docId of uploadedDocIds) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/documents/${docId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${cleanupToken}` },
      });
      if (!response.ok) {
        failures.push(`${docId}: DELETE returned HTTP ${response.status}`);
      }
    } catch (error) {
      failures.push(
        `${docId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (failures.length > 0) {
    process.exitCode = 1;
    console.error(
      `Evaluation cleanup failed for ${failures.length} document(s): ${failures.join('; ')}`,
    );
  }
}

function summarize(results) {
  const byMode = {};
  const byVariant = {};
  const byModeAndVariant = {};
  const byCategory = {};
  for (const result of results) {
    addBucket(byMode, result.mode, result.passed);
    addBucket(byVariant, result.variant ?? 'default', result.passed);
    addBucket(
      byModeAndVariant,
      `${result.mode}:${result.variant ?? 'default'}`,
      result.passed,
    );
    addBucket(byCategory, result.category ?? 'uncategorized', result.passed);
  }
  return { byMode, byVariant, byModeAndVariant, byCategory };
}

function summarizeBySplit(results) {
  const splits = [...new Set(results.map((item) => item.split ?? 'unassigned'))];
  return Object.fromEntries(
    splits.map((split) => [
      split,
      summarize(results.filter((item) => (item.split ?? 'unassigned') === split)),
    ]),
  );
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

function summarizeMetrics(results) {
  const byVariant = Object.fromEntries(
    [...new Set(results.map((item) => item.variant ?? 'default'))].map(
      (variant) => [
        variant,
        summarizeMetricGroup(
          results.filter((item) => (item.variant ?? 'default') === variant),
        ),
      ],
    ),
  );
  return {
    ...summarizeMetricGroup(results),
    byVariant,
  };
}

function summarizeMetricGroup(results) {
  const latencies = results.map((item) => item.durationMs).sort((a, b) => a - b);
  const percentile = (ratio) => {
    if (latencies.length === 0) return 0;
    const index = Math.min(
      latencies.length - 1,
      Math.max(0, Math.ceil(latencies.length * ratio) - 1),
    );
    return latencies[index];
  };
  const ratio = (items, predicate) =>
    items.length === 0
      ? null
      : Number(
          (
            items.filter(predicate).length / items.length
          ).toFixed(4),
        );
  const citationItems = results.filter((item) => item.citationApplicable);
  const refusalItems = results.filter((item) => item.refusalApplicable);
  const conflictItems = results.filter((item) => item.conflictApplicable);
  const retrievalItems = results.filter((item) => item.retrievalApplicable);
  return {
    passRate: ratio(results, (item) => item.passed),
    keywordAccuracy: ratio(results, (item) => item.keywordPassed),
    citationRate: ratio(citationItems, (item) => item.citationPassed),
    refusalAccuracy: ratio(refusalItems, (item) => item.refusalPassed),
    conflictAccuracy: ratio(conflictItems, (item) => item.conflictPassed),
    retrievalHitRate: ratio(
      retrievalItems,
      (item) => item.retrievalHit === true,
    ),
    retrievalMrr: retrievalItems.length
      ? Number(
          (
            retrievalItems.reduce(
              (sum, item) => sum + (item.reciprocalRank ?? 0),
              0,
            ) / retrievalItems.length
          ).toFixed(4),
        )
      : null,
    retrievalNdcg: retrievalItems.length
      ? Number(
          (
            retrievalItems.reduce((sum, item) => sum + (item.ndcg ?? 0), 0) /
            retrievalItems.length
          ).toFixed(4),
        )
      : null,
    retrievalCaseCount: retrievalItems.length,
    queryErrorCount: results.filter((item) => item.queryError != null).length,
    avgLatencyMs: Math.round(
      latencies.reduce((sum, value) => sum + value, 0) /
        Math.max(1, latencies.length),
    ),
    p95LatencyMs: percentile(0.95),
  };
}

function summarizeEstimatedUsage(results, evalVariants, evalModes) {
  const variantsSummary = Object.fromEntries(
    evalVariants.map((variant) => [
      variant.name,
      summarizeUsageGroup(
        results.filter((item) => item.variant === variant.name),
      ),
    ]),
  );
  const byModeAndVariant = Object.fromEntries(
    evalModes.flatMap((mode) =>
      evalVariants.map((variant) => [
        `${mode}:${variant.name}`,
        summarizeUsageGroup(
          results.filter(
            (item) => item.mode === mode && item.variant === variant.name,
          ),
        ),
      ]),
    ),
  );
  const pairedComparison =
    evalVariants.length < 2
      ? null
      : Object.fromEntries(
          evalModes.map((mode) => {
            const [profileA, profileB] = evalVariants;
            const byId = (variantName) =>
              new Map(
                results
                  .filter(
                    (item) =>
                      item.mode === mode && item.variant === variantName,
                  )
                  .map((item) => [item.id, item]),
              );
            const left = byId(profileA.name);
            const right = byId(profileB.name);
            const pairs = [...left.entries()]
              .filter(([id]) => right.has(id))
              .map(([id, a]) => ({ a, b: right.get(id) }))
              .filter(
                ({ a, b }) =>
                  a.estimatedUsage?.status === 'available' &&
                  b.estimatedUsage?.status === 'available',
              );
            const totalA = pairs.reduce(
              (sum, pair) => sum + pair.a.estimatedUsage.costUsdEstimated,
              0,
            );
            const totalB = pairs.reduce(
              (sum, pair) => sum + pair.b.estimatedUsage.costUsdEstimated,
              0,
            );
            return [
              mode,
              {
                profileA: profileA.name,
                profileB: profileB.name,
                pairedUsageCount: pairs.length,
                estimatedCostAUsd:
                  pairs.length > 0 ? roundCost(totalA) : null,
                estimatedCostBUsd:
                  pairs.length > 0 ? roundCost(totalB) : null,
                estimatedCostDeltaUsdBMinusA:
                  pairs.length > 0 ? roundCost(totalB - totalA) : null,
                meanEstimatedCostDeltaUsdBMinusA:
                  pairs.length > 0
                    ? roundCost((totalB - totalA) / pairs.length)
                    : null,
              },
            ];
          }),
        );
  return {
    total: summarizeUsageGroup(results),
    byVariant: variantsSummary,
    byModeAndVariant,
    pairedComparison,
  };
}

function summarizeUsageGroup(results) {
  const available = results.filter(
    (item) => item.estimatedUsage?.status === 'available',
  );
  const sourceCounts = {};
  for (const item of available) {
    const source = item.estimatedUsage.source ?? 'unspecified';
    sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
  }
  return {
    resultCount: results.length,
    availableCount: available.length,
    unavailableCount: results.length - available.length,
    inputTokens: available.reduce(
      (sum, item) => sum + item.estimatedUsage.inputTokens,
      0,
    ),
    outputTokens: available.reduce(
      (sum, item) => sum + item.estimatedUsage.outputTokens,
      0,
    ),
    estimatedCostUsd: roundCost(
      available.reduce(
        (sum, item) => sum + item.estimatedUsage.costUsdEstimated,
        0,
      ),
    ),
    usageSourceCounts: sourceCounts,
  };
}

function roundCost(value) {
  return Number(value.toFixed(8));
}

function compareVariants(results, evalVariants, evalModes) {
  if (evalVariants.length < 2) return null;
  const [left, right] = evalVariants;
  return Object.fromEntries(
    evalModes.map((mode) => {
      const leftById = new Map(
        results
          .filter((item) => item.mode === mode && item.variant === left.name)
          .map((item) => [item.id, item]),
      );
      const rightById = new Map(
        results
          .filter((item) => item.mode === mode && item.variant === right.name)
          .map((item) => [item.id, item]),
      );
      const pairs = [...leftById.entries()]
        .filter(([id]) => rightById.has(id))
        .map(([id, leftResult]) => ({
          id,
          left: leftResult,
          right: rightById.get(id),
        }));
      const delta = (select, predicate = () => true) => {
        const applicable = pairs.filter(
          ({ left: leftItem, right: rightItem }) =>
            predicate(leftItem, rightItem),
        );
        if (applicable.length === 0) return null;
        const averageDelta =
          applicable.reduce(
            (sum, pair) => sum + (select(pair.right) - select(pair.left)),
            0,
          ) / applicable.length;
        return Number(averageDelta.toFixed(8));
      };
      const meanLatency = (select) =>
        pairs.length > 0
          ? Number(
              (
                pairs.reduce((sum, pair) => sum + select(pair), 0) /
                pairs.length
              ).toFixed(2),
            )
          : null;
      return [
        mode,
        {
          profileA: left.name,
          profileB: right.name,
          pairedQueryCount: pairs.length,
          meanLatencyMsA: meanLatency((pair) => pair.left.durationMs),
          meanLatencyMsB: meanLatency((pair) => pair.right.durationMs),
          passRateDeltaBMinusA: delta((item) => Number(item.passed)),
          retrievalHitRateDeltaBMinusA: delta(
            (item) => Number(item.retrievalHit === true),
            (a, b) => a.retrievalApplicable && b.retrievalApplicable,
          ),
          retrievalMrrDeltaBMinusA: delta(
            (item) => item.reciprocalRank ?? 0,
            (a, b) => a.retrievalApplicable && b.retrievalApplicable,
          ),
          retrievalNdcgDeltaBMinusA: delta(
            (item) => item.ndcg ?? 0,
            (a, b) => a.retrievalApplicable && b.retrievalApplicable,
          ),
          citationRateDeltaBMinusA: delta(
            (item) => Number(item.citationPassed),
            (a, b) => a.citationApplicable && b.citationApplicable,
          ),
          meanLatencyDeltaMsBMinusA: delta(
            (item) => item.durationMs,
          ),
        },
      ];
    }),
  );
}

async function writeReport(report, filename) {
  const directory = process.env.EVAL_REPORT_DIR ?? '.tmp/evidence';
  await mkdir(directory, { recursive: true });
  await writeFile(
    `${directory}/${filename}`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
}
