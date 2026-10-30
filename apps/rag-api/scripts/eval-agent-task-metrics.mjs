import { readFile } from 'node:fs/promises';

const datasetPath =
  process.env.AGENT_TASK_DATASET ?? 'eval/agent-task-regression.dataset.json';
const eventsPath = process.env.AGENT_TASK_EVENTS?.trim();
const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
const cases = Array.isArray(dataset.cases) ? dataset.cases : [];

if (cases.length === 0) {
  console.error('Agent task dataset must contain at least one case.');
  process.exit(1);
}

const requiredTypes = [
  'workflow',
  'retrieval',
  'bad_case',
  'tool_degrade',
  'citation',
  'refusal',
  'memory',
];
const recordCases = cases.filter(
  (item) => item !== null && typeof item === 'object' && !Array.isArray(item),
);
const presentTypes = new Set(recordCases.map((item) => item.type));
const missingCoverage = requiredTypes.filter((type) => !presentTypes.has(type));
const seenIds = new Set();
const invalidCases = cases
  .filter(
    (item) =>
      item === null ||
      typeof item !== 'object' ||
      typeof item.id !== 'string' ||
      item.id.trim().length === 0 ||
      typeof item.type !== 'string' ||
      item.type.trim().length === 0 ||
      typeof item.scenario !== 'string' ||
      item.scenario.trim().length === 0 ||
      typeof item.input !== 'string' ||
      item.input.trim().length === 0 ||
      !Array.isArray(item.expectedEvents) ||
      item.expectedEvents.length === 0,
  )
  .map((item) =>
    item && typeof item === 'object' ? (item.id ?? '(missing id)') : '(invalid case)',
  );
for (const item of recordCases) {
  if (seenIds.has(item.id)) invalidCases.push(`${item.id} (duplicate id)`);
  seenIds.add(item.id);
}

let runtimeTrajectory = {
  measured: false,
  runs: 0,
  passingRuns: 0,
  passRate: null,
  cases: [],
  missingCaseIds: [],
};
let eventBundleError;
if (eventsPath) {
  try {
    const bundle = JSON.parse(await readFile(eventsPath, 'utf8'));
    runtimeTrajectory = evaluateRuns(cases, readRuns(bundle));
  } catch (error) {
    eventBundleError = error instanceof Error ? error.message : String(error);
    runtimeTrajectory = {
      measured: false,
      runs: 0,
      passingRuns: 0,
      passRate: null,
      cases: [],
      missingCaseIds: [],
    };
  }
}

const trajectoryFailures = runtimeTrajectory.cases.filter(
  (item) => item.status !== 'passed',
);
const contractOk = missingCoverage.length === 0 && invalidCases.length === 0;
const ok = eventsPath
  ? contractOk &&
    !eventBundleError &&
    runtimeTrajectory.runs > 0 &&
    trajectoryFailures.length === 0 &&
    (process.env.AGENT_TASK_REQUIRE_ALL_CASES !== 'true' ||
      runtimeTrajectory.missingCaseIds.length === 0)
  : contractOk;
