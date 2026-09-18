import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const modes = (process.env.AGENT_PLATFORM_MODES ?? 'simple,auto,agentic')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const expectedModes = ['simple', 'auto', 'agentic'];
const modeContractPassed = expectedModes.every((mode) => modes.includes(mode));
const checks = [];

if (!modeContractPassed) {
  checks.push({
    name: 'mode-contract',
    ok: false,
    reason: `AGENT_PLATFORM_MODES must include ${expectedModes.join(',')}`,
  });
} else {
  checks.push({ name: 'mode-contract', ok: true, modes });
}

await validateDataset(
  'query-routing-dataset',
  'eval/query-routing.dataset.json',
  (dataset) => Array.isArray(dataset) && dataset.length > 0,
);
await validateDataset(
  'agent-task-dataset',
  'eval/agent-task-regression.dataset.json',
  (dataset) => Array.isArray(dataset.cases) && dataset.cases.length > 0,
);
await validateDataset(
  'production-workflow-dataset',
  'eval/production-workflow-regression.dataset.json',
  (dataset) => Array.isArray(dataset.cases) && dataset.cases.length >= 10,
);

for (const [name, args] of [
  ['query-routing-contract', ['scripts/eval-query-routing.mjs']],
  ['agent-task-contract', ['scripts/eval-agent-task-metrics.mjs']],
  ['production-workflow-contract', ['scripts/eval-production-workflow.mjs']],
]) {
  const result = run('node', args);
  checks.push({ name, ok: result.status === 0 });
}

const project = run('node', ['scripts/eval-rag-project.mjs'], {
  PROJECT_EVAL_MODES: modes.join(','),
});
checks.push({
  name: 'project-three-mode-e2e',
  ok: project.status === 0,
  live: project.live,
  skipped: project.skipped,
  summary: project.summary,
});

const e2e = run('node', ['scripts/eval-rag-e2e.mjs'], {
  EVAL_RAG_E2E_MODES: modes.join(','),
});
checks.push({
  name: 'hybrid-three-mode-e2e',
  ok: e2e.status === 0,
  live: e2e.live,
  skipped: e2e.skipped,
  summary: e2e.summary,
});

const ok = modeContractPassed && checks.every((check) => check.ok);
console.log(
  JSON.stringify(
    {
      ok,
      modes,
      liveRequired: process.env.AGENT_PLATFORM_REQUIRE_LIVE === 'true',
      checks,
    },
    null,
    2,
  ),
);
if (!ok) process.exitCode = 1;

async function validateDataset(name, path, predicate) {
  try {
    const dataset = JSON.parse(await readFile(path, 'utf8'));
    const valid = predicate(dataset);
    checks.push({ name, ok: valid, path });
    if (!valid) process.exitCode = 1;
  } catch (error) {
    checks.push({
      name,
      ok: false,
      path,
      reason: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }
}

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...extraEnv,
      PROJECT_EVAL_REQUIRE_LIVE:
        process.env.AGENT_PLATFORM_REQUIRE_LIVE === 'true' ? 'true' : 'false',
    },
    encoding: 'utf8',
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  const parsed = parseLastJson(result.stdout ?? '');
  return {
    status: result.status ?? 1,
    live: parsed?.skipped === false,
    skipped: parsed?.skipped === true,
    summary: parsed?.summary,
  };
}

function parseLastJson(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  for (let index = trimmed.length - 1; index >= 0; index -= 1) {
    if (trimmed[index] !== '{') continue;
    try {
      return JSON.parse(trimmed.slice(index));
    } catch {
      // Continue searching for the beginning of the final JSON object.
    }
  }
  return null;
}
