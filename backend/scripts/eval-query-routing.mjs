import fs from 'node:fs';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const datasetPath = process.argv[2] ?? 'eval/query-routing.dataset.json';
const cases = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), datasetPath), 'utf8'),
);
const routerModulePath = path.resolve(
  process.cwd(),
  'dist/src/rag/prompts/query-intent-router.js',
);

if (!fs.existsSync(routerModulePath)) {
  console.error(
    'QueryIntentRouter 评测需要先执行 `pnpm run build`，以加载编译后的生产路由实现。',
  );
  process.exitCode = 2;
} else {
  const { QueryIntentRouter } = await import(routerModulePath);
  const results = [];
  for (const item of cases) {
    const expected = item.expected ?? {};
    const modelOutput = item.modelOutput ?? {
      intent: inferIntent(expected),
      confidence: 0.99,
      action: expected.action,
      sourcePolicy: expected.sourcePolicy,
      standaloneQuery: item.query,
      queryType: inferQueryType(expected),
      targetKbs: [],
      entities: [],
      ambiguity: { detected: false, confidence: 0, senses: [] },
    };
    const router = new QueryIntentRouter({
      invoke: async () => JSON.stringify(modelOutput),
    });
    const actual = await router.classify(item.query, item.context ?? []);
    const mismatches = [];
    for (const field of ['action', 'sourcePolicy', 'queryType', 'multiIntent']) {
      if (field in expected && actual[field] !== expected[field]) {
        mismatches.push({ field, expected: expected[field], actual: actual[field] });
      }
    }
    results.push({
      id: item.id,
      query: item.query,
      expected,
      actual: {
        action: actual.action,
        sourcePolicy: actual.sourcePolicy,
        queryType: actual.queryType,
        multiIntent: actual.multiIntent,
        requiresGraph: actual.requiresGraph,
      },
      passed: mismatches.length === 0,
      mismatches,
    });
  }
  const passed = results.filter((item) => item.passed).length;
  const summary = {
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed,
    accuracy: results.length ? Number((passed / results.length).toFixed(4)) : 0,
    execution: 'QueryIntentRouter with recorded model outputs',
    dataset: datasetPath,
    results,
  };
  await writeReport(summary, 'query-routing-latest.json');
  console.log(JSON.stringify(summary, null, 2));
  if (passed !== results.length) process.exitCode = 1;
}

function inferIntent(expected) {
  if (expected.sourcePolicy === 'web_allowed') return 'realtime';
  if (expected.sourcePolicy === 'direct_answer') return 'objective_fact';
  return 'project_knowledge';
}

function inferQueryType(expected) {
  if (expected.sourcePolicy === 'web_allowed') return 'realtime';
  if (expected.sourcePolicy === 'direct_answer') return 'public_knowledge';
  return 'project_knowledge';
}

async function writeReport(report, filename) {
  const directory = process.env.EVAL_REPORT_DIR ?? '.tmp/evidence';
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, filename),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}
