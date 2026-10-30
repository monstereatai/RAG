import { existsSync, readFileSync } from 'node:fs';

const registryPath = 'src/rag/prompts/prompt-registry.ts';
const content = readFileSync(registryPath, 'utf8');
const entries = [...content.matchAll(/\{\s*name:\s*'([^']+)'([\s\S]*?)\n  \},/g)].map(
  ([, name, body]) => ({ name, body }),
);
const names = entries.map((entry) => entry.name);

const errors = [];
if (names.length === 0) errors.push('prompt registry has no entries');
if (new Set(names).size !== names.length) errors.push('prompt registry has duplicate names');
for (const { name, body } of entries) {
  const file = body.match(/file:\s*'([^']+)'/)?.[1];
  const evalBlock = body.match(/evals:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
  const hasOfflineEval = /npm run/.test(evalBlock);
  const hasExplicitNoOfflineEvalNote =
    /evaluationNote:\s*'暂无专用离线质量评测/.test(body);

  if (!file || !existsSync(file)) {
    errors.push(`prompt entry ${name} has a missing registered prompt file`);
  }
  if (!hasOfflineEval && !hasExplicitNoOfflineEvalNote) {
    errors.push(
      `prompt entry ${name} needs an npm eval command or an explicit no-offline-eval note`,
    );
  }
}

const report = {
  ok: errors.length === 0,
  registry: registryPath,
  count: names.length,
  names,
  errors,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;

