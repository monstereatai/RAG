import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateProjectEvalDataset } from './lib/project-eval-dataset.mjs';

const judgeRequired = process.env.EVAL_RAG_JUDGE_REQUIRED === 'true';
const releaseGate = process.env.EVAL_RAG_RELEASE_GATE === 'true';
const liveJudgeMarker = 'RAG_LIVE_JUDGE_INPUT=';
const requiredReleaseModes = ['simple', 'auto', 'agentic'];
let releaseDatasetStats = null;

if (releaseGate) {
  if (!judgeRequired) {
    failReleaseGate('Release gate requires EVAL_RAG_JUDGE_REQUIRED=true.');
  }
  if (
    !Number.isFinite(Number(process.env.PROJECT_EVAL_MIN_SCORE ?? '0.9')) ||
    Number(process.env.PROJECT_EVAL_MIN_SCORE ?? '0.9') < 0.9
  ) {
    failReleaseGate('Release gate requires PROJECT_EVAL_MIN_SCORE >= 0.9.');
  }
  if (
    !Number.isFinite(
      Number(process.env.EVAL_RAG_JUDGE_MIN_SUPPORTED_RATE ?? '0.9'),
    ) ||
    Number(process.env.EVAL_RAG_JUDGE_MIN_SUPPORTED_RATE ?? '0.9') < 0.9
  ) {
    failReleaseGate(
      'Release gate requires EVAL_RAG_JUDGE_MIN_SUPPORTED_RATE >= 0.9.',
    );
  }
  if (Number(process.env.EVAL_RAG_JUDGE_MAX_CLAIMS ?? '0') !== 0) {
    failReleaseGate(
      'Release gate requires judging every live claim; EVAL_RAG_JUDGE_MAX_CLAIMS must be 0.',
    );
  }
  const minimumCostCoverage = Number(
    process.env.EVAL_RAG_MIN_COST_COVERAGE ?? '0.9',
  );
  if (
    !Number.isFinite(minimumCostCoverage) ||
    minimumCostCoverage < 0.9 ||
    minimumCostCoverage > 1
  ) {
    failReleaseGate(
      'Release gate requires EVAL_RAG_MIN_COST_COVERAGE between 0.9 and 1.',
    );
  }
  if (process.env.PROJECT_EVAL_PROFILE_A || process.env.PROJECT_EVAL_PROFILE_B) {
    const maxRetrievalRegression = Number(
      process.env.EVAL_RAG_MAX_RETRIEVAL_REGRESSION ?? '0',
    );
    if (
      !Number.isFinite(maxRetrievalRegression) ||
      maxRetrievalRegression < 0 ||
      maxRetrievalRegression > 1
    ) {
      failReleaseGate(
        'EVAL_RAG_MAX_RETRIEVAL_REGRESSION must be between 0 and 1.',
      );
    }
  }
  if (process.env.PROJECT_EVAL_PROFILE_A || process.env.PROJECT_EVAL_PROFILE_B) {
    if (
      !process.env.PROJECT_EVAL_PROFILE_A?.trim() ||
      !process.env.PROJECT_EVAL_PROFILE_B?.trim()
    ) {
      failReleaseGate(
        'A/B release evaluation requires both PROJECT_EVAL_PROFILE_A and PROJECT_EVAL_PROFILE_B.',
      );
    }
  }
  releaseDatasetStats = await requireReviewedBusinessDataset();
}

run('node', ['scripts/eval-rag.mjs'], { inherit: true });
run('node', ['scripts/build-business-regression-dataset.mjs', '--check'], {
  inherit: true,
});
let liveJudgeInput;
if (judgeRequired) {
  const projectEval = run('node', ['scripts/eval-rag-project.mjs'], {
    inherit: false,
    env: { PROJECT_EVAL_JUDGE_STDOUT: 'true' },
    maxBuffer: 20 * 1024 * 1024,
  });
  const extracted = extractLiveJudgeInput(projectEval.stdout);
  if (releaseGate) {
    validateReleaseReport(extracted.report, releaseDatasetStats);
  }
  process.stdout.write(extracted.reportOutput);
  liveJudgeInput = extracted.input;
} else {
  run('node', ['scripts/eval-rag-project.mjs'], { inherit: true });
}
run('node', ['scripts/eval-rag-maturity.mjs'], { inherit: true });
run('node', ['scripts/eval-agent-task-metrics.mjs'], { inherit: true });
run('node', ['scripts/eval-production-workflow.mjs'], { inherit: true });

