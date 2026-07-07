import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const threshold = Number(process.env.RAG_MATURITY_MIN_SCORE ?? '90');
const requireExternal = process.env.RAG_MATURITY_REQUIRE_EXTERNAL === 'true';
const productionMaterialsConfirmed =
  process.env.RAG_PRODUCTION_MATERIALS_CONFIRMED === 'true';

const cwd = process.cwd();
const workspaceRoot = existsSync(join(cwd, 'ROADMAP.md')) ? cwd : join(cwd, '..');
const backendRoot =
  existsSync(join(cwd, 'package.json')) && existsSync(join(cwd, 'src'))
    ? cwd
    : join(cwd, 'backend');
const evidence = loadEvidence();
const dimensions = scoreDimensions(evidence);
const score = dimensions.reduce((sum, item) => sum + item.score, 0);
const maxScore = dimensions.reduce((sum, item) => sum + item.maxScore, 0);
const blockers = collectBlockers(evidence, requireExternal);
const passed = score >= threshold && blockers.every((item) => !item.blocksGate);

const result = {
  passed,
  score,
  maxScore,
  threshold,
  requireExternal,
  grade: score >= 90 ? 'local-enterprise-90' : 'below-local-enterprise-90',
  dimensions,
  blockers,
};

console.log(JSON.stringify(result, null, 2));

if (!passed) {
  process.exitCode = 1;
}

function loadEvidence() {
  const roadmap = readWorkspaceText('ROADMAP.md');
  const packageJson = readBackendJson('package.json');
  const smokeDataset = readBackendJson('eval/rag-smoke.dataset.json');
  const businessDataset = readBackendJson('eval/business-regression.dataset.json');
  const projectDataset = readBackendJson(
    'eval/project-simulated-business.dataset.json',
  );
  const privateBusinessDataset = readBackendJson(
    'eval/private-business-regression.dataset.json',
  );
  const configurationText = readText('src/config/configuration.ts');
  const chunkEntityText = readText(
    'src/providers/db/entities/document-chunk.entity.ts',
  );
  const factConflictEntityText = readText(
    'src/providers/db/entities/fact-conflict.entity.ts',
  );
  const jobsServiceText = readText('src/modules/jobs/jobs.service.ts');
  const karpathyRagText = readText('src/rag/karpathy/karpathy-rag.service.ts');
  const milvusProviderText = readText(
    'src/providers/vector-store/milvus.vector-store.ts',
  );
  const deploymentChecklist = readWorkspaceText('DEPLOYMENT_CHECKLIST.md');
  const remainingEnhancementPlan = readWorkspaceText(
    'docs/remaining-enhancement-plan.md',
  );
  const businessItems = Array.isArray(businessDataset?.items)
    ? businessDataset.items
    : [];
  const privateBusinessItems = Array.isArray(privateBusinessDataset?.items)
    ? privateBusinessDataset.items
    : [];
  const projectQueries = Array.isArray(projectDataset?.queries)
    ? projectDataset.queries
    : [];

  return {
    roadmap,
    packageJson,
    smokeItems: Array.isArray(smokeDataset) ? smokeDataset : [],
    businessItems,
    projectQueries,
    hasBusinessDataset: businessItems.length >= 100,
    hasProjectBusinessDataset:
      Array.isArray(projectDataset?.documents) &&
      projectDataset.documents.length >= 5 &&
      projectQueries.length >= 10 &&
      projectQueries.some((item) => item.expectRefusal === true) &&
      projectQueries.some((item) => item.expectConflictHandling === true),
    hasPrivateBusinessDataset: privateBusinessItems.length >= 50,
    hasMilvusRuntimeGovernance:
      exists('scripts/smoke-milvus-index.mjs') &&
      milvusProviderText.includes('getRuntimeStatus') &&
      milvusProviderText.includes('circuitFailureThreshold') &&
      milvusProviderText.includes('searchTimeoutMs'),
    hasSupervisorScheduledJobs:
      jobsServiceText.includes('SupervisorService') &&
      jobsServiceText.includes('this.supervisorService.query'),
    hasClaimLevelCitation:
      karpathyRagText.includes('validateClaimCitationSupport') ||
      karpathyRagText.includes('关键结论引用支撑不足'),
    hasStructuredSourceSpan:
      chunkEntityText.includes('sourceStart') &&
      chunkEntityText.includes('sourceEnd') &&
      chunkEntityText.includes('parentChunkId'),
    hasFactConflictGovernance:
      factConflictEntityText.includes("@Entity('fact_conflicts')") &&
      factConflictEntityText.includes('conflictingValue') &&
      readText('src/modules/document/document.service.ts').includes(
        'detectAndSaveFactConflicts',
      ),
    hasProductionReadinessEntry:
      exists('scripts/check-enterprise-readiness.mjs') &&
      deploymentChecklist.includes('生产部署 Checklist') &&
      remainingEnhancementPlan.includes('企业级 readiness 汇总'),
    files: {
      qualityGate: exists('scripts/eval-rag-quality-gate.mjs'),
      e2eEval: exists('scripts/eval-rag-e2e.mjs'),
      projectEval: exists('scripts/eval-rag-project.mjs'),
      judgeEval: exists('scripts/eval-rag-judge.mjs'),
      hybridSmoke: exists('scripts/smoke-hybrid-quality.mjs'),
      graphSmoke: exists('scripts/smoke-graph.mjs'),
      redisSmoke: exists('scripts/smoke-redis-checkpointer.mjs'),
      speechSmoke: exists('scripts/smoke-speech.mjs'),
      externalSmoke: exists('scripts/smoke-external-tools.mjs'),
      milvusSmoke: exists('scripts/smoke-milvus-index.mjs'),
      documentChunksEntity: exists(
        'src/providers/db/entities/document-chunk.entity.ts',
      ),
      factConflictEntity: exists(
        'src/providers/db/entities/fact-conflict.entity.ts',
      ),
      rolesGuard: exists('src/common/guards/roles.guard.ts'),
      agenticBudget: configurationText.includes('maxAugmentedQueries'),
    },
  };
}

