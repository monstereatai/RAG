import { readFile } from 'node:fs/promises';

const checks = [
  {
    name: 'chat-orchestration-doc',
    doc: '../../../docs/interview/功能步骤流程.md',
    source: [
      'src/modules/chat/chat.service.ts',
      'src/rag/planning/query-planner.service.ts',
      'src/rag/planning/retrieval-policy.service.ts',
      'src/rag/evidence/evidence-bundle.ts',
      'src/rag/agentic/agentic-rag.service.ts',
      'src/modules/agui/agui.types.ts',
    ],
    terms: [
      'RequestContext',
      'QueryPlan',
      'EvidenceBundle',
      'approvalPending',
      'RUN_INTERRUPTED',
    ],
  },
  {
    name: 'workflow-handoff-doc',
    doc: '../../../docs/interview/功能步骤流程.md',
    source: [
      'src/modules/workflow/production-workflow.service.ts',
      'src/modules/workflow/production-workflow-queue.service.ts',
    ],
    terms: ['BullMQ', '交接包', 'MCP', 'pending_approval', 'revision_required'],
  },
  {
    name: 'readiness-boundary-doc',
    doc: '../../../docs/AGENT_RUNTIME.md',
    source: [
      'scripts/eval-agent-platform.mjs',
      'scripts/eval-rag-e2e.mjs',
      'scripts/eval-bad-case-regression.mjs',
      'scripts/eval-query-routing.mjs',
    ],
    terms: [
      'AGENT_PLATFORM_REQUIRE_LIVE',
      'skipped',
      'QueryPlannerService',
      'datasetHash',
    ],
  },
];

const missing = [];
for (const check of checks) {
  const doc = await readFile(new URL(check.doc, import.meta.url), 'utf8');
  const sources = await Promise.all(
    check.source.map((file) =>
      readFile(new URL(`../${file}`, import.meta.url), 'utf8'),
    ),
  );
  for (const term of check.terms) {
    if (!doc.includes(term)) missing.push(`${check.name}: doc missing ${term}`);
    if (!sources.some((source) => source.includes(term))) {
      missing.push(`${check.name}: source missing ${term}`);
    }
  }
}

const report = {
  ok: missing.length === 0,
  checks: checks.map((item) => item.name),
  missing,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