if (judgeRequired) {
  requireLiveJudgeInput(liveJudgeInput);
  const judge = run('node', ['scripts/eval-rag-judge.mjs'], {
    inherit: false,
    env: { EVAL_RAG_JUDGE_STDIN: 'true' },
    input: JSON.stringify(liveJudgeInput),
    maxBuffer: 20 * 1024 * 1024,
  });
  process.stdout.write(judge.stdout);
  process.stderr.write(judge.stderr);

  const parsed = parseJson(judge.stdout);
  if (!parsed || parsed.skipped || parsed.ok !== true) {
    console.error(
      'LLM-as-Judge gate failed. Set QWEN_API_KEY and ensure supportedRate meets EVAL_RAG_JUDGE_MIN_SUPPORTED_RATE.',
    );
    process.exit(1);
  }
} else {
  console.log(
    JSON.stringify(
      {
        ok: true,
        judgeRequired: false,
        judgeSkipped: true,
        reason: 'Set EVAL_RAG_JUDGE_REQUIRED=true to enforce LLM-as-Judge.',
      },
      null,
      2,
    ),
  );
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    input: options.input,
    maxBuffer: options.maxBuffer,
  });
  if (result.status !== 0) {
    if (!options.inherit) {
      const safeOutput = (result.stdout ?? '')
        .split(/\r?\n/)
        .filter((line) => !line.startsWith(liveJudgeMarker))
        .join('\n');
      process.stdout.write(safeOutput);
      process.stderr.write(result.stderr ?? '');
    }
    process.exit(result.status ?? 1);
  }
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function requireReviewedBusinessDataset() {
  const configuredPath = process.env.PROJECT_EVAL_DATASET;
  if (!configuredPath) {
    failReleaseGate(
      'PROJECT_EVAL_DATASET must point to a reviewed real-business evaluation dataset; the default dataset is synthetic.',
    );
  }

  const datasetPath = resolve(process.cwd(), configuredPath);
  let dataset;
  try {
    dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
  } catch {
    failReleaseGate(`Cannot read PROJECT_EVAL_DATASET: ${datasetPath}`);
  }

  const provenance = dataset?.provenance;
  const datasetErrors = validateProjectEvalDataset(dataset, {
    minQueries: 100,
    requireExpectedClaims: true,
    requireSplits: true,
  });
  if (datasetErrors.length > 0) {
    failReleaseGate(
      `Release dataset is invalid: ${datasetErrors.join('; ')}`,
    );
  }

  const validDeclaration =
    dataset.synthetic === false &&
    provenance?.kind === 'sanitized_real_business' &&
    provenance?.reviewed === true &&
    typeof provenance?.sourceDescription === 'string' &&
    provenance.sourceDescription.trim().length > 0 &&
    Array.isArray(dataset.documents) &&
    dataset.documents.length >= 5 &&
    Array.isArray(dataset.queries) &&
    dataset.queries.length >= 100;

  if (!validDeclaration) {
    failReleaseGate(
      'Release evaluation requires synthetic:false, provenance.kind="sanitized_real_business", provenance.reviewed:true, a sourceDescription, at least 5 documents, and at least 100 uniquely identified queries including negative and conflict cases. Every answerable query needs expected claims and valid related document IDs. Synthetic or unprovenanced fixtures cannot count as real-business validation.',
    );
  }

  const answerableQueries = dataset.queries.filter(
    (query) => query.expectRefusal !== true && query.minKeywordHits !== 0,
  );
  const splitCounts = Object.fromEntries(
    ['development', 'holdout'].map((split) => [
      split,
      dataset.queries.filter((query) => query.split === split).length,
    ]),
  );
  const answerableCountsBySplit = Object.fromEntries(
    ['development', 'holdout'].map((split) => [
      split,
      answerableQueries.filter((query) => query.split === split).length,
    ]),
  );
  const minimumAnswerableCount = Math.max(
    20,
    Math.ceil(dataset.queries.length * 0.2),
  );
  if (answerableQueries.length < minimumAnswerableCount) {
    failReleaseGate(
      `Release dataset requires at least ${minimumAnswerableCount} answerable queries (20% of the dataset, with a floor of 20); found ${answerableQueries.length}.`,
    );
  }
  const queriesWithoutRequiredCitations = answerableQueries
    .filter((query) => query.requireCitation !== true)
    .map((query) => query.id);
  if (queriesWithoutRequiredCitations.length > 0) {
    failReleaseGate(
      `Every answerable release query must set requireCitation:true. Invalid query IDs: ${queriesWithoutRequiredCitations.slice(0, 10).join(', ')}${queriesWithoutRequiredCitations.length > 10 ? ', ...' : ''}.`,
    );
  }

  const configuredModes = (
    process.env.PROJECT_EVAL_MODES ??
    (Array.isArray(dataset.defaultModes)
      ? dataset.defaultModes.join(',')
      : requiredReleaseModes.join(','))
  )
    .split(',')
    .map((mode) => mode.trim())
    .filter(Boolean);
  const missingModes = requiredReleaseModes.filter(
    (mode) => !configuredModes.includes(mode),
  );
  if (missingModes.length > 0) {
    failReleaseGate(
      `Release evaluation must include all chat modes: ${requiredReleaseModes.join(', ')}. Missing: ${missingModes.join(', ')}.`,
    );
  }

  console.log(
    JSON.stringify({
      releaseProvenanceDeclarationAccepted: true,
      dataset: configuredPath,
      provenanceKind: provenance.kind,
      reviewed: provenance.reviewed,
      queryCount: dataset.queries.length,
      answerableQueryCount: answerableQueries.length,
      splitCounts,
      answerableCountsBySplit,
      note: 'The gate checks the declared provenance fields; it cannot independently verify the source data.',
    }),
  );
  return {
    queryCount: dataset.queries.length,
    answerableQueryCount: answerableQueries.length,
    splitCounts,
    answerableCountsBySplit,
  };
}

