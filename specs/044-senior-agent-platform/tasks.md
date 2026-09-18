# 任务清单：高级 Agent 平台能力补齐

## T001：补齐 Agent Runtime 取消、恢复和状态持久化

- 依赖：无
- 允许文件：`backend/src/providers/db/entities/agent-run.entity.ts`、`backend/src/migrations/1787800000000-AddAgentRuntimeControls.ts`、`backend/src/modules/agent-runs/agent-runs.service.ts`、`backend/src/modules/agent-ops-admin/agent-ops-admin.controller.ts`、`backend/src/modules/agent-loop/agent-loop.types.ts`、`backend/src/modules/agent-loop/agent-loop.service.ts`、`backend/src/modules/agent-loop/agent-loop.service.spec.ts`、`backend/src/modules/agent-runs/agent-runs.service.spec.ts`
- 操作：增加取消状态和 API，Agent Loop 在每轮执行前检查取消标记；补充终态保护、恢复预算和幂等回归。
- 对应 AC：AC-01、AC-02
- 验证：`cd backend && npm test -- --runInBand src/modules/agent-loop/agent-loop.service.spec.ts src/modules/agent-runs/agent-runs.service.spec.ts`
- 状态机验证命令：`add-task --command 'cd backend && npm test -- --runInBand src/modules/agent-loop/agent-loop.service.spec.ts src/modules/agent-runs/agent-runs.service.spec.ts'`
- 范围基线：`specs/044-senior-agent-platform/scope-baseline-T001.json`
- 范围报告：`specs/044-senior-agent-platform/scope-report-T001.json`
- 完成定义：测试通过、迁移文件可编译、取消和恢复均有审计事件。
- 状态：pending
- 证据 ID：`T001-unit`、`T001-migration`

## T002：补齐三模式评测和 CI 门禁

- 依赖：T001
- 允许文件：`backend/scripts/eval-rag-project.mjs`、`backend/scripts/eval-rag-e2e.mjs`、`backend/scripts/collect-business-rag-evidence.mjs`、`backend/scripts/eval-agent-platform.mjs`、`backend/package.json`、`.github/workflows/quality-gate.yml`
- 操作：默认评测纳入 Agentic，增加统一三模式合同检查和 CI 执行入口。
- 对应 AC：AC-03、AC-05
- 验证：`cd backend && npm run eval:agent-platform`
- 状态机验证命令：`add-task --command 'cd backend && npm run eval:agent-platform'`
- 范围基线：`specs/044-senior-agent-platform/scope-baseline-T002.json`
- 范围报告：`specs/044-senior-agent-platform/scope-report-T002.json`
- 完成定义：无外部密钥时确定性门禁通过；三模式均出现在报告中；CI YAML 静态检查通过。
- 状态：pending
- 证据 ID：`T002-eval`、`T002-ci`

## T003：持久化 Trace 并完善运行观测

- 依赖：T001
- 允许文件：`backend/src/providers/db/entities/trace-span.entity.ts`、`backend/src/migrations/1787900000000-AddTraceSpans.ts`、`backend/src/providers/db/typeorm.config.ts`、`backend/src/providers/db/database.module.ts`、`backend/src/modules/tracing/tracing.module.ts`、`backend/src/modules/tracing/tracing.service.ts`、`backend/src/modules/tracing/tracing.controller.ts`、`backend/src/modules/tracing/tracing.service.spec.ts`、`backend/src/modules/metrics/metrics.service.ts`、`docker/monitoring/prometheus/alerts.yml`、`docker/monitoring/grafana/rag-agent-overview.json`
- 操作：异步保存 HTTP／Agent Node span，数据库不可用时回退内存；增加运行控制指标和监控模板。
- 对应 AC：AC-04
- 验证：`cd backend && npm test -- --runInBand src/modules/tracing/tracing.service.spec.ts src/modules/tracing/tracing.interceptor.spec.ts`
- 状态机验证命令：`add-task --command 'cd backend && npm test -- --runInBand src/modules/tracing/tracing.service.spec.ts src/modules/tracing/tracing.interceptor.spec.ts'`
- 范围基线：`specs/044-senior-agent-platform/scope-baseline-T003.json`
- 范围报告：`specs/044-senior-agent-platform/scope-report-T003.json`
- 完成定义：持久化和降级路径均有测试，监控模板可解析。
- 状态：pending
- 证据 ID：`T003-unit`、`T003-observability`

## T004：文档、三链路真实入口和最终验证

- 依赖：T001、T002、T003
- 允许文件：`docs/architecture/AGENT_PLATFORM_READINESS.md`、`ROADMAP.md`、`specs/044-senior-agent-platform/verify.md`
- 操作：记录已实现能力、限制和验证证据；按后台同等入口执行三条链路，补充最终验证报告。
- 对应 AC：AC-03、AC-06
- 验证：`cd backend && npm test -- --runInBand src/test/chat-modes.integration.spec.ts && npm run build && git diff --check`
- 状态机验证命令：`add-task --command 'cd backend && npm test -- --runInBand src/test/chat-modes.integration.spec.ts && npm run build && git diff --check'`
- 范围基线：`specs/044-senior-agent-platform/scope-baseline-T004.json`
- 范围报告：`specs/044-senior-agent-platform/scope-report-T004.json`
- 完成定义：三条链路均记录答案、路由、引用和检索状态；文档不夸大未验证能力。
- 状态：pending
- 证据 ID：`T004-rag`、`T004-build`、`T004-docs`
