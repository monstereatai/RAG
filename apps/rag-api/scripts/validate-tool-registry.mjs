import { readFileSync } from 'node:fs';

const registryPath = 'src/tools/tool-registry.ts';
const content = readFileSync(registryPath, 'utf8');
const entries = [...content.matchAll(/name:\s*'([^']+)'[\s\S]*?fallback:\s*'([^']+)'/g)].map(
  (match) => ({ name: match[1], fallback: match[2] }),
);
const names = entries.map((entry) => entry.name);
const errors = [];

if (entries.length === 0) errors.push('tool registry has no entries');
if (new Set(names).size !== names.length) errors.push('tool registry has duplicate names');
for (const entry of entries) {
  if (!entry.fallback || entry.fallback.length < 8) {
    errors.push(`${entry.name} has no meaningful fallback`);
  }
}
for (const required of ['bocha_web_search', 'dashscope_rerank', 'graph_search_tool', 'mcp_tools']) {
  if (!names.includes(required)) errors.push(`missing required tool: ${required}`);
}

const report = {
  ok: errors.length === 0,
  registry: registryPath,
  count: entries.length,
  names,
  errors,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;

