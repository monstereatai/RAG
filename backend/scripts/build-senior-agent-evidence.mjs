import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeEvidenceReport } from './lib/evidence-utils.mjs';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const evidenceDirectory = process.env.AGENT_EVIDENCE_DIR ?? '.tmp/evidence';
const outputPath =
  process.env.AGENT_EVIDENCE_OUTPUT ??
  path.join(evidenceDirectory, 'senior-agent-readiness.json');

const inputs = {
  business: await optionalJson(
    path.join(evidenceDirectory, 'rag-business.json'),
  ),
  stability: await optionalJson(
    path.join(evidenceDirectory, 'agent-stability.json'),
  ),
  performance: await optionalJson(
    path.join(evidenceDirectory, 'rag-performance.json'),
  ),
  operations: await optionalJson(
    path.join(evidenceDirectory, 'operational-readiness.json'),
  ),
  realWorld: await optionalJson(
    process.env.AGENT_REAL_WORLD_EVIDENCE ??
      path.join(repoRoot, 'docs/evidence/real-world-evidence.local.json'),
  ),
};

const adrDirectory = path.join(repoRoot, 'docs/architecture-decisions');
const adrFiles = [
  'ADR-001-workflow-first.md',
  'ADR-002-hybrid-retrieval-and-rerank.md',
  'ADR-003-evidence-gated-answering.md',
  'ADR-004-layered-memory.md',
  'ADR-005-timeout-degrade-and-recovery.md',
];
const adrChecks = await Promise.all(
  adrFiles.map(async (file) => ({
    file: path.join(adrDirectory, file),
    exists: await exists(path.join(adrDirectory, file)),
  })),
);

const seniorChecks = [
  check(
    'real_business_cases',
    (inputs.business?.evaluatedCaseCount ?? 0) >= 100 &&
      inputs.business?.passed === true &&
      inputs.business?.evidenceLevel !== 'simulated',
    '至少 100 条非模拟业务用例，且真实 API 评测门禁通过',
  ),
  check(
    'agent_stability',
    (inputs.stability?.summary?.requestedRuns ?? 0) >= 30 &&
      inputs.stability?.passed === true,
    '至少 30 次完整工作流回放，稳定性门禁通过',
  ),
  check(
    'performance_sla',
    (inputs.performance?.samples ?? 0) >= 30 &&
      inputs.performance?.passed === true,
    '每种模式至少 30 个样本，p50／p95／错误率门禁通过',
  ),
  check(
    'architecture_decisions',
    adrChecks.every((item) => item.exists),
    '五个核心架构决策记录完整',
  ),
  check(
    'operational_recovery',
    inputs.operations?.passed === true &&
      (inputs.operations?.summary?.total ?? 0) >= 2,
    '至少两个依赖恢复／降级 smoke 通过',
  ),
];

const realWorld = inputs.realWorld;
const staffChecks = [
  check(
    'production_scale',
    realWorld?.evidenceLevel === 'production' &&
      Boolean(realWorld?.productionScale?.measurementWindow) &&
      Number(realWorld?.productionScale?.requestCount) > 0 &&
      Boolean(realWorld?.productionScale?.source),
    '真实生产窗口、请求量和可追溯数据源',
  ),
  check(
    'cross_team_delivery',
    (realWorld?.crossTeam?.teams?.length ?? 0) >= 2 &&
      (realWorld?.crossTeam?.evidenceLinks?.length ?? 0) >= 2 &&
      Boolean(realWorld?.crossTeam?.measuredOutcome),
    '至少两个真实团队、两个协作证据和可量化结果',
  ),
  check(
    'online_incident_governance',
    (realWorld?.incidents ?? []).some(
      (incident) =>
        incident.realProductionIncident === true &&
        incident.postmortem &&
        incident.rootCause &&
        incident.correctiveActions?.length > 0,
    ),
    '至少一次真实线上事故的时间线、根因、复盘和改进闭环',
  ),
  check(
    'organization_leverage',
    Boolean(realWorld?.organization?.standardOrPlatform) &&
      Number(realWorld?.organization?.adoptingTeams) >= 2 &&
      Boolean(realWorld?.organization?.adoptionEvidence),
    '跨团队复用的平台／规范及采纳证据',
  ),
];

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  statement:
    '高级／资深 Agent 架构岗看真实业务、稳定性和决策深度；专家／Staff 额外看真实规模、跨团队影响和线上事故治理。',
  seniorArchitect: summarize(seniorChecks),
  staff: summarize([...seniorChecks, ...staffChecks]),
  checks: { senior: seniorChecks, staffAdditional: staffChecks },
  inputs: Object.fromEntries(
    Object.entries(inputs).map(([key, value]) => [key, Boolean(value)]),
  ),
  adrChecks,
};

await writeEvidenceReport(outputPath, report, renderMarkdown(report));
console.log(JSON.stringify(report, null, 2));
if (
  process.env.AGENT_EVIDENCE_ENFORCE === 'senior' &&
  !report.seniorArchitect.ready
) {
  process.exitCode = 1;
}
if (process.env.AGENT_EVIDENCE_ENFORCE === 'staff' && !report.staff.ready) {
  process.exitCode = 1;
}

function check(id, passed, requirement) {
  return { id, passed, requirement };
}

function summarize(checks) {
  const passed = checks.filter((item) => item.passed).length;
  return {
    ready: passed === checks.length,
    passed,
    total: checks.length,
    missing: checks.filter((item) => !item.passed).map((item) => item.id),
  };
}

async function optionalJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function renderMarkdown(report) {
  const rows = [...report.checks.senior, ...report.checks.staffAdditional]
    .map(
      (item) =>
        `| ${item.id} | ${item.passed ? '通过' : '缺失'} | ${item.requirement} |`,
    )
    .join('\n');
  return `# 高级／Staff Agent 岗位证据就绪度

- 生成时间：${report.generatedAt}
- 资深 Agent 架构岗：${report.seniorArchitect.ready ? '证据就绪' : '证据未齐'}（${report.seniorArchitect.passed}/${report.seniorArchitect.total}）
- 专家／Staff：${report.staff.ready ? '证据就绪' : '证据未齐'}（${report.staff.passed}/${report.staff.total}）

| 检查项 | 状态 | 验收标准 |
| --- | --- | --- |
${rows}

> 缺少报告时保持“缺失”，不会用模拟集或本地单次 smoke 自动补成生产证据。
`;
}
