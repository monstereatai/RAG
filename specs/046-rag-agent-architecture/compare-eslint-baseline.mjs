import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = process.cwd();
const files = [
  'src/rag/evidence/retrieval.types.ts',
  'src/rag/evidence/answer-quality.service.ts',
  'src/rag/evidence/deterministic-answer-builder.ts',
  'src/rag/evidence/evidence-policy.service.ts',
  'src/rag/evidence/evidence-policy.service.spec.ts',
  'src/rag/evidence/evidence.module.ts',
  'src/rag/evidence/evidence-bundle.ts',
      'src/rag/rag.module.ts',
  'src/rag/rag.service.ts',
  'src/rag/rag.service.spec.ts',
  'src/rag/agentic/agentic-rag.module.ts',
  'src/rag/agentic/agentic-rag.service.ts',
  'src/rag/agentic/agentic-rag.service.spec.ts',
];

const baseline = JSON.parse(
  readFileSync(
    path.join(
      repositoryRoot,
      'specs/046-rag-agent-architecture/eslint-baseline.json',
    ),
    'utf8',
  ),
);
const result = spawnSync(
  'pnpm',
  ['--dir', 'backend', 'exec', 'eslint', ...files, '--format', 'json'],
  { cwd: repositoryRoot, encoding: 'utf8' },
);

if (!result.stdout?.trim()) {
  process.stderr.write(result.stderr || 'ESLint returned no JSON output.\n');
  process.exit(2);
}

const current = JSON.parse(result.stdout);
const relativePath = (filePath) =>
  path.relative(repositoryRoot, path.resolve(filePath)).replaceAll('\\', '/');
const diagnosticKey = (file, message) =>
  JSON.stringify([
    relativePath(file.filePath),
    message.ruleId ?? 'unknown',
    message.severity,
    message.message,
  ]);
const counts = (reports) => {
  const entries = new Map();
  for (const file of reports) {
    for (const message of file.messages) {
      const key = diagnosticKey(file, message);
      entries.set(key, (entries.get(key) ?? 0) + 1);
    }
  }
  return entries;
};

const baselineCounts = counts(baseline);
const currentCounts = counts(current);
const introduced = [];
for (const [key, count] of currentCounts) {
  const extra = count - (baselineCounts.get(key) ?? 0);
  for (let index = 0; index < extra; index += 1) {
    introduced.push(JSON.parse(key));
  }
}

const totalErrors = (reports) =>
  reports.reduce((total, report) => total + report.errorCount, 0);

if (introduced.length > 0) {
  process.stderr.write(
    `Introduced ESLint diagnostics (${introduced.length}):\n${introduced
      .map((entry) => `${entry[0]}: ${entry[3]} [${entry[1]}]`)
      .join('\n')}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `No new ESLint diagnostics (baseline ${totalErrors(baseline)}, current ${totalErrors(current)}).\n`,
);
