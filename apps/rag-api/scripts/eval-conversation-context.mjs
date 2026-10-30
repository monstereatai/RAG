import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const variants = [
  'full_history',
  'recent_history',
  'no_history',
  'persistent_history',
];
const datasetPath = process.env.CONVERSATION_EVAL_DATASET?.trim();
const apiBaseUrl = normalizeBaseUrl(
  process.env.CONVERSATION_EVAL_API_BASE_URL ??
    process.env.RAG_API_BASE_URL ??
    'http://localhost:3000/api/v1',
);
const sampleCount = Number(process.env.CONVERSATION_EVAL_SAMPLES ?? '3');
const mode = process.env.CONVERSATION_EVAL_MODE ?? 'auto';
const recentExchangeLimit = Number(
  process.env.CONVERSATION_EVAL_RECENT_EXCHANGES ?? '2',
);
const requestTimeoutMs = Number(
  process.env.CONVERSATION_EVAL_TIMEOUT_MS ?? '120000',
);
const compactionWaitMs = Number(
  process.env.CONVERSATION_EVAL_COMPACTION_WAIT_MS ?? '30000',
);
const maxRequests = Number(
  process.env.CONVERSATION_EVAL_MAX_REQUESTS ?? '300',
);
const outputPath =
  process.env.CONVERSATION_EVAL_OUTPUT ??
  '.tmp/evidence/conversation-context-eval.json';
const enforce = process.env.CONVERSATION_EVAL_ENFORCE === 'true';
const minCasePassRate = Number(
  process.env.CONVERSATION_EVAL_MIN_CASE_PASS_RATE ?? '0.9',
);

if (process.argv.includes('--help')) {
  printHelp();
  process.exit(0);
}
if (!datasetPath) {
  throw new Error('必须设置 CONVERSATION_EVAL_DATASET 指向已审阅的真实会话数据集。');
}
if (!['simple', 'agentic', 'auto'].includes(mode)) {
  throw new Error('CONVERSATION_EVAL_MODE 必须是 simple、agentic 或 auto。');
}
if (!Number.isInteger(sampleCount) || sampleCount < 2) {
  throw new Error('CONVERSATION_EVAL_SAMPLES 必须是至少 2 的整数，才能计算稳定性。');
}
if (!Number.isInteger(recentExchangeLimit) || recentExchangeLimit < 1) {
  throw new Error('CONVERSATION_EVAL_RECENT_EXCHANGES 必须是大于 0 的整数。');
}
if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
  throw new Error('CONVERSATION_EVAL_TIMEOUT_MS 必须是正数。');
}
if (!Number.isFinite(compactionWaitMs) || compactionWaitMs < 0) {
  throw new Error('CONVERSATION_EVAL_COMPACTION_WAIT_MS 必须是非负数。');
}
if (!Number.isInteger(maxRequests) || maxRequests < 1) {
  throw new Error('CONVERSATION_EVAL_MAX_REQUESTS 必须是大于 0 的整数。');
}
if (
  !Number.isFinite(minCasePassRate) ||
  minCasePassRate < 0 ||
  minCasePassRate > 1
) {
  throw new Error('CONVERSATION_EVAL_MIN_CASE_PASS_RATE 必须在 0 到 1 之间。');
}

const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
validateDataset(dataset);
const turnRequests = dataset.cases.reduce(
  (sum, item) => sum + item.turns.length * variants.length * sampleCount,
  0,
);
if (turnRequests > maxRequests) {
  throw new Error(
    `本次预计请求 ${turnRequests} 次，超过 CONVERSATION_EVAL_MAX_REQUESTS=${maxRequests}。请缩小数据集或显式调高上限。`,
  );
}

