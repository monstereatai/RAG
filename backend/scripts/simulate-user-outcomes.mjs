import { mkdir, writeFile } from 'node:fs/promises';

const output = process.env.USER_OUTCOME_REPORT ?? '.tmp/evidence/user-outcomes-simulation.json';
const users = Number(process.env.USER_OUTCOME_USERS ?? 50);
const queries = Number(process.env.USER_OUTCOME_QUERIES ?? 800);
const answeredQueries = Math.round(queries * 0.95);
const adoptedQueries = Math.round(answeredQueries * 0.76);
const reworkedQueries = Math.round(answeredQueries * 0.12);
const humanTakeoverQueries = Math.round(answeredQueries * 0.06);
const slaTargetMs = Number(process.env.USER_OUTCOME_SLA_MS ?? 3000);
const latencies = Array.from({ length: queries }, (_, index) => {
  const base = 850 + ((index * 137) % 1800);
  return index % 29 === 0 ? base + 2600 : base;
}).sort((a, b) => a - b);

function percentile(values, ratio) {
  if (!values.length) return 0;
  return values[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)];
}

const p50 = percentile(latencies, 0.5);
const p95 = percentile(latencies, 0.95);
const p99 = percentile(latencies, 0.99);
const savedMinutes = Math.max(0, adoptedQueries * 4.2 - humanTakeoverQueries * 1.5);
const report = {
  generatedAt: new Date().toISOString(),
  evidenceLevel: 'simulated_operational_evidence',
  simulated: true,
  inputs: { users, queries, slaTargetMs },
  metrics: {
    activeUsers: users,
    repeatUsers: Math.round(users * 0.68),
    totalQueries: queries,
    answeredQueries,
    answerRate: answeredQueries / queries,
    adoptedQueries,
    adoptionRate: adoptedQueries / answeredQueries,
    reworkedQueries,
    reworkRate: reworkedQueries / answeredQueries,
    humanTakeoverQueries,
    humanTakeoverRate: humanTakeoverQueries / answeredQueries,
    savedMinutes: Number(savedMinutes.toFixed(1)),
    savedHours: Number((savedMinutes / 60).toFixed(2)),
    latencyMs: { p50, p95, p99 },
    sla: {
      targetMs: slaTargetMs,
      p95Pass: p95 <= slaTargetMs,
      withinTargetRate: latencies.filter((value) => value <= slaTargetMs).length / latencies.length,
    },
  },
  interpretation:
    '该报告只证明指标采集、计算和 SLA 门禁链路可运行，不代表真实用户采纳或生产 SLA。',
};

if (report.metrics.adoptionRate <= 0 || report.metrics.latencyMs.p95 <= 0) {
  throw new Error('user outcome simulation produced invalid metrics');
}

await mkdir(output.substring(0, output.lastIndexOf('/')) || '.', { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, reportPath: output }, null, 2));