function scoreDimensions(evidence) {
  const scripts = evidence.packageJson?.scripts ?? {};
  return [
    dimension('查得准', 15, [
      check(
        'hybrid retrieval 有中文质量回归',
        evidence.files.hybridSmoke && Boolean(scripts['smoke:hybrid']),
        5,
      ),
      check(
        '业务回归集达到 100+ 条',
        evidence.hasBusinessDataset,
        3,
        `${evidence.businessItems.length} cases`,
      ),
      check(
        '项目级仿真实业务评测集覆盖复杂场景',
        evidence.hasProjectBusinessDataset && Boolean(scripts['eval:rag:project']),
        2,
        `${evidence.projectQueries.length} project queries`,
      ),
      check(
        'GraphRAG smoke 与业务种子入口存在',
        evidence.files.graphSmoke && Boolean(scripts['smoke:graph']),
        2,
      ),
      check(
        'Milvus 诊断入口存在，慢向量可被识别并降级',
        evidence.hasMilvusRuntimeGovernance,
        3,
      ),
    ]),
    dimension('答得稳', 15, [
      check(
        '稳定质量门禁存在',
        evidence.files.qualityGate &&
          Boolean(scripts['eval:rag:quality']) &&
          readText('scripts/eval-rag-quality-gate.mjs').includes(
            'eval-rag-project.mjs',
          ),
        5,
      ),
      check('真实服务 e2e 回放入口存在', evidence.files.e2eEval, 4),
      check('Agentic 成本边界可配置', evidence.files.agenticBudget, 4),
      check('定时任务复用 Supervisor 执行', evidence.hasSupervisorScheduledJobs, 2),
    ]),
    dimension('引用能撑住', 15, [
      check(
        'claim-level 引用支撑校验已记录',
        evidence.hasClaimLevelCitation,
        5,
      ),
      check(
        'smoke dataset 包含 expectedClaims',
        evidence.smokeItems.some((item) => Array.isArray(item.expectedClaims)),
        3,
      ),
      check(
        '业务回归集包含引用要求',
        evidence.businessItems.some((item) => item.requireCitation === true),
        2,
      ),
      check(
        '项目级评测包含引用强制问题',
        evidence.projectQueries.some((item) => item.requireCitation === true),
        1,
      ),
      check(
        '结构化 chunk/source span 已落地',
        evidence.files.documentChunksEntity && evidence.hasStructuredSourceSpan,
        4,
      ),
    ]),
    dimension('不会瞎编', 15, [
      check(
        '无答案拒答样本存在',
        evidence.smokeItems.some((item) => item.expectRefusal === true) ||
          evidence.businessItems.some((item) => item.expectRefusal === true) ||
          evidence.projectQueries.some((item) => item.expectRefusal === true),
        4,
      ),
      check('LLM-as-Judge 入口存在', evidence.files.judgeEval, 3),
      check(
        '事实冲突表与冲突处理记录存在',
        evidence.files.factConflictEntity && evidence.hasFactConflictGovernance,
        4,
      ),
      check(
        '联网增强严格 smoke 可强制失败',
        Boolean(scripts['smoke:external:required']) && evidence.files.externalSmoke,
        2,
      ),
      check('低相关/引用缺失拒答策略已记录', evidence.roadmap.includes('低相关'), 2),
    ]),
    dimension('可观测与恢复', 10, [
      check('Redis Checkpointer 跨进程 smoke 存在', evidence.files.redisSmoke, 3),
      check('Speech 真实 smoke 存在', evidence.files.speechSmoke, 2),
      check('Prometheus 业务指标已记录', evidence.roadmap.includes('rag_llm_calls_total'), 3),
      check('RBAC 基础角色守卫存在', evidence.files.rolesGuard, 2),
    ]),
    dimension('工程化门禁', 10, [
      check('build script 存在', Boolean(scripts.build), 2),
      check('lint script 存在', Boolean(scripts.lint), 2),
      check('test script 存在', Boolean(scripts.test), 2),
      check('business dataset gate 存在', Boolean(scripts['eval:business-dataset']), 2),
      check('quality gate 集成 maturity', readText('scripts/eval-rag-quality-gate.mjs').includes('eval-rag-maturity.mjs'), 2),
    ]),
    dimension('真实落地准备', 20, [
      check('真实业务评测导入入口存在', Boolean(scripts['eval:business-import']), 4),
      check('业务 MCP 配置校验入口存在', Boolean(scripts['mcp:validate']), 3),
      check('GraphRAG 业务种子导入入口存在', Boolean(scripts['graph:import-business']), 3),
      check('生产就绪检查入口已记录', evidence.hasProductionReadinessEntry, 3),
      check('真实私有业务评测集已接入', evidence.hasPrivateBusinessDataset, 3),
      check(
        'Milvus search runtime 无降级缺口',
        !evidence.roadmap.includes('DEADLINE_EXCEEDED'),
        2,
      ),
      check(
        '生产目标机器/证书/备份策略已确认',
        productionMaterialsConfirmed,
        2,
      ),
    ]),
  ];
}

