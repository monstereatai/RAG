import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  average,
  parseBoolean,
  percentile,
  rate,
  safeError,
  writeEvidenceReport,
} from './lib/evidence-utils.mjs';

const runs = Math.max(1, Number(process.env.AGENT_STABILITY_RUNS ?? '3'));
const concurrency = Math.max(
  1,
  Number(process.env.AGENT_STABILITY_CONCURRENCY ?? '1'),
);
const scenario = process.env.AGENT_STABILITY_SCENARIO ?? 'dag';
const profile = process.env.AGENT_STABILITY_PROFILE ?? 'local';
const reuseRuns = parseBoolean(process.env.AGENT_STABILITY_REUSE_RUNS, false);
const outputPath =
  process.env.AGENT_STABILITY_OUTPUT ?? '.tmp/evidence/agent-stability.json';
const runDirectory = outputPath.replace(/\.json$/i, '-runs');
const enforce = parseBoolean(process.env.AGENT_STABILITY_ENFORCE, true);
if (!Number.isInteger(runs) || runs < 1) {
  throw new Error('AGENT_STABILITY_RUNS 必须是大于 0 的整数。');
}
if (!Number.isInteger(concurrency) || concurrency < 1) {
  throw new Error('AGENT_STABILITY_CONCURRENCY 必须是大于 0 的整数。');
}
const thresholds = {
  workflowSuccessRate: Number(
    process.env.AGENT_STABILITY_MIN_WORKFLOW_SUCCESS_RATE ?? '0.95',
  ),
  modelSuccessRate: Number(
    process.env.AGENT_STABILITY_MIN_MODEL_SUCCESS_RATE ?? '0.9',
  ),
  approvalReadyRate: Number(
    process.env.AGENT_STABILITY_MIN_APPROVAL_READY_RATE ??
      (profile === 'strict' && scenario === 'approval' ? '0.9' : '0'),
  ),
  averageEvidenceCoverage: Number(
    process.env.AGENT_STABILITY_MIN_EVIDENCE_COVERAGE ??
      (profile === 'strict' ? '0.8' : '0'),
  ),
  p95Ms: Number(process.env.AGENT_STABILITY_MAX_P95_MS ?? '600000'),
};

await mkdir(runDirectory, { recursive: true });
let results;
if (reuseRuns) {
  const files = (await readdir(runDirectory))
    .filter((file) => file.endsWith('.json'))
    .sort();
  if (files.length < runs) {
    throw new Error(`可复用的稳定性报告不足：需要 ${runs} 条，实际 ${files.length} 条。`);
  }
  results = await Promise.all(
    files.slice(0, runs).map(async (file, index) => ({
      runNumber: index + 1,
      ...(await readJson(path.join(runDirectory, file))),
    })),
  );
} else {
  const accessToken = await resolveAccessToken();
  results = [];
  let nextRun = 1;

  async function worker() {
    while (nextRun <= runs) {
      const runNumber = nextRun;
      nextRun += 1;
      results.push(await executeRun(runNumber, accessToken));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, runs) }, () => worker()),
  );
}
results.sort((left, right) => left.runNumber - right.runNumber);

const successfulRuns = results.filter((item) => item.completed);
const roleResults = successfulRuns.flatMap((item) => item.roleResults ?? []);
const modelRuns = roleResults.filter((item) => item.modelStatus !== 'not_run');
const modelSuccesses = modelRuns.filter(
  (item) => item.modelStatus === 'success',
).length;
const approvalReady = roleResults.filter(
  (item) => item.readyForApproval,
).length;
const artifactsCreated = roleResults.filter(
  (item) => item.artifactStatus !== 'not_created',
).length;
const summary = {
  requestedRuns: runs,
  completedRuns: successfulRuns.length,
  workflowSuccessRate: rate(successfulRuns.length, runs),
  totalRoleRuns: roleResults.length,
  modelSuccessRate: rate(modelSuccesses, modelRuns.length),
  modelDegradeRate: rate(modelRuns.length - modelSuccesses, modelRuns.length),
  approvalReadyRate: rate(approvalReady, roleResults.length),
  artifactCreationRate: rate(artifactsCreated, roleResults.length),
  averageEvidenceCoverage: average(
    roleResults.map((item) => item.evidenceCoverage),
  ),
  p50Ms: percentile(
    successfulRuns.map((item) => item.durationMs),
    0.5,
  ),
  p95Ms: percentile(
    successfulRuns.map((item) => item.durationMs),
    0.95,
  ),
};
const failedThresholds = Object.entries(thresholds)
  .filter(([key, threshold]) => {
    if (key === 'p95Ms') return summary.p95Ms > threshold;
    return summary[key] < threshold;
  })
  .map(([key]) => key);
