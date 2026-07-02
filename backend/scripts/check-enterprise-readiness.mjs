import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import 'dotenv/config';

const cwd = process.cwd();
const repoRoot = existsSync(join(cwd, 'backend', 'package.json'))
  ? cwd
  : basename(cwd) === 'backend'
    ? resolve(cwd, '..')
    : cwd;

const checks = [
  jsonCheck('业务毒题模拟集', 'backend/eval/private-business-regression.dataset.json', [
    ['items', 50],
  ]),
  jsonCheck('GraphRAG 模拟种子', 'backend/eval/private-graph-business.seed.json', [
    ['documents', 10],
    ['initialEntities', 5],
    ['initialRelationships', 5],
  ]),
  jsonCheck('组织权限模拟数据', 'backend/eval/private-organization.fixture.json', [
    ['departments', 5],
    ['positions', 5],
    ['users', 3],
    ['roles', 2],
    ['permissionExpectations', 3],
  ]),
  jsonCheck('多模态模拟评测集', 'backend/eval/private-multimodal.dataset.json', [
    ['documents', 5],
    ['queries', 3],
  ]),
  fileCheck('部署 Checklist', 'DEPLOYMENT_CHECKLIST.md'),
  fileCheck('一线大厂差距清单', 'docs/remaining-enhancement-plan.md'),
  fileCheck('外部工具 smoke', 'backend/scripts/smoke-external-tools.mjs'),
  fileCheck('视觉视频 readiness smoke', 'backend/scripts/smoke-vision-video-readiness.mjs'),
  fileCheck('Milvus smoke', 'backend/scripts/smoke-milvus-index.mjs'),
  fileCheck('RAG 质量门禁', 'backend/scripts/eval-rag-quality-gate.mjs'),
  fileCheck('RAG 性能基准', 'backend/scripts/benchmark-rag.mjs'),
];

const externalInputs = [
  envInput('真实 LLM/Judge key', ['QWEN_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY']),
  envInput('Bocha Web Search key', ['BOCHA_API_KEY']),
  envInput('Rerank key', ['RERANK_API_KEY', 'QWEN_API_KEY']),
  envInput('视觉/视频理解 key', ['VISION_API_KEY', 'QWEN_VL_API_KEY', 'OPENAI_API_KEY']),
  envInput('LangFuse 观测 key', ['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY']),
  manualInput('真实业务原件和毒题集'),
  manualInput('真实组织系统部门/岗位/用户/权限回显'),
  manualInput('真实 GraphRAG 实体/关系/别名/数据源'),
  manualInput('真实 Milvus/ES/Neo4j/Postgres/Redis 资源规格和压测窗口'),
  manualInput('生产目标机器、域名、证书、备份策略、监控接入方式'),
  manualInput('安全合规口径：数据分级、脱敏、保留周期、审计字段'),
];

const passed = checks.filter((item) => item.ok).length;
const missing = checks.filter((item) => !item.ok);
const unresolvedExternal = externalInputs.filter((item) => !item.ready);
const report = {
  ok: missing.length === 0,
  repoRoot,
  localChecks: {
    passed,
    total: checks.length,
    items: checks,
  },
  externalInputs: unresolvedExternal,
  nextCommands: [
    'npm run fixtures:private:check',
    'npm run eval:business-private',
    'npm run graph:import-private',
    'npm run smoke:vision-video',
    'npm run smoke:external:required',
    'npm run perf:rag',
  ],
};

console.log(JSON.stringify(report, null, 2));

if (missing.length > 0) {
  process.exitCode = 1;
}

function fileCheck(name, relativePath) {
  const absolutePath = join(repoRoot, relativePath);
  return {
    name,
    type: 'file',
    path: relativePath,
    ok: existsSync(absolutePath),
  };
}

function jsonCheck(name, relativePath, requirements) {
  const absolutePath = join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    return {
      name,
      type: 'json',
      path: relativePath,
      ok: false,
      reason: 'file missing',
    };
  }

  try {
    const json = JSON.parse(readFileSync(absolutePath, 'utf8'));
    const details = requirements.map(([key, min]) => {
      const count = countValue(json[key]);
      return { key, count, min, ok: count >= min };
    });
    return {
      name,
      type: 'json',
      path: relativePath,
      ok: details.every((item) => item.ok),
      details,
    };
  } catch (error) {
    return {
      name,
      type: 'json',
      path: relativePath,
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function envInput(name, keys) {
  return {
    name,
    type: 'env',
    keys,
    ready: keys.some((key) => Boolean(process.env[key])),
  };
}

function manualInput(name) {
  return {
    name,
    type: 'manual',
    ready: false,
  };
}

function countValue(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  if (typeof value === 'number') return value;
  return 0;
}
