# 任务清单：业务黄金评测集与三链路证据一致性

## T001：建立业务黄金评测集和回放门禁

- 依赖：无
- 允许文件：`backend/eval/golden-business.dataset.json`、`backend/scripts/eval-golden-business.mjs`、`backend/package.json`、`.github/workflows/quality-gate.yml`、`specs/045-golden-evidence-consistency/**`
- 操作：整理 84 条案例索引与覆盖维度；实现离线 schema／覆盖校验和可选 `/api/v1/chat` 三模式回放；接入 npm 与 CI。
- 对应 AC：AC-01、AC-02
- 验证：`cd backend && npm run eval:golden-business`
- 状态机验证命令：`add-task --command 'cd backend && npm run eval:golden-business'`
- 范围基线：`specs/045-golden-evidence-consistency/scope-baseline-T001.json`
- 范围报告：`specs/045-golden-evidence-consistency/scope-report-T001.json`
- 完成定义：离线命令通过，报告包含 84 条案例、六类覆盖、来源和路由字段；live 依赖不可用时明确 skipped／blocked。
- 状态：pending
- 证据 ID：`T001-golden`

## T002：统一 RRF／Rerank 证据排序与生成兜底

- 依赖：T001
- 允许文件：`backend/src/rag/karpathy/karpathy-rag.service.ts`、`backend/src/rag/agentic/agentic-rag.service.ts`、`backend/src/rag/karpathy/karpathy-rag.service.spec.ts`、`backend/src/rag/agentic/agentic-rag.service.spec.ts`、`specs/045-golden-evidence-consistency/**`
- 操作：新增统一候选排序比较器；Agentic 汇合改用 Rerank 优先排序；抽取固定证据生成／引用修复／受约束总结能力供 Agentic 复用；保留安全降级。
- 对应 AC：AC-03、AC-04
- 验证：`cd backend && npm test -- --runInBand src/rag/karpathy/karpathy-rag.service.spec.ts src/rag/agentic/agentic-rag.service.spec.ts`
- 状态机验证命令：`add-task --command 'cd backend && npm test -- --runInBand src/rag/karpathy/karpathy-rag.service.spec.ts src/rag/agentic/agentic-rag.service.spec.ts'`
- 范围基线：`specs/045-golden-evidence-consistency/scope-baseline-T002.json`
- 范围报告：`specs/045-golden-evidence-consistency/scope-report-T002.json`
- 完成定义：带 Rerank 分的候选在 Agentic 汇合后保持 Rerank 顺序；三链路引用失败都经过同一证据兜底和门禁。
- 状态：pending
- 证据 ID：`T002-unit`、`T002-citation`

## T003：三模式集成验证与文档收口

- 依赖：T001、T002
- 允许文件：`backend/src/test/chat-modes.integration.spec.ts`、`docs/architecture/AGENT_PLATFORM_READINESS.md`、`ROADMAP.md`、`specs/045-golden-evidence-consistency/**`
- 操作：补三模式输出契约测试，执行构建和既有平台门禁，记录真实依赖限制与黄金集状态。
- 对应 AC：AC-05
- 验证：`cd backend && npm test -- --runInBand src/test/chat-modes.integration.spec.ts && npm run build && npm run eval:agent-platform`
- 状态机验证命令：`add-task --command 'cd backend && npm test -- --runInBand src/test/chat-modes.integration.spec.ts && npm run build && npm run eval:agent-platform'`
- 范围基线：`specs/045-golden-evidence-consistency/scope-baseline-T003.json`
- 范围报告：`specs/045-golden-evidence-consistency/scope-report-T003.json`
- 完成定义：三模式集成、构建和既有确定性平台门禁通过；文档明确黄金集是脱敏基线，未伪报生产准确率。
- 状态：pending
- 证据 ID：`T003-integration`、`T003-build`、`T003-platform`