const report = {
  schemaVersion: 1,
  evidenceLevel: 'local_real_api',
  generatedAt: new Date().toISOString(),
  scenario,
  profile,
  reusedRuns: reuseRuns,
  concurrency,
  thresholds,
  summary,
  failedThresholds,
  passed: failedThresholds.length === 0,
  runs: results.map((item) => ({
    runNumber: item.runNumber,
    runId: item.runId,
    completed: item.completed,
    status: item.status,
    durationMs: item.durationMs,
    approvalCycles: item.approvalCycles,
    roleResults: item.roleResults,
    error: item.error,
  })),
};

await writeEvidenceReport(outputPath, report, renderMarkdown(report));
console.log(JSON.stringify(report, null, 2));
if (enforce && !report.passed) process.exitCode = 1;

async function executeRun(runNumber, accessToken) {
  const runId = `${Date.now()}-${runNumber}`;
  const runOutput = path.join(runDirectory, `${runId}.json`);
  const started = performance.now();
  try {
    await spawnDemo(runId, runOutput, accessToken);
    const report = JSON.parse(await readFile(runOutput, 'utf8'));
    return { runNumber, ...report };
  } catch (error) {
    return {
      runNumber,
      runId,
      completed: false,
      status: 'failed',
      durationMs: Number((performance.now() - started).toFixed(2)),
      error: safeError(error),
      roleResults: [],
    };
  }
}

async function resolveAccessToken() {
  if (process.env.ACCESS_TOKEN) return process.env.ACCESS_TOKEN;
  if (process.env.AGENT_STABILITY_LOCAL_LOGIN !== 'true') {
    throw new Error(
      '缺少 ACCESS_TOKEN；本地回放可设置 AGENT_STABILITY_LOCAL_LOGIN=true 使用本地测试账号。',
    );
  }
  const baseUrl = (
    process.env.RAG_API_BASE_URL ?? 'http://localhost:3000/api/v1'
  ).replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: process.env.AGENT_STABILITY_USERNAME ?? 'user',
      password: process.env.AGENT_STABILITY_PASSWORD ?? 'user1234',
    }),
  });
  const body = await response.json();
  const token = body?.data?.accessToken ?? body?.accessToken;
  if (!response.ok || !token) {
    throw new Error(`本地登录失败：${response.status}`);
  }
  return token;
}

function spawnDemo(runId, runOutput, accessToken) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['scripts/demo-production-workflow.mjs', scenario],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ACCESS_TOKEN: accessToken,
          WORKFLOW_RUN_ID: runId,
          WORKFLOW_EVIDENCE_OUTPUT: runOutput,
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `workflow demo exited with ${code}`));
    });
  });
}

function renderMarkdown(report) {
  const summary = report.summary;
  return `# Agent 工作流稳定性证据

- 生成时间：${report.generatedAt}
- 证据级别：${report.evidenceLevel}
- 场景：${report.scenario}
- Profile：${report.profile}
- 次数／并发：${summary.requestedRuns}／${report.concurrency}
- 门禁：${report.passed ? '通过' : '失败'}

| 指标 | 结果 | 门槛 |
| --- | ---: | ---: |
| 工作流成功率 | ${summary.workflowSuccessRate} | ${report.thresholds.workflowSuccessRate} |
| 模型成功率 | ${summary.modelSuccessRate} | ${report.thresholds.modelSuccessRate} |
| 模型降级率 | ${summary.modelDegradeRate} | 观察项 |
| 审批就绪率 | ${summary.approvalReadyRate} | ${report.thresholds.approvalReadyRate}（auto 场景不要求审批） |
| 证据覆盖率 | ${summary.averageEvidenceCoverage} | ${report.thresholds.averageEvidenceCoverage} |
| 产物创建率 | ${summary.artifactCreationRate} | 观察项 |
| P95 | ${summary.p95Ms} ms | ${report.thresholds.p95Ms} ms |

> 工作流完成率与模型成功率分开统计。local profile 不把真实业务证据覆盖率和 auto 场景审批就绪当作门禁；strict profile 才启用这些要求。
`;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}
