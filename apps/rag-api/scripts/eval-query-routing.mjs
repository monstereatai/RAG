import fs from 'node:fs';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const datasetPath = process.argv[2] ?? 'eval/query-routing.dataset.json';
const cases = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), datasetPath), 'utf8'),
);
const plannerModulePath = path.resolve(
  process.cwd(),
  'dist/src/rag/planning/query-planner.service.js',
);
const policyModulePath = path.resolve(
  process.cwd(),
  'dist/src/rag/planning/retrieval-policy.service.js',
);

if (!fs.existsSync(plannerModulePath) || !fs.existsSync(policyModulePath)) {
  console.error(
    'QueryPlan 评测需要先执行 `npm run build`，以加载编译后的生产实现。',
  );
  process.exitCode = 2;
} else {
  const { QueryPlannerService } = await import(plannerModulePath);
  const { RetrievalPolicyService } = await import(policyModulePath);
  const policy = new RetrievalPolicyService();
  const results = [];

  for (const item of cases) {
    const planner = new QueryPlannerService({
      invoke: async () => JSON.stringify(item.modelOutput),
      getActiveProviderName: () => 'qwen',
      getFallbackProviderName: () => null,
      getRoutePolicy: () => ({ maxTokens: 2048 }),
    });
    const plan = await planner.plan(item.query, item.context ?? []);
    const executionPlan = policy.build(item.query, plan, item.scope);
    const actual = {
      action: plan.action,
      domain: plan.domain,
      contextMode: plan.contextMode,
      taskType: plan.taskType,
      subQueries: plan.subQueries,
      needsGraph: plan.needsGraph,
      sourcePolicy: executionPlan.sourcePolicy,
      queries: executionPlan.queries.map((query) => query.text),
      useGraph: executionPlan.useGraph,
    };
    const mismatches = [];

    for (const [field, expected] of Object.entries(item.expected ?? {})) {
      if (JSON.stringify(actual[field]) !== JSON.stringify(expected)) {
        mismatches.push({ field, expected, actual: actual[field] });
      }
    }

    // sourcePolicy 和 targetKbs 不属于模型计划字段；未知字段也不应被保留。
    if ('sourcePolicy' in plan || 'targetKbs' in plan) {
      mismatches.push({
        field: 'modelCannotSetAccessPolicy',
        expected: 'sourcePolicy/targetKbs absent from QueryPlan',
        actual: { sourcePolicy: plan.sourcePolicy, targetKbs: plan.targetKbs },
      });
    }

    results.push({
      id: item.id,
      query: item.query,
      expected: item.expected,
      actual,
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
    execution:
      'QueryPlannerService contract + RetrievalPolicyService with recorded plans',
    dataset: datasetPath,
    results,
  };
  await writeReport(summary, 'query-routing-latest.json');
  console.log(JSON.stringify(summary, null, 2));
  if (passed !== results.length) process.exitCode = 1;
}

async function writeReport(report, filename) {
  const directory = process.env.EVAL_REPORT_DIR ?? '.tmp/evidence';
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, filename),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}
