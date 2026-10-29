import { spawn } from 'node:child_process';
import {
  parseBoolean,
  rate,
  safeError,
  writeEvidenceReport,
} from './lib/evidence-utils.mjs';

const scenarioMap = {
  redis: 'smoke:redis-checkpointer',
  milvus: 'smoke:milvus',
  'milvus-bad-case': 'smoke:milvus:bad-case',
  hybrid: 'smoke:hybrid',
  graph: 'smoke:graph',
  external: 'smoke:external:required',
  langfuse: 'smoke:langfuse',
  adoption: 'smoke:adoption',
};

if (process.argv.includes('--list')) {
  console.log(Object.keys(scenarioMap).join('\n'));
  process.exit(0);
}

const requested = (process.argv[2] ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
if (requested.length === 0) {
  throw new Error(
    `请指定演练场景：${Object.keys(scenarioMap).join(',')}。例如 npm run evidence:operations -- redis,milvus-bad-case`,
  );
}
const unknown = requested.filter((item) => !scenarioMap[item]);
if (unknown.length > 0) throw new Error(`未知演练场景：${unknown.join('、')}`);

const outputPath =
  process.env.OPERATIONS_EVIDENCE_OUTPUT ??
  '.tmp/evidence/operational-readiness.json';
const enforce = parseBoolean(process.env.OPERATIONS_EVIDENCE_ENFORCE, true);
const timeoutMs = Number(
  process.env.OPERATIONS_EVIDENCE_TIMEOUT_MS ?? '600000',
);
const results = [];

for (const scenario of requested) {
  results.push(await runScenario(scenario, scenarioMap[scenario]));
}

const passed = results.filter((item) => item.passed).length;
const report = {
  schemaVersion: 1,
  evidenceLevel: 'local_real_api',
  generatedAt: new Date().toISOString(),
  environment: process.env.OPERATIONS_EVIDENCE_ENVIRONMENT ?? 'local',
  exerciseId: process.env.OPERATIONS_EVIDENCE_EXERCISE_ID ?? null,
  hypothesis: process.env.OPERATIONS_EVIDENCE_HYPOTHESIS ?? null,
  injectedFailure: process.env.OPERATIONS_EVIDENCE_INJECTED_FAILURE ?? null,
  operator: process.env.OPERATIONS_EVIDENCE_OPERATOR ?? null,
  scenarios: requested,
  summary: {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: rate(passed, results.length),
  },
  passed: passed === results.length,
  results,
};

await writeEvidenceReport(outputPath, report, renderMarkdown(report));
console.log(JSON.stringify(report, null, 2));
if (enforce && !report.passed) process.exitCode = 1;

function runScenario(scenario, npmScript) {
  return new Promise((resolve) => {
    const startedAt = new Date();
    const child = spawn('npm', ['run', npmScript], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout = appendTail(stdout, chunk.toString());
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendTail(stderr, chunk.toString());
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        scenario,
        npmScript,
        passed: false,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        error: safeError(error),
      });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const endedAt = new Date();
      resolve({
        scenario,
        npmScript,
        passed: code === 0,
        exitCode: code,
        signal,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs: endedAt.getTime() - startedAt.getTime(),
        stdout: redact(stdout),
        stderr: redact(stderr),
      });
    });
  });
}

function appendTail(previous, addition) {
  return `${previous}${addition}`.slice(-4_000);
}

function redact(value) {
  return safeError(value).slice(-2_000);
}

function renderMarkdown(report) {
  const rows = report.results
    .map(
      (item) =>
        `| ${item.scenario} | ${item.passed ? '通过' : '失败'} | ${item.durationMs ?? 0} | ${item.exitCode ?? '-'} |`,
    )
    .join('\n');
  return `# Agent／RAG 运维演练证据

- 生成时间：${report.generatedAt}
- 环境：${report.environment}
- 演练编号：${report.exerciseId ?? '未填写'}
- 注入故障：${report.injectedFailure ?? '未填写，仅执行 smoke'}
- 通过率：${report.summary.passRate}

| 场景 | 结果 | 耗时(ms) | 退出码 |
| --- | --- | ---: | ---: |
${rows}

## 结论

${report.passed ? '所选 smoke 全部通过。' : '至少一个 smoke 失败，需要在复盘中记录影响、根因和改进项。'}

> 未填写“注入故障”时，本报告只能证明依赖连通和恢复 smoke，不能称为真实故障演练。
`;
}