function dimension(name, maxScore, checks) {
  const score = checks.reduce((sum, item) => sum + item.score, 0);
  return { name, score, maxScore, checks };
}

function check(name, passed, points, detail) {
  return {
    name,
    passed: Boolean(passed),
    score: passed ? points : 0,
    maxScore: points,
    ...(detail ? { detail } : {}),
  };
}

function collectBlockers(evidence, requireExternal) {
  return [
    {
      name: '真实私有业务评测集',
      status: evidence.hasPrivateBusinessDataset ? 'ready' : 'missing',
      blocksGate: requireExternal && !evidence.hasPrivateBusinessDataset,
      note: '默认门禁只评价本地工程成熟度；开启 RAG_MATURITY_REQUIRE_EXTERNAL=true 后必须提供私有真实题集。',
    },
    {
      name: 'Milvus search runtime',
      status: evidence.roadmap.includes('DEADLINE_EXCEEDED') ? 'degraded' : 'unknown',
      blocksGate: false,
      note: '当前主链路可降级 BM25；collection 压实/重建或容器升级仍属于需单独确认的运行环境治理。',
    },
    {
      name: '生产发布材料',
      status: productionMaterialsConfirmed ? 'ready' : 'missing',
      blocksGate: requireExternal && !productionMaterialsConfirmed,
      note: '生产部署、证书、备份、密钥注入策略需要显式确认；可用 RAG_PRODUCTION_MATERIALS_CONFIRMED=true 纳入本地门禁。',
    },
  ];
}

function readText(relativePath) {
  const path = join(backendRoot, relativePath);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function readWorkspaceText(relativePath) {
  const path = join(workspaceRoot, relativePath);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function readJson(raw) {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function readBackendJson(relativePath) {
  return readJson(readText(relativePath));
}

function exists(relativePath) {
  return existsSync(join(backendRoot, relativePath));
}