const report = {
  ok,
  kind: eventsPath ? 'agent_task_trajectory_eval' : 'contract_smoke',
  qualityMetricsMeasured: false,
  trajectoryMetricsMeasured: runtimeTrajectory.measured,
  simulatedDataset: dataset.simulated === true,
  dataset: datasetPath,
  events: eventsPath ?? null,
  cases: cases.length,
  coverage: Object.fromEntries(requiredTypes.map((type) => [type, presentTypes.has(type)])),
  missingCoverage,
  invalidCases,
  contractValidation: { passed: contractOk },
  runtimeTrajectory,
  trajectoryCoverageComplete: runtimeTrajectory.missingCaseIds.length === 0,
  eventBundleError,
  reason: eventsPath
    ? '已对照输入运行事件检查期望事件顺序、事件载荷和禁止事件；这只评估执行轨迹契约，不代表答案正确性或业务质量。没有事件的场景会列入 missingCaseIds。'
    : '当前只检查样例契约。设置 AGENT_TASK_EVENTS 并传入真实 Run 事件后，才会评估 Agent 执行轨迹；轨迹通过不等于答案质量通过。',
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;

function readRuns(bundle) {
  const runs = Array.isArray(bundle) ? bundle : bundle?.runs;
  if (!Array.isArray(runs)) {
    throw new Error('运行事件文件必须是数组，或包含 runs 数组的对象。');
  }

  return runs.map((run, index) => {
    if (
      !run ||
      typeof run !== 'object' ||
      typeof run.caseId !== 'string' ||
      !Array.isArray(run.events)
    ) {
      throw new Error(`第 ${index + 1} 条运行记录必须包含 caseId 和 events 数组。`);
    }
    const events = run.events.map((event, eventIndex) => {
      if (!event || typeof event.eventType !== 'string') {
        throw new Error(
          `运行 ${run.caseId} 的第 ${eventIndex + 1} 条事件缺少 eventType。`,
        );
      }
      return {
        ...event,
        payload: parsePayload(event.payload),
      };
    });
    events.sort((left, right) => {
      const leftSequence = Number(left.sequence);
      const rightSequence = Number(right.sequence);
      if (Number.isFinite(leftSequence) && Number.isFinite(rightSequence)) {
        return leftSequence - rightSequence;
      }
      return 0;
    });
    return { caseId: run.caseId, runId: run.runId ?? null, events };
  });
}

function parsePayload(payload) {
  if (typeof payload !== 'string') return payload ?? {};
  try {
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

function evaluateRuns(datasetCases, runs) {
  const expectedCases = datasetCases.filter(
    (item) => Array.isArray(item.expectedEvents) && item.expectedEvents.length > 0,
  );
  const results = [];
  const missingCaseIds = [];
  for (const item of expectedCases) {
    const matchingRuns = runs.filter((run) => run.caseId === item.id);
    if (matchingRuns.length === 0) {
      missingCaseIds.push(item.id);
      continue;
    }
    for (const run of matchingRuns) {
      const evaluation = evaluateRun(item, run);
      results.push({
        caseId: item.id,
        runId: run.runId,
        ...evaluation,
      });
    }
  }
  const passingRuns = results.filter((item) => item.status === 'passed').length;
  return {
    measured: results.length > 0,
    expectedCases: expectedCases.length,
    runs: results.length,
    passingRuns,
    passRate: results.length ? passingRuns / results.length : null,
    cases: results,
    missingCaseIds,
    unmatchedRunCaseIds: [...new Set(
      runs
        .map((run) => run.caseId)
        .filter((caseId) => !expectedCases.some((item) => item.id === caseId)),
    )],
  };
}

function evaluateRun(item, run) {
  const missingEvents = [];
  let cursor = 0;
  for (const expected of item.expectedEvents) {
    const matchIndex = run.events.findIndex(
      (event, index) => index >= cursor && eventMatches(event, expected),
    );
    if (matchIndex === -1) {
      missingEvents.push(expected);
    } else {
      cursor = matchIndex + 1;
    }
  }
  const forbiddenEvents = (item.forbiddenEvents ?? []).flatMap((eventType) =>
    run.events
      .filter((event) => event.eventType === eventType)
      .map((event) => ({ eventType, sequence: event.sequence })),
  );
  return {
    status: missingEvents.length === 0 && forbiddenEvents.length === 0 ? 'passed' : 'failed',
    eventCount: run.events.length,
    missingEvents,
    forbiddenEvents,
  };
}

function eventMatches(event, expected) {
  if (event.eventType !== expected.eventType) return false;
  if (expected.target !== undefined && event.target !== expected.target) return false;
  if (!matchesPartial(event.payload, expected.payload)) return false;
  if (!matchesMinimums(event.payload, expected.payloadMin)) return false;
  return true;
}

function matchesPartial(actual, expected) {
  if (expected === undefined) return true;
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function matchesMinimums(actual, minimums) {
  if (minimums === undefined) return true;
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
  return Object.entries(minimums).every(([key, minimum]) => {
    const value = Number(actual[key]);
    return Number.isFinite(value) && value >= Number(minimum);
  });
}