function extractLiveJudgeInput(output) {
  const lines = output.split(/\r?\n/);
  const markerIndex = lines.findIndex((line) =>
    line.startsWith(liveJudgeMarker),
  );
  if (markerIndex < 0) {
    failReleaseGate('Live project evaluation did not return Judge input.');
  }
  const input = parseJson(lines[markerIndex].slice(liveJudgeMarker.length));
  if (!input) failReleaseGate('Live project evaluation returned invalid Judge input.');
  const reportOutput = lines
    .filter((_, index) => index !== markerIndex)
    .join('\n')
    .trimEnd();
  const report = parseJson(reportOutput);
  if (!report || typeof report !== 'object') {
    failReleaseGate('Live project evaluation returned an invalid report.');
  }
  return {
    input,
    report,
    reportOutput: reportOutput ? `${reportOutput}\n` : '',
  };
}

function validateReleaseReport(report, datasetStats) {
  const { queryCount: expectedQueryCount, answerableQueryCount } = datasetStats;
  const configuredModes = (
    process.env.PROJECT_EVAL_MODES ?? requiredReleaseModes.join(',')
  )
    .split(',')
    .map((mode) => mode.trim())
    .filter(Boolean);
  const missingModes = requiredReleaseModes.filter(
    (mode) => !configuredModes.includes(mode) || !report.modes?.includes(mode),
  );
  if (missingModes.length > 0) {
    failReleaseGate(
      `Live evaluation report is missing required chat modes: ${missingModes.join(', ')}.`,
    );
  }

  const expectedVariants =
    process.env.PROJECT_EVAL_PROFILE_A && process.env.PROJECT_EVAL_PROFILE_B
      ? ['A', 'B']
      : ['default'];
  const minScore = Number(process.env.PROJECT_EVAL_MIN_SCORE ?? '0.9');
  const resultQualityFailures = [];
  for (const mode of requiredReleaseModes) {
    for (const variant of expectedVariants) {
      const key = `${mode}:${variant}`;
      const group = report.summary?.byModeAndVariant?.[key];
      const passRate =
        Number.isInteger(group?.passed) && Number.isInteger(group?.total) && group.total > 0
          ? group.passed / group.total
          : 0;
      if (group?.total !== expectedQueryCount || passRate < minScore) {
        resultQualityFailures.push(
          `${key}: overall pass rate ${Math.round(passRate * 100)}% (expected ${Math.round(minScore * 100)}%, ${group?.passed ?? 0}/${group?.total ?? 0})`,
        );
      }

      const answerableResults = (report.results ?? []).filter(
        (result) =>
          result.mode === mode &&
          result.variant === variant &&
          result.retrievalApplicable === true,
      );
      const answerablePassRate = answerableResults.length
        ? answerableResults.filter((result) => result.passed === true).length /
          answerableResults.length
        : 0;
      if (
        answerableResults.length !== answerableQueryCount ||
        answerablePassRate < minScore
      ) {
        resultQualityFailures.push(
          `${key}: answerable pass rate ${Math.round(answerablePassRate * 100)}% (expected ${Math.round(minScore * 100)}%, ${answerableResults.filter((result) => result.passed === true).length}/${answerableResults.length}; dataset has ${answerableQueryCount})`,
        );
      }

      const splitPassRates = {};
      for (const split of ['development', 'holdout']) {
        const expectedSplitCount = datasetStats.splitCounts?.[split] ?? 0;
        const splitGroup =
          report.summaryBySplit?.[split]?.byModeAndVariant?.[key];
        const splitPassRate =
          Number.isInteger(splitGroup?.passed) &&
          Number.isInteger(splitGroup?.total) &&
          splitGroup.total > 0
            ? splitGroup.passed / splitGroup.total
            : 0;
        splitPassRates[split] = splitPassRate;
        if (
          splitGroup?.total !== expectedSplitCount ||
          splitPassRate < minScore
        ) {
          resultQualityFailures.push(
            `${key}:${split} pass rate ${Math.round(splitPassRate * 100)}% (expected ${Math.round(minScore * 100)}%, ${splitGroup?.passed ?? 0}/${splitGroup?.total ?? 0}; dataset has ${expectedSplitCount})`,
          );
        }

        const splitAnswerableExpected =
          datasetStats.answerableCountsBySplit?.[split] ?? 0;
        const splitAnswerableResults = (report.results ?? []).filter(
          (result) =>
            result.mode === mode &&
            result.variant === variant &&
            result.split === split &&
            result.retrievalApplicable === true,
        );
        const splitAnswerablePassRate = splitAnswerableResults.length
          ? splitAnswerableResults.filter((result) => result.passed === true)
              .length / splitAnswerableResults.length
          : 0;
        if (
          splitAnswerableResults.length !== splitAnswerableExpected ||
          splitAnswerablePassRate < minScore
        ) {
          resultQualityFailures.push(
            `${key}:${split} answerable pass rate ${Math.round(splitAnswerablePassRate * 100)}% (${splitAnswerableResults.filter((result) => result.passed === true).length}/${splitAnswerableResults.length}; dataset has ${splitAnswerableExpected})`,
          );
        }
      }

      const maxDevHoldoutGap = Number(
        process.env.EVAL_RAG_MAX_DEV_HOLDOUT_GAP ?? '0.1',
      );
      if (
        !Number.isFinite(maxDevHoldoutGap) ||
        maxDevHoldoutGap < 0 ||
        maxDevHoldoutGap > 1
      ) {
        failReleaseGate(
          'EVAL_RAG_MAX_DEV_HOLDOUT_GAP must be between 0 and 1.',
        );
      }
      if (
        Math.abs(
          splitPassRates.development - splitPassRates.holdout,
        ) > maxDevHoldoutGap
      ) {
        resultQualityFailures.push(
          `${key}: development/holdout pass-rate gap ${Math.round(Math.abs(splitPassRates.development - splitPassRates.holdout) * 100)}% exceeds ${Math.round(maxDevHoldoutGap * 100)}%`,
        );
      }
    }
  }
  if (resultQualityFailures.length > 0) {
    failReleaseGate(
      `Release quality must pass per mode/profile and on answerable queries without dilution by refusal cases: ${resultQualityFailures.join('; ')}.`,
    );
  }

  const minCostCoverage = Number(
    process.env.EVAL_RAG_MIN_COST_COVERAGE ?? '0.9',
  );
  const costGroups = report.costMetrics?.byModeAndVariant;
  const missingCostGroups = [];
  for (const mode of requiredReleaseModes) {
    for (const variant of expectedVariants) {
      const key = `${mode}:${variant}`;
      const group = costGroups?.[key];
      const summaryTotal =
        report.summary?.byModeAndVariant?.[key]?.total;
      const coverage =
        Number.isInteger(group?.resultCount) &&
        group.resultCount === expectedQueryCount &&
        summaryTotal === expectedQueryCount &&
        Number.isInteger(group?.availableCount) &&
        group.availableCount >= 0 &&
        group.availableCount <= group.resultCount
          ? group.availableCount / group.resultCount
          : 0;
      if (coverage < minCostCoverage) {
        missingCostGroups.push(
          `${key}=${Math.round(coverage * 100)}%`,
        );
      }
    }
  }
  if (missingCostGroups.length > 0) {
    failReleaseGate(
      `Estimated cost coverage must be at least ${Math.round(minCostCoverage * 100)}% for every release mode/profile. Missing or incomplete run-center cost events: ${missingCostGroups.join(', ')}. Configure PROJECT_EVAL_SERVICE_TOKEN or RAG_SERVICE_TOKEN and verify run-center cost instrumentation.`,
    );
  }

  if (expectedVariants.length === 2) {
    const maxRegression = Number(
      process.env.EVAL_RAG_MAX_RETRIEVAL_REGRESSION ?? '0',
    );
    const maxCostRegressionRaw =
      process.env.EVAL_RAG_MAX_COST_REGRESSION?.trim();
    const maxLatencyRegressionRaw =
      process.env.EVAL_RAG_MAX_LATENCY_REGRESSION?.trim();
    const maxCostRegression = Number(maxCostRegressionRaw);
    const maxLatencyRegression = Number(maxLatencyRegressionRaw);
    if (
      !maxCostRegressionRaw ||
      !Number.isFinite(maxCostRegression) ||
      maxCostRegression < 0 ||
      maxCostRegression > 1
    ) {
      failReleaseGate(
        'A/B release evaluation requires EVAL_RAG_MAX_COST_REGRESSION between 0 and 1 (fractional increase allowed).',
      );
    }
    if (
      !maxLatencyRegressionRaw ||
      !Number.isFinite(maxLatencyRegression) ||
      maxLatencyRegression < 0 ||
      maxLatencyRegression > 1
    ) {
      failReleaseGate(
        'A/B release evaluation requires EVAL_RAG_MAX_LATENCY_REGRESSION between 0 and 1 (fractional increase allowed).',
      );
    }
    const paired = report.pairedComparison;
    const failures = [];
    for (const mode of requiredReleaseModes) {
      const comparison = paired?.[mode];
      const baselineTotal = report.summary?.byModeAndVariant?.[`${mode}:A`]?.total;
      const candidateTotal = report.summary?.byModeAndVariant?.[`${mode}:B`]?.total;
      if (
        !comparison ||
        baselineTotal !== expectedQueryCount ||
        candidateTotal !== expectedQueryCount ||
        comparison.pairedQueryCount !== expectedQueryCount
      ) {
        failures.push(`${mode}: incomplete paired query results`);
        continue;
      }
      for (const metric of [
        'retrievalHitRateDeltaBMinusA',
        'retrievalMrrDeltaBMinusA',
        'retrievalNdcgDeltaBMinusA',
      ]) {
        const delta = comparison[metric];
        if (!Number.isFinite(delta) || delta < -maxRegression) {
          failures.push(
            `${mode}.${metric}=${Number.isFinite(delta) ? delta : 'unavailable'}`,
          );
        }
      }

      const pairedCost = report.costMetrics?.pairedComparison?.[mode];
      const minimumPairedCostCount = Math.ceil(
        expectedQueryCount * minCostCoverage,
      );
      if (
        !Number.isInteger(pairedCost?.pairedUsageCount) ||
        pairedCost.pairedUsageCount < minimumPairedCostCount
      ) {
        failures.push(
          `${mode}: paired estimated-cost coverage ${pairedCost?.pairedUsageCount ?? 0}/${expectedQueryCount} is below ${minimumPairedCostCount}/${expectedQueryCount}`,
        );
      }
      const baselineCost = pairedCost?.estimatedCostAUsd;
      const candidateCost = pairedCost?.estimatedCostBUsd;
      const costIncrease =
        Number.isFinite(baselineCost) && Number.isFinite(candidateCost)
          ? baselineCost > 0
            ? (candidateCost - baselineCost) / baselineCost
            : candidateCost > 0
              ? Number.POSITIVE_INFINITY
              : 0
          : Number.NaN;
      if (!Number.isFinite(costIncrease) || costIncrease > maxCostRegression) {
        failures.push(
          `${mode}.estimatedCostIncrease=${Number.isFinite(costIncrease) ? costIncrease : 'unavailable'} (allowed ${maxCostRegression})`,
        );
      }

      const latencyA = comparison.meanLatencyMsA;
      const latencyB = comparison.meanLatencyMsB;
      const latencyIncrease =
        Number.isFinite(latencyA) && Number.isFinite(latencyB)
          ? latencyA > 0
            ? (latencyB - latencyA) / latencyA
            : latencyB > 0
              ? Number.POSITIVE_INFINITY
              : 0
          : Number.NaN;
      if (
        !Number.isFinite(latencyIncrease) ||
        latencyIncrease > maxLatencyRegression
      ) {
        failures.push(
          `${mode}.meanLatencyIncrease=${Number.isFinite(latencyIncrease) ? latencyIncrease : 'unavailable'} (allowed ${maxLatencyRegression})`,
        );
      }
    }
    if (failures.length > 0) {
      failReleaseGate(
        `Candidate profile exceeded a configured retrieval, estimated-cost, or latency tolerance, or has incomplete paired results: ${failures.join('; ')}.`,
      );
    }
  }
}

function requireLiveJudgeInput(dataset) {
  const cases = Array.isArray(dataset?.results) ? dataset.results : [];
  const validCases = cases.filter(
    (item) =>
      typeof item.answer === 'string' &&
      item.answer.trim() &&
      typeof item.evidence === 'string' &&
      item.evidence.trim() &&
      Array.isArray(item.claims) &&
      item.claims.length > 0,
  );
  if (
    validCases.length === 0 ||
    validCases.length !== cases.length ||
    !Number.isInteger(dataset?.expectedCaseCount) ||
    validCases.length !== dataset.expectedCaseCount
  ) {
    failReleaseGate(
      'Live RAG Judge input must contain every expected answerable case, with an actual answer, cited evidence, and expected claims.',
    );
  }
}

function failReleaseGate(reason) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        releaseGate: true,
        realBusinessValidation: false,
        reason,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