if (process.argv.includes('--validate-only')) {
  console.log(
    JSON.stringify(
      {
        valid: true,
        qualityMeasured: false,
        dataset: datasetPath,
        provenanceKind: dataset.provenance.kind,
        caseCount: dataset.cases.length,
        ablationEligibleCaseCount: dataset.cases.filter(
          (item) => item.turns.length >= recentExchangeLimit + 2,
        )
          .length,
        variants,
        samplesPerVariant: sampleCount,
        expectedChatRequests: turnRequests,
        reason: '仅验证真实数据集格式；未调用模型，未形成质量结论。',
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const token = await resolveAccessToken();
const results = [];
const cleanupFailures = [];
const stabilityAnswers = new Map();
let completedRequests = 0;

for (const item of dataset.cases) {
  for (const variant of variants) {
    for (let sample = 1; sample <= sampleCount; sample += 1) {
      const evaluation = await replaySample(item, variant, sample, token);
      results.push(evaluation.result);
      cleanupFailures.push(...evaluation.cleanupFailures);
      for (const answer of evaluation.answers) {
        const key = `${item.id}:${variant}:${answer.turnId}`;
        const answers = stabilityAnswers.get(key) ?? [];
        answers.push(answer.content);
        stabilityAnswers.set(key, answers);
      }
      completedRequests += evaluation.result.turns.filter(
        (turn) => turn.status === 'completed',
      ).length;
    }
  }
}

const summary = summarize(
  results,
  dataset.cases,
  variants,
  sampleCount,
  stabilityAnswers,
);
const compressionSummary = summarizeCompression(results);
const thresholdFailures = enforce
  ? summary.byVariant
      .filter((item) => item.casePassRate < minCasePassRate)
      .map((item) => item.variant)
  : [];
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  evidenceLevel: 'local_api_replay_real_conversations',
  qualityMeasured: true,
  synthetic: false,
  provenanceKind: dataset.provenance.kind,
  provenanceReviewed: dataset.provenance.reviewed,
  dataset: datasetPath,
  apiBaseUrl,
  mode,
  variants,
  samplesPerVariant: sampleCount,
  recentExchangeLimit,
  expectedRequests: turnRequests,
  completedRequests,
  cleanupFailures,
  metricSemantics: {
    turnPassRate:
      '逐轮按数据集的 expectedKeywords/minKeywordHits、requireCitation 和 expectRefusal 规则通过的比例；不是语义裁判分。',
    casePassRate:
      '同一采样中该会话所有轮次均通过的会话比例；不是生产准确率。',
    answerStability:
      '同一会话同一轮、同一上下文策略下，多次回答的字符 token 集 Jaccard 两两相似度均值；高相似不代表答案正确。',
    contextAblationDelta:
      '最近历史或无历史策略的会话通过率减去全历史策略通过率，单位为百分点；结果来自当前配置的已审阅真实样本。',
    contextSize:
      '全/近/无历史为评测器显式传入的消息数与字符数；persistent_history 由服务端读取会话历史，客户端输入为 0，不能当作模型实际上下文规模。',
    postCompactionTurns:
      '只有运行事件确认摘要压缩已完成后才发出的轮次；规则命中用于检查摘要是否保留了数据集要求的事实，不等于完整语义质量。',
  },
  thresholds: {
    enforced: enforce,
    minimumCasePassRate: enforce ? minCasePassRate : null,
    failures: thresholdFailures,
  },
  summary,
  compressionSummary,
  results,
};
await writeReport(outputPath, report);
console.log(JSON.stringify(report, null, 2));
if (cleanupFailures.length > 0 || thresholdFailures.length > 0) {
  process.exitCode = 1;
}

async function replaySample(item, variant, sample, accessToken) {
  const history = [];
  const threadIds = new Set();
  const turns = [];
  const answers = [];
  let persistentThreadId = null;
  let failedTurnId = null;
  try {
    for (const turn of item.turns) {
      failedTurnId = turn.id;
      const persistentHistory = variant === 'persistent_history';
      const selectedHistory = persistentHistory
        ? []
        : selectHistory(history, variant);
      let completedCompactionsBeforeTurn = null;
      let compactionEventsBeforeTurn = null;
      if (persistentHistory && item.expectCompaction === true && persistentThreadId) {
        const events = await readCompactionEvents(accessToken, persistentThreadId);
        compactionEventsBeforeTurn = events;
        completedCompactionsBeforeTurn = events.available ? events.completed : null;
      }
      let response;
      try {
        response = await ask(
          accessToken,
          item,
          turn,
          selectedHistory,
          persistentHistory ? persistentThreadId : null,
        );
      } catch (error) {
        turns.push({
          turnId: turn.id,
          status: 'failed',
          errorType: error instanceof Error ? error.name : 'Error',
          contextMessageCount: selectedHistory.length,
          contextCharacters: selectedHistory.reduce(
            (sum, message) => sum + message.content.length,
            0,
          ),
        });
        break;
      }
      if (response.threadId) threadIds.add(response.threadId);
      if (persistentHistory) {
        if (!persistentThreadId) persistentThreadId = response.threadId;
        if (!persistentThreadId || response.threadId !== persistentThreadId) {
          throw new Error('persistent_history did not keep one server conversation.');
        }
      }
      turns.push(
        scoreTurn(
          turn,
          response,
          selectedHistory,
          persistentHistory ? 'server_managed_history' : 'client_supplied_history',
          completedCompactionsBeforeTurn,
        ),
      );
      answers.push({ turnId: turn.id, content: response.answer });
      if (persistentHistory && item.expectCompaction === true && persistentThreadId) {
        await settleCompactionAfterTurn(
          accessToken,
          persistentThreadId,
          compactionEventsBeforeTurn?.started ?? 0,
        );
      }
      history.push(
        { role: 'human', content: turn.query },
        { role: 'ai', content: response.answer },
      );
    }
  } catch (error) {
    turns.push({
      turnId: failedTurnId,
      status: 'failed',
      errorType: error instanceof Error ? error.name : 'Error',
    });
  }
  const compaction =
    variant === 'persistent_history' &&
    item.expectCompaction === true &&
    persistentThreadId
      ? await waitForCompaction(accessToken, persistentThreadId)
      : null;
  const turnsCompleted =
    turns.length === item.turns.length &&
    turns.every((turn) => turn.status === 'completed');
  const compactionRequired =
    variant === 'persistent_history' && item.expectCompaction === true;
  const compactionSatisfied =
    !compactionRequired ||
    (compaction?.available === true && compaction.completed > 0);
  const cleanup = await cleanupConversations(accessToken, threadIds);
  return {
    result: {
      caseId: item.id,
      variant,
      sample,
      status: turnsCompleted && compactionSatisfied ? 'completed' : 'incomplete',
      passed:
        turnsCompleted &&
        turns.every((turn) => turn.passed) &&
        compactionSatisfied,
      turns,
      ...(compaction ? { compaction } : {}),
      cleanupFailures: cleanup,
    },
    cleanupFailures: cleanup,
    answers,
  };
}

async function ask(accessToken, item, turn, history, threadId = null) {
  const response = await fetch(`${apiBaseUrl}/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: turn.query,
      mode,
      history,
      ...(threadId ? { threadId } : {}),
      useLongTermMemory: false,
      ...(item.scope ? { scope: item.scope } : {}),
      ...(item.knowledgeBaseKey
        ? { knowledgeBaseKey: item.knowledgeBaseKey }
        : {}),
    }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`chat response was not JSON (${response.status})`);
  }
  if (!response.ok) throw new Error(`chat request failed (${response.status})`);
  const data = unwrap(body);
  return {
    answer: typeof data?.answer === 'string' ? data.answer : '',
    references: Array.isArray(data?.references) ? data.references : [],
    retrievalSufficient: data?.retrievalSufficient,
    threadId: typeof data?.threadId === 'string' ? data.threadId : null,
  };
}

function scoreTurn(
  turn,
  response,
  history,
  contextSource,
  completedCompactionsBeforeTurn = null,
) {
  const keywords = turn.expectedKeywords ?? [];
  const keywordHits = keywords.filter((keyword) =>
    response.answer.toLowerCase().includes(keyword.toLowerCase()),
  );
  const minimumHits =
    turn.minKeywordHits ?? (keywords.length ? Math.max(1, Math.ceil(keywords.length / 2)) : 0);
  const expectRefusal = turn.expectRefusal === true;
  const keywordPassed = expectRefusal || keywordHits.length >= minimumHits;
  const citationPassed =
    turn.requireCitation !== true || response.references.length > 0;
  const refusalPassed =
    !expectRefusal ||
    (response.references.length === 0 && response.retrievalSufficient === false);
  return {
    turnId: turn.id,
    status: 'completed',
    passed: keywordPassed && citationPassed && refusalPassed,
    keywordHitCount: keywordHits.length,
    expectedKeywordCount: keywords.length,
    keywordRecall: keywords.length ? keywordHits.length / keywords.length : null,
    citationRequired: turn.requireCitation === true,
    citationPassed,
    refusalPassed,
    referenceCount: response.references.length,
    retrievalSufficient: response.retrievalSufficient ?? null,
    contextSource,
    ...(completedCompactionsBeforeTurn === null
      ? {}
      : { completedCompactionsBeforeTurn }),
    contextMessageCount: history.length,
    contextCharacters: history.reduce(
      (sum, message) => sum + message.content.length,
      0,
    ),
  };
}

async function readCompactionEvents(accessToken, threadId) {
  const serviceToken = resolveServiceToken();
  if (!serviceToken) return { available: false, reason: 'service_token_missing' };
  try {
    const response = await fetch(
      `${apiBaseUrl}/rag/admin/agent-ops/runtime-events?threadId=${encodeURIComponent(threadId)}&limit=500`,
      {
        headers: { 'X-Service-Token': serviceToken },
        signal: AbortSignal.timeout(requestTimeoutMs),
      },
    );
    if (!response.ok) return { available: false, status: response.status };
    const payload = unwrap(await response.json());
    const events = Array.isArray(payload) ? payload : [];
    return {
      available: true,
      started: events.filter((event) => event.eventType === 'memory.compaction.started').length,
      completed: events.filter((event) => event.eventType === 'memory.compaction.completed').length,
      failed: events.filter((event) => event.eventType === 'memory.compaction.failed').length,
    };
  } catch (error) {
    return {
      available: false,
      errorType: error instanceof Error ? error.name : 'Error',
    };
  }
}

async function waitForCompaction(accessToken, threadId) {
  const deadline = Date.now() + compactionWaitMs;
  let result = await readCompactionEvents(accessToken, threadId);
  while (
    result.available &&
    result.completed === 0 &&
    result.failed === 0 &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(1_000, deadline - Date.now())),
    );
    result = await readCompactionEvents(accessToken, threadId);
  }
  return result;
}

async function settleCompactionAfterTurn(
  accessToken,
  threadId,
  previousStartedCount,
) {
  const deadline = Date.now() + Math.min(compactionWaitMs, 1_000);
  let result = await readCompactionEvents(accessToken, threadId);
  while (result.available && Date.now() < deadline) {
    const pending = result.started - result.completed - result.failed;
    if (pending > 0) return waitForCompaction(accessToken, threadId);
    if (result.started > previousStartedCount) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
    result = await readCompactionEvents(accessToken, threadId);
  }
  return result;
}

function resolveServiceToken() {
  const configured =
    process.env.CONVERSATION_EVAL_SERVICE_TOKEN?.trim() ||
    process.env.RAG_SERVICE_TOKEN?.trim();
  if (configured) return configured;
  return process.env.NODE_ENV === 'production'
    ? ''
    : 'local-rag-service-token';
}

function selectHistory(history, variant) {
  if (variant === 'no_history') return [];
  if (variant === 'full_history') return [...history];
  return history.slice(-recentExchangeLimit * 2);
}

function summarize(results, cases, conditionNames, samples, stabilityAnswers) {
  const byVariant = conditionNames.map((variant) => {
    const variantRuns = results.filter((item) => item.variant === variant);
    const turns = variantRuns.flatMap((item) => item.turns);
    const completedTurns = turns.filter((turn) => turn.status === 'completed');
    const completedCases = variantRuns.filter((item) => item.status === 'completed');
    const passingCases = completedCases.filter((item) => item.passed).length;
    const recalls = completedTurns
      .map((turn) => turn.keywordRecall)
      .filter((value) => typeof value === 'number');
    const citationChecks = completedTurns.filter((turn) => turn.citationRequired);
    const citationPasses = citationChecks.filter((turn) => turn.citationPassed).length;
    const similarities = cases.flatMap((item) =>
      item.turns.flatMap((turn) =>
        pairwiseJaccard(
          stabilityAnswers.get(`${item.id}:${variant}:${turn.id}`) ?? [],
        ),
      ),
    );
    const contextMessages = completedTurns.map((turn) => turn.contextMessageCount);
    const contextCharacters = completedTurns.map((turn) => turn.contextCharacters);
    return {
      variant,
      expectedCaseRuns: cases.length * samples,
      completedCaseRuns: completedCases.length,
      casePassRate: variantRuns.length ? passingCases / variantRuns.length : null,
      turnPassRate: variantRuns.length
        ? completedTurns.filter((turn) => turn.passed).length /
          (cases.reduce((sum, item) => sum + item.turns.length, 0) * samples)
        : null,
      averageExpectedKeywordRecall: average(recalls),
      citationPassRate: citationChecks.length ? citationPasses / citationChecks.length : null,
      averageContextMessages: average(contextMessages),
      averageContextCharacters: average(contextCharacters),
      answerPairwiseJaccard: average(similarities),
      comparedAnswerPairs: similarities.length,
    };
  });
  const full = byVariant.find((item) => item.variant === 'full_history');
  const ablationDeltas = byVariant
    .filter((item) => item.variant !== 'full_history')
    .map((item) => ({
      variant: item.variant,
      casePassRateDeltaPercentagePoints:
        full?.casePassRate == null || item.casePassRate == null
          ? null
          : Number(((item.casePassRate - full.casePassRate) * 100).toFixed(2)),
      turnPassRateDeltaPercentagePoints:
        full?.turnPassRate == null || item.turnPassRate == null
          ? null
          : Number(((item.turnPassRate - full.turnPassRate) * 100).toFixed(2)),
      contextMessageReductionVsFull:
        item.variant === 'persistent_history' ||
        full?.averageContextMessages == null || item.averageContextMessages == null
          ? null
          : Number((full.averageContextMessages - item.averageContextMessages).toFixed(2)),
      contextCharacterReductionVsFull:
        item.variant === 'persistent_history' ||
        full?.averageContextCharacters == null || item.averageContextCharacters == null
          ? null
          : Number((full.averageContextCharacters - item.averageContextCharacters).toFixed(2)),
    }));
  return { byVariant, ablationDeltas };
}

function summarizeCompression(results) {
  const expectedRuns = results.filter(
    (result) =>
      result.variant === 'persistent_history' &&
      result.compaction !== undefined &&
      result.compaction !== null,
  );
  const verifiedRuns = expectedRuns.filter(
    (result) => result.compaction?.available && result.compaction.completed > 0,
  );
  const postCompactionTurns = verifiedRuns.flatMap((result) =>
    result.turns.filter((turn) => (turn.completedCompactionsBeforeTurn ?? 0) > 0),
  );
  return {
    compactionExpectedRuns: expectedRuns.length,
    compactionObservedRuns: verifiedRuns.length,
    compactionObservationRate: expectedRuns.length
      ? Number((verifiedRuns.length / expectedRuns.length).toFixed(4))
      : null,
    turnsAskedAfterCompletedCompaction: postCompactionTurns.length,
    postCompactionTurnPassRate: postCompactionTurns.length
      ? Number(
          (
            postCompactionTurns.filter((turn) => turn.passed).length /
            postCompactionTurns.length
          ).toFixed(4),
        )
      : null,
    postCompactionExpectedKeywordRecall: average(
      postCompactionTurns
        .map((turn) => turn.keywordRecall)
        .filter((value) => typeof value === 'number'),
    ),
    limitation:
      'Only cases marked expectCompaction:true contribute. A compaction completed after the last turn proves execution but provides no post-compaction answer for fidelity scoring.',
  };
}

function validateDataset(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('会话评测数据集必须是 JSON 对象。');
  }
  const provenance = value.provenance;
  if (
    value.synthetic !== false ||
    !['sanitized_real_business', 'sanitized_real_conversations'].includes(
      provenance?.kind,
    ) ||
    provenance?.reviewed !== true ||
    typeof provenance?.sourceDescription !== 'string' ||
    !provenance.sourceDescription.trim()
  ) {
    throw new Error(
      '拒绝将非真实或未审阅数据作为业务评测：需 synthetic:false、provenance.kind 为 sanitized_real_business/sanitized_real_conversations、reviewed:true 和 sourceDescription。',
    );
  }
  if (!Array.isArray(value.cases) || value.cases.length === 0) {
    throw new Error('数据集必须包含非空 cases 数组。');
  }
  const ids = new Set();
  for (const item of value.cases) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !item.id.trim() ||
      ids.has(item.id) ||
      !Array.isArray(item.turns) ||
      item.turns.length < recentExchangeLimit + 2
    ) {
      throw new Error(
        `每个 case 需要唯一 id 和至少 ${recentExchangeLimit + 2} 轮真实会话，才能比较全历史与最近 ${recentExchangeLimit} 轮。`,
      );
    }
    if (
      item.scope !== undefined &&
      (!item.scope || typeof item.scope !== 'object' || Array.isArray(item.scope) ||
        Object.values(item.scope).some((entry) => typeof entry !== 'string'))
    ) {
      throw new Error(`${item.id}: scope 必须是字符串字段组成的对象。`);
    }
    if (
      item.knowledgeBaseKey !== undefined &&
      (typeof item.knowledgeBaseKey !== 'string' || !item.knowledgeBaseKey.trim())
    ) {
      throw new Error(`${item.id}: knowledgeBaseKey 必须是非空字符串。`);
    }
    if (
      item.expectCompaction !== undefined &&
      typeof item.expectCompaction !== 'boolean'
    ) {
      throw new Error(`${item.id}: expectCompaction 必须是布尔值。`);
    }
    ids.add(item.id);
    const turnIds = new Set();
    for (const [index, turn] of item.turns.entries()) {
      if (
        !turn ||
        typeof turn.query !== 'string' ||
        !turn.query.trim() ||
        (turn.id !== undefined && (typeof turn.id !== 'string' || !turn.id.trim())) ||
        (turn.requireCitation !== undefined && typeof turn.requireCitation !== 'boolean') ||
        (turn.expectRefusal !== undefined && typeof turn.expectRefusal !== 'boolean')
      ) {
        throw new Error(`${item.id}: 第 ${index + 1} 轮需有 query 和可选 id。`);
      }
      turn.id ??= `turn-${index + 1}`;
      if (turnIds.has(turn.id)) throw new Error(`${item.id}: turn id 重复。`);
      turnIds.add(turn.id);
      if (
        !Array.isArray(turn.expectedKeywords) ||
        turn.expectedKeywords.some((keyword) => typeof keyword !== 'string' || !keyword.trim())
      ) {
        throw new Error(`${item.id}/${turn.id}: expectedKeywords 必须是字符串数组。`);
      }
      if (turn.expectRefusal !== true && turn.expectedKeywords.length === 0) {
        throw new Error(`${item.id}/${turn.id}: 非拒答轮需要 expectedKeywords。`);
      }
      const minimum =
        turn.minKeywordHits ??
        (turn.expectedKeywords.length
          ? Math.max(1, Math.ceil(turn.expectedKeywords.length / 2))
          : 0);
      if (
        !Number.isInteger(minimum) ||
        minimum < 0 ||
        minimum > turn.expectedKeywords.length
      ) {
        throw new Error(`${item.id}/${turn.id}: minKeywordHits 超出范围。`);
      }
    }
  }
}

async function resolveAccessToken() {
  if (process.env.ACCESS_TOKEN?.trim()) return process.env.ACCESS_TOKEN.trim();
  const username = process.env.CONVERSATION_EVAL_USERNAME?.trim();
  const password = process.env.CONVERSATION_EVAL_PASSWORD;
  if (!username || !password) {
    throw new Error(
      '设置 ACCESS_TOKEN，或同时设置 CONVERSATION_EVAL_USERNAME 和 CONVERSATION_EVAL_PASSWORD。',
    );
  }
  const response = await fetch(`${apiBaseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) throw new Error(`本地登录失败 (${response.status})`);
  const data = unwrap(await response.json());
  if (typeof data?.accessToken !== 'string') {
    throw new Error('本地登录响应缺少 accessToken。');
  }
  return data.accessToken;
}

async function cleanupConversations(accessToken, threadIds) {
  const failures = [];
  for (const threadId of threadIds) {
    try {
      const response = await fetch(
        `${apiBaseUrl}/chat/conversations/${encodeURIComponent(threadId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(requestTimeoutMs),
        },
      );
      if (!response.ok) failures.push({ threadId, status: response.status });
    } catch (error) {
      failures.push({
        threadId,
        errorType: error instanceof Error ? error.name : 'Error',
      });
    }
  }
  return failures;
}

async function writeReport(filePath, report) {
  const target = path.resolve(filePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
}

function pairwiseJaccard(values) {
  const pairs = [];
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      const a = answerTokenSet(values[left]);
      const b = answerTokenSet(values[right]);
      const union = new Set([...a, ...b]);
      if (union.size === 0) continue;
      const intersection = [...a].filter((token) => b.has(token));
      pairs.push(intersection.length / union.size);
    }
  }
  return pairs;
}

function answerTokenSet(value) {
  const normalized = value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const latin = normalized.match(/[a-z0-9_]+/g) ?? [];
  const cjk = normalized.match(/[\u4e00-\u9fff]+/g) ?? [];
  const bigrams = cjk.flatMap((text) => {
    if (text.length === 1) return [text];
    const tokens = [];
    for (let index = 0; index < text.length - 1; index += 1) {
      tokens.push(text.slice(index, index + 2));
    }
    return tokens;
  });
  return new Set([...latin, ...bigrams]);
}

function average(values) {
  return values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4))
    : null;
}

function normalizeBaseUrl(value) {
  return value.replace(/\/$/, '');
}

function unwrap(value) {
  return value && typeof value === 'object' && 'data' in value
    ? value.data
    : value;
}

function printHelp() {
  console.log(`离线统计已采集的多轮会话上下文消融结果（运行模式会请求配置的本地 Chat API）。

必需配置：
  CONVERSATION_EVAL_DATASET=/path/to/reviewed-real-conversations.json
  ACCESS_TOKEN=... 或 CONVERSATION_EVAL_USERNAME/PASSWORD

常用配置：
  CONVERSATION_EVAL_API_BASE_URL=http://localhost:3000/api/v1
  CONVERSATION_EVAL_SAMPLES=3
  CONVERSATION_EVAL_RECENT_EXCHANGES=2
  CONVERSATION_EVAL_COMPACTION_WAIT_MS=30000
  CONVERSATION_EVAL_MAX_REQUESTS=300
  CONVERSATION_EVAL_OUTPUT=.tmp/evidence/conversation-context-eval.json
  CONVERSATION_EVAL_ENFORCE=true

数据集必须声明 synthetic:false、已审核的 sanitized_real_business 或
sanitized_real_conversations 来源，并为每个 case 提供至少 recent-exchanges + 2 轮 turns
（默认 4 轮，确保 recent-history 与 full-history 确有删减差异）。每轮含 id、query、
expectedKeywords、可选 minKeywordHits/requireCitation/expectRefusal。
标记 expectCompaction:true 的 case 会额外回放同一服务端会话，并用运行事件确认摘要压缩；设置 CONVERSATION_EVAL_SERVICE_TOKEN 或 RAG_SERVICE_TOKEN 读取事件。只有压缩完成后的轮次可用于评估摘要事实保留。
使用 --validate-only 只校验数据格式，不请求 API。
报告不保存原始 query/answer；关键字命中率不等同语义质量或生产准确率。`);
}
