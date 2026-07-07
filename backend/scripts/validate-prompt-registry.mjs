import { existsSync, readFileSync } from 'node:fs';

const registryPath = 'src/rag/prompts/prompt-registry.ts';
const content = readFileSync(registryPath, 'utf8');
const names = [...content.matchAll(/name:\s*'([^']+)'/g)].map((match) => match[1]);
const files = [...content.matchAll(/file:\s*'([^']+)'/g)].map((match) => match[1]);
const evals = [...content.matchAll(/evals:\s*\[([\s\S]*?)\]/g)].map((match) => match[1]);

const errors = [];
if (names.length === 0) errors.push('prompt registry has no entries');
if (new Set(names).size !== names.length) errors.push('prompt registry has duplicate names');
for (const file of files) {
  if (!existsSync(file)) errors.push(`registered prompt file missing: ${file}`);
}
for (const [index, evalBlock] of evals.entries()) {
  if (!/npm run/.test(evalBlock)) {
    errors.push(`prompt entry ${names[index] ?? index} has no npm eval command`);
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

