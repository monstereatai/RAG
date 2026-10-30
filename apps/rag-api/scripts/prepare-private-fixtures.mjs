/**
 *
    {
      sourceId: "private-graph-tech-stack",
      title: "技术栈关系",
      text: "NestJS 用 TypeORM 连 PostgreSQL。Milvus 向量检索。Redis 缓存+BullMQ 队列。ES 全文检索。前端 React 调 REST API。",
      query: "NestJS 使用了哪些技术栈？",
    },
    {
      sourceId: "private-graph-ci-cd",
      title: "CI/CD 流程",
      text: "GitHub Actions 执行 CI。Lint → TypeCheck → Test → Build → E2E。合并 main 后自动部署 staging。Nginx 反向代理。",
      query: "CI/CD 流程包含哪些步骤？",
    },
    {
      sourceId: "private-graph-security",
      title: "安全防护",
      text: "CSP 防 XSS。SameSite 防 CSRF。参数化查询防 SQL 注入。JWT+Refresh 认证。bcrypt 哈希。X-Frame-Options 防点击劫持。",
      query: "Web 安全体系有哪些防护措施？",
    },
    {
      sourceId: "private-graph-perf",
      title: "性能优化",
      text: "React.lazy 代码分割。WebP 图片 CDN。Brotli 压缩。Performance Observer 采集 Web Vitals。退化超 10% 阻断发布。",
      query: "前端性能优化涉及哪些技术？",
    },
    {
      sourceId: "private-graph-deploy",
      title: "部署架构",
      text: "Docker 多阶段构建。Compose 编排服务。healthcheck 检查。数据卷持久化 PG/Redis。Nginx 代理前端和 API。",
      query: "Docker 部署包含哪些组件？",
    }, prepare-private-fixtures.mjs
 *
 * 生成脱敏的私有企业模拟数据集，用于本地严格校验和端到端评测链路验证。
 * 所有数据均为通用行业模拟，不包含任何真实公司私密信息。
 *
 * 替代真实私密样本时保持同一 schema，仅替换 content/text 字段。
 *
 * 用法:
 *   node scripts/prepare-private-fixtures.mjs         # 生成所有 fixture
 *   node scripts/prepare-private-fixtures.mjs --check  # 仅校验现有 fixture
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildDocumentFiles } from './private-fixtures/documents.mjs';
import { makeBusinessDataset, makeMultimodalDataset } from './private-fixtures/datasets.mjs';
import { syntheticProvenance } from './private-fixtures/common.mjs';
import { makeGraphSeed } from './private-fixtures/graph-seed.mjs';
import { makeOrganizationFixture } from './private-fixtures/organization.mjs';
import { makeMinimalMp4, makeMinimalPng, makeSilentWav } from './private-fixtures/media.mjs';

const rootDir = resolve(new URL('..', import.meta.url).pathname);
const fixturesDir = resolve(rootDir, 'eval/private-fixtures');
const docsDir = resolve(fixturesDir, 'documents');
const mediaDir = resolve(fixturesDir, 'media');
const checkOnly = process.argv.includes('--check');

const files = {
  businessDataset: resolve(rootDir, 'eval/private-business-regression.dataset.json'),
  multimodalDataset: resolve(rootDir, 'eval/private-multimodal.dataset.json'),
  graphSeed: resolve(rootDir, 'eval/private-graph-business.seed.json'),
  organization: resolve(rootDir, 'eval/private-organization.fixture.json'),
  manifest: resolve(fixturesDir, 'manifest.json'),
};

if (checkOnly) {
  await checkFixtures();
} else {
  await prepareFixtures();
}

/* ================================================================
 *  Fixture preparation
 * ================================================================ */

async function prepareFixtures() {
  await mkdir(docsDir, { recursive: true });
  await mkdir(mediaDir, { recursive: true });

  const documentFiles = buildDocumentFiles();
  for (const [filename, content] of Object.entries(documentFiles)) {
    await writeFile(resolve(docsDir, filename), content);
  }

  await writeFile(resolve(mediaDir, 'meeting-action-items.wav'), makeSilentWav(1));
  await writeFile(resolve(mediaDir, 'dashboard-screenshot.png'), makeMinimalPng());
  await writeFile(resolve(mediaDir, 'approval-training.mp4'), makeMinimalMp4());

  await writeFile(files.businessDataset, JSON.stringify(makeBusinessDataset(), null, 2) + '\n');
  await writeFile(files.multimodalDataset, JSON.stringify(makeMultimodalDataset(), null, 2) + '\n');
  await writeFile(files.graphSeed, JSON.stringify(makeGraphSeed(), null, 2) + '\n');
  await writeFile(files.organization, JSON.stringify(makeOrganizationFixture(), null, 2) + '\n');
  await writeFile(
    files.manifest,
    JSON.stringify(makeFixtureManifest(Object.keys(documentFiles)), null, 2) + '\n',
  );

  await checkFixtures();
}

/* ================================================================
 *  Document file builders
 * ================================================================ */



/* ================================================================
 *  Business regression dataset (50 → 120+ items)
 * ================================================================ */



