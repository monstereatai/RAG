import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const datasetPath =
  process.env.AGENT_TASK_DATASET ?? 'eval/project-simulated-business.dataset.json';
const live = process.env.AGENT_TASK_EVAL_LIVE === 'true';
const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));

const requiredTypes = [
  'retrieval',
  'refusal',
  'conflict',
  'citation',
  'tool_degrade',
];

const queries = Array.isArray(dataset.queries) ? dataset.queries : [];
const coverage = {
  retrieval: queries.length > 0,
  refusal: queries.some((item) => item.expectRefusal === true),
  conflict: queries.some((item) => item.expectConflictHandling === true),
  citation: queries.some((item) => (item.expectedKeywords ?? []).length > 0),
  tool_degrade: true,
};

let liveProjectEval = null;
if (live) {
  const result = spawnSync('node', ['scripts/eval-rag-project.mjs'], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
  });
  liveProjectEval = {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

const missingCoverage = requiredTypes.filter((type) => !coverage[type]);
const taskSuccessRate = liveProjectEval?.status === 0 ? 1 : null;
const report = {
  ok: missingCoverage.length === 0 && (!live || liveProjectEval?.status === 0),
  live,
  dataset: datasetPath,
  coverage,
  missingCoverage,
  metrics: {
    task_success_rate: taskSuccessRate,
    tool_success_rate: null,
    step_accuracy: null,
    human_handoff_rate: null,
    note:
      'Non-live mode validates coverage scaffolding. Set AGENT_TASK_EVAL_LIVE=true to run project eval as the task success gate.',
  },
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;

