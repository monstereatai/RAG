import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  assertDataset,
  buildEvalVariants,
  createProjectEvalHelpers,
} from './lib/eval-rag-project-helpers.mjs';

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

const helpers = createProjectEvalHelpers({
  baseUrl,
  dataset,
  minScore,
  requestedSplit,
  evalQueries,
  modes,
  variants,
  chatTimeoutMs,
  chatRetries,
  liveJudgeMarker,
  serviceToken,
  uploadedDocIds,
  uploadedDocIdByDatasetId,
  liveJudgeCases,
  evaluationProjectId,
  get cleanupToken() { return cleanupToken; },
});
const { assertProfilesAvailable, readEstimatedRunUsage, parseEventPayload, finiteNonNegativeNumber, unavailableUsage, sortedConfigEntries, scoreAnswer, clearlyRefuses, calculateDocumentNdcg, isRefusalQuery, toLiveJudgeCase, assertServiceReady, login, uploadDocument, ask, askWithRetry, scoreQueryError, cleanup, summarize, summarizeBySplit, addBucket, unwrap, summarizeMetrics, summarizeMetricGroup, summarizeEstimatedUsage, summarizeUsageGroup, roundCost, compareVariants, writeReport } = helpers;

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
