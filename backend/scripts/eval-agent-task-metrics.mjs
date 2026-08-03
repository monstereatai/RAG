import { readFile } from 'node:fs/promises';

const datasetPath =
  process.env.AGENT_TASK_DATASET ?? 'eval/agent-task-regression.dataset.json';
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
const presentTypes = new Set(cases.map((item) => item.type));
const missingCoverage = requiredTypes.filter((type) => !presentTypes.has(type));

const taskSuccessRate = average(cases.map((item) => (item.passed ? 1 : 0)));
const toolCalls = cases.flatMap((item) => item.toolCalls ?? []);
const toolSuccessRate = average(
  toolCalls.map((item) => (item.success ? 1 : 0)),
  1,
);
const stepAccuracy = average(
  cases.map((item) => positionalAccuracy(item.expectedSteps ?? [], item.actualSteps ?? [])),
);
const humanHandoffRate = average(
  cases.map((item) => (item.humanHandoff ? 1 : 0)),
);

const thresholds = {
  task_success_rate: Number(process.env.AGENT_TASK_MIN_SUCCESS_RATE ?? 0.9),
  tool_success_rate: Number(process.env.AGENT_TASK_MIN_TOOL_SUCCESS_RATE ?? 0.9),
  step_accuracy: Number(process.env.AGENT_TASK_MIN_STEP_ACCURACY ?? 0.9),
};
const metrics = {
  task_success_rate: taskSuccessRate,
  tool_success_rate: toolSuccessRate,
  step_accuracy: stepAccuracy,
  human_handoff_rate: humanHandoffRate,
};
const failedThresholds = Object.entries(thresholds)
  .filter(([key, threshold]) => metrics[key] < threshold)
  .map(([key]) => key);
const report = {
  ok: missingCoverage.length === 0 && failedThresholds.length === 0,
  simulated: dataset.simulated === true,
  dataset: datasetPath,
  cases: cases.length,
  coverage: Object.fromEntries(requiredTypes.map((type) => [type, presentTypes.has(type)])),
  missingCoverage,
  metrics,
  thresholds,
  failedThresholds,
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;

function positionalAccuracy(expected, actual) {
  if (expected.length === 0) return 1;
  const matched = expected.filter((step, index) => actual[index] === step).length;
  return matched / expected.length;
}

function average(values, emptyValue = 0) {
  if (values.length === 0) return emptyValue;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}
