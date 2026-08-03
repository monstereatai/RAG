import { readFile } from 'node:fs/promises';

const datasetPath =
  process.env.PRODUCTION_WORKFLOW_DATASET ??
  'eval/production-workflow-regression.dataset.json';
const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
const cases = Array.isArray(dataset.cases) ? dataset.cases : [];

const requiredTypes = [
  'single_role',
  'dag_parallel',
  'selective_approval',
  'risk_approval',
  'local_rerun',
  'evidence_gate',
  'tool_budget',
  'tool_degrade',
  'skipped_role_gap',
  'owner_isolation',
];
const presentTypes = new Set(cases.map((item) => item.type));
const missingCoverage = requiredTypes.filter((type) => !presentTypes.has(type));

const metrics = {
  task_success_rate: average(cases.map((item) => (item.passed ? 1 : 0))),
  dependency_accuracy: average(
    cases
      .filter((item) => item.expectedBatches)
      .map((item) =>
        JSON.stringify(item.expectedBatches) ===
        JSON.stringify(item.actualBatches)
          ? 1
          : 0,
      ),
    1,
  ),
  deliverable_completeness: average(
    cases.map((item) => (item.deliverableComplete ? 1 : 0)),
  ),
  evidence_gate_accuracy: average(
    cases
      .filter((item) => item.evidenceCoverage === 0)
      .map((item) =>
        item.unsupportedClaimStatus === 'pending_confirmation' ||
        item.type === 'risk_approval'
          ? 1
          : 0,
      ),
    1,
  ),
  artifact_creation_rate: average(
    cases.map((item) => (item.artifactCreated ? 1 : 0)),
  ),
  local_rerun_accuracy: average(cases.map((item) => (item.localRerun ? 1 : 0))),
  tool_budget_compliance: average(
    cases
      .filter((item) => item.toolBudget !== undefined)
      .map((item) => (item.toolCalls <= item.toolBudget ? 1 : 0)),
    1,
  ),
};

const threshold = Number(process.env.PRODUCTION_WORKFLOW_MIN_METRIC ?? 0.9);
const failedMetrics = Object.entries(metrics)
  .filter(([, value]) => value < threshold)
  .map(([name]) => name);
const report = {
  ok:
    cases.length >= 10 &&
    missingCoverage.length === 0 &&
    failedMetrics.length === 0,
  simulated: dataset.simulated === true,
  dataset: datasetPath,
  cases: cases.length,
  missingCoverage,
  metrics,
  threshold,
  failedMetrics,
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;

function average(values, emptyValue = 0) {
  if (values.length === 0) return emptyValue;
  return Number(
    (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4),
  );
}
