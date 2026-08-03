import { spawnSync } from 'node:child_process';

const judgeRequired = process.env.EVAL_RAG_JUDGE_REQUIRED === 'true';

run('node', ['scripts/eval-rag.mjs'], { inherit: true });
run('node', ['scripts/build-business-regression-dataset.mjs', '--check'], {
  inherit: true,
});
run('node', ['scripts/eval-rag-project.mjs'], { inherit: true });
run('node', ['scripts/eval-rag-maturity.mjs'], { inherit: true });
run('node', ['scripts/eval-agent-task-metrics.mjs'], { inherit: true });
run('node', ['scripts/eval-production-workflow.mjs'], { inherit: true });

if (judgeRequired) {
  const judge = run('node', ['scripts/eval-rag-judge.mjs'], { inherit: false });
  process.stdout.write(judge.stdout);
  process.stderr.write(judge.stderr);

  const parsed = parseJson(judge.stdout);
  if (!parsed || parsed.skipped || parsed.ok !== true) {
    console.error(
      'LLM-as-Judge gate failed. Set QWEN_API_KEY and ensure supportedRate meets EVAL_RAG_JUDGE_MIN_SUPPORTED_RATE.',
    );
    process.exit(1);
  }
} else {
  console.log(
    JSON.stringify(
      {
        ok: true,
        judgeRequired: false,
        judgeSkipped: true,
        reason: 'Set EVAL_RAG_JUDGE_REQUIRED=true to enforce LLM-as-Judge.',
      },
      null,
      2,
    ),
  );
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