/* ================================================================
 *  Domain definitions
 * ================================================================ */



/* ================================================================
 *  Multimodal dataset
 * ================================================================ */



/* ================================================================
 *  GraphRAG seed (5 → 10 documents with richer entities)
 * ================================================================ */



/* ================================================================
 *  Organization fixture (expanded tree)
 * ================================================================ */



function makeFixtureManifest(documentFiles) {
  const generatedFiles = [
    'eval/private-business-regression.dataset.json',
    'eval/private-multimodal.dataset.json',
    'eval/private-graph-business.seed.json',
    'eval/private-organization.fixture.json',
    ...documentFiles.map((filename) => `eval/private-fixtures/documents/${filename}`),
    'eval/private-fixtures/media/meeting-action-items.wav',
    'eval/private-fixtures/media/dashboard-screenshot.png',
    'eval/private-fixtures/media/approval-training.mp4',
  ];

  return {
    version: 'private-fixture-manifest-1',
    synthetic: true,
    provenance: syntheticProvenance(),
    outputs: generatedFiles,
  };
}

/* ================================================================
 *  Validation
 * ================================================================ */

async function checkFixtures() {
  const docFiles = Object.keys(buildDocumentFiles());
  const required = [
    files.businessDataset,
    files.multimodalDataset,
    files.graphSeed,
    files.organization,
    files.manifest,
    ...docFiles.map((name) => resolve(docsDir, name)),
    resolve(mediaDir, 'meeting-action-items.wav'),
    resolve(mediaDir, 'dashboard-screenshot.png'),
    resolve(mediaDir, 'approval-training.mp4'),
  ];

  const missing = [];
  for (const file of required) {
    try {
      await readFile(file);
    } catch {
      missing.push(file);
    }
  }

  const business = JSON.parse(await readFile(files.businessDataset, 'utf8'));
  const multimodal = JSON.parse(await readFile(files.multimodalDataset, 'utf8'));
  const graph = JSON.parse(await readFile(files.graphSeed, 'utf8'));
  const organization = JSON.parse(await readFile(files.organization, 'utf8'));
  const manifest = JSON.parse(await readFile(files.manifest, 'utf8'));

  const businessItems = business.items ?? [];
  const multimodalDocs = multimodal.documents ?? [];
  const graphDocs = graph.documents ?? [];
  const departments = organization.departments ?? [];
  const graphSchemaReady =
    Array.isArray(graph.schema?.entityTypes) &&
    graph.schema.entityTypes.length >= 8 &&
    Array.isArray(graph.schema?.relationshipTypes) &&
    graph.schema.relationshipTypes.length >= 8 &&
    Array.isArray(graph.aliasRules ?? graph.schema?.aliasRules);
  const organizationRulesReady =
    Array.isArray(organization.inheritanceRules) &&
    organization.inheritanceRules.length >= 4 &&
    Array.isArray(organization.permissionEchoSamples) &&
    organization.permissionEchoSamples.length >= 3;
  const generatedDatasets = [business, multimodal, graph, organization];
  const provenanceReady = generatedDatasets.every(
    (dataset) =>
      dataset.synthetic === true &&
      dataset.provenance?.kind === 'synthetic_fixture' &&
      dataset.provenance?.generator === 'scripts/prepare-private-fixtures.mjs' &&
      dataset.provenance?.containsRealBusinessData === false,
  );
  const expectedManifestOutputs = makeFixtureManifest(docFiles).outputs;
  const manifestReady =
    manifest.synthetic === true &&
    manifest.provenance?.kind === 'synthetic_fixture' &&
    manifest.provenance?.containsRealBusinessData === false &&
    Array.isArray(manifest.outputs) &&
    manifest.outputs.length === expectedManifestOutputs.length &&
    expectedManifestOutputs.every((path) => manifest.outputs.includes(path));

  // Validate enhanced dataset expectations
  const hasConflict = businessItems.some((i) => i.expectConflictHandling);
  const hasRefusal = businessItems.some((i) => i.expectRefusal);
  const hasCrossDept = businessItems.some((i) => i.crossDepartment);

  const report = {
    ok:
      missing.length === 0 &&
      businessItems.length >= 130 &&
      multimodalDocs.length >= 18 &&
      graphDocs.length >= 15 &&
      graphSchemaReady &&
      departments.length >= 18 &&
      organizationRulesReady &&
      provenanceReady &&
      manifestReady &&
      hasConflict &&
      hasRefusal &&
      hasCrossDept,
    mode: checkOnly ? 'check' : 'prepare',
    fixturesDir,
    businessCases: businessItems.length,
    multimodalDocuments: multimodalDocs.length,
    graphDocuments: graphDocs.length,
    graphSchemaReady,
    departments: departments.length,
    organizationRulesReady,
    provenanceReady,
    manifestReady,
    hasConflictScenarios: hasConflict,
    hasRefusalScenarios: hasRefusal,
    hasCrossDepartmentScenarios: hasCrossDept,
    missing,
  };

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

/* ================================================================
 *  Minimal media file generators (same as before)
 * ================================================================ */
