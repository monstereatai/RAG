# 任务清单：统一 RAG 证据链重构

## T001：建立共享证据包领域模型

- 依赖：无。
- 允许文件：`backend/src/rag/evidence/evidence-bundle.ts`、`backend/src/rag/evidence/evidence-bundle.spec.ts`、`specs/003-unified-rag-evidence-chain/**`。
- 操作：定义不可变证据包及其充分性、来源策略、证据覆盖和诊断；覆盖 local-only 强约束与原查询语义门禁。
- 对应 AC：AC-01、AC-02、AC-05。
- 验证：`pnpm --dir backend exec jest src/rag/evidence/evidence-bundle.spec.ts --runInBand --env=/Users/monster/Documents/GitHub/code/RAG/node_modules/.pnpm/jest-environment-node@30.4.1/node_modules/jest-environment-node/build/index.js`。
- 完成定义：Bundle 可被服务安全构建并定向测试通过。
- 状态：done（定向测试证据见 `scope-report-T001.json`）。

## T002：Karpathy 统一证据包与回答降级

- 依赖：T001。
- 允许文件：`backend/src/rag/karpathy/karpathy-rag.service.ts`、`backend/src/rag/karpathy/karpathy-rag.service.spec.ts`、`specs/003-unified-rag-evidence-chain/**`。
- 操作：Fast Path 输出 Bundle；普通回答消费 Bundle；将无引用的原始片段回显改为可引用结构化摘要。
- 对应 AC：AC-01、AC-03、AC-05。
- 验证：`pnpm --dir backend exec jest src/rag/karpathy/karpathy-rag.service.spec.ts --runInBand --env=/Users/monster/Documents/GitHub/code/RAG/node_modules/.pnpm/jest-environment-node@30.4.1/node_modules/jest-environment-node/build/index.js`。
- 完成定义：本次新增回归用例通过，既有独立失败明确记录。
- 状态：done（定向测试证据见 `scope-report-T002.json`）。

## T003：Agentic Bundle-first 编排与联网收敛

- 依赖：T001、T002。
- 允许文件：`backend/src/rag/agentic/agentic-rag.service.ts`、`backend/src/rag/agentic/agentic-rag.service.spec.ts`、`specs/003-unified-rag-evidence-chain/**`。
- 操作：传递 Fast Path Bundle；原问题复用其充分性，不再被子问题门禁否决；只为明确多问题补检，`local_only` 永不联网。
- 对应 AC：AC-01、AC-02、AC-03、AC-05。
- 验证：`pnpm --dir backend exec jest src/rag/agentic/agentic-rag.service.spec.ts --runInBand --env=/Users/monster/Documents/GitHub/code/RAG/node_modules/.pnpm/jest-environment-node@30.4.1/node_modules/jest-environment-node/build/index.js`。
- 完成定义：预取证据、来源策略和回答回退定向测试通过。
- 状态：done（定向测试证据见 `scope-report-T003.json`）。

## T004：语义路由与评测集收敛

- 依赖：T001。
- 允许文件：`backend/src/rag/prompts/query-intent-router.ts`、`backend/src/rag/prompts/query-intent-router.spec.ts`、`backend/eval/query-routing.dataset.json`、`backend/scripts/eval-query-routing.mjs`、`specs/003-unified-rag-evidence-chain/**`。
- 操作：清除生产 Prompt 中固定业务词决策，补充结构化 Few-shot 边界样本和错误回退评测。
- 对应 AC：AC-02、AC-04、AC-05。
- 验证：`pnpm --dir backend exec jest src/rag/prompts/query-intent-router.spec.ts --runInBand --env=/Users/monster/Documents/GitHub/code/RAG/node_modules/.pnpm/jest-environment-node@30.4.1/node_modules/jest-environment-node/build/index.js`、`pnpm --dir backend eval:query-routing`。
- 完成定义：路由测试和离线评测通过。
- 状态：done（路由评测 12/12；定向测试证据见 `scope-report-T004.json`）。

## T005：集成验证、运行回放与进度收口

- 依赖：T002、T003、T004。
- 允许文件：`ROADMAP.md`、`specs/003-unified-rag-evidence-chain/**`。
- 操作：执行构建、组合单测、评测、SSE 回放与 Diff／范围检查；验证后更新 Roadmap 和 `verify.md`。
- 对应 AC：AC-01～AC-05。
- 验证：`pnpm --dir backend run build`、`git diff --check` 及 Plan 所列组合命令。
- 完成定义：所有可执行验证记录在 Verify 工件；外部依赖或既有债务单列。
- 状态：done（构建、评测、Diff 检查完成；真实 SSE 受 PostgreSQL／Redis 未启动阻塞，已记录在 Roadmap）。
