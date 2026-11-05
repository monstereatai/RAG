# 产研运工作流可靠性验证记录

## 已验证的行为

| 验收项 | 证据 | 结果 |
| --- | --- | --- |
| AC-01 质量门禁 | T001-unit-retry、T004-workflow-final | 默认 auto 下生成失败和证据不足停在当前批次；正常产物仍按审批策略流转；取消和权限错误不参与模型重试。 |
| AC-02 启动事务与幂等 | T002-domain-recheck、T002-workflow-recheck、T007-run-task-unit、T007-postgres | 真实隔离 PostgreSQL 中 5 个并发同 ID 请求只创建一套 Run/任务/Outbox；参数变化冲突、响应丢失重提、事务回滚、Redis 恢复派发通过。 |
| AC-03 审批通知 | T003-domain、T003-dingtalk、T003-workflow | checkpoint 保存后的 Outbox 意图、失败重试和补账测试通过；真实钉钉服务未连接。 |
| AC-04 同层并行与恢复 | T004-plan-initial、T004-workflow-final、T004-cross-worker | design/backend 同层并发，frontend 等待；同层一成一败只重跑失败岗位；隔离 Redis BullMQ Worker 强杀恢复通过，原有旧 checkpoint 测试通过。 |
| AC-05 启动表单 | T005-ui、T005-lint、T005-antd | 常用字段优先，高级配置折叠；依赖层、预计审批条件预览通过。 |
| AC-06 状态与回归 | T001/T002/T003/T004 工作流测试、T005-lint | 展示已受理、排队中、运行中、派发失败及工作流失败原因；启动、审批、修订、取消在工作流测试中覆盖。 |
| AC-07 模拟成本比较 | T004-workflow-final | 同一套模拟输入：sequential 206 ms、hierarchical 160 ms；均调用模型 4 次，估算输入 Token 均为 1719。耗时受本机调度影响，仅反映受控模拟。 |

## 环境与限制

- T004 跨 Worker 证据：`apps/rag-api/.tmp/evidence/production-workflow-cross-worker.json`。使用真实隔离 Redis、BullMQ、检查点，模型、检索及产物服务为模拟；该脚本不验证 PostgreSQL Outbox 或第三方副作用。
- 后端 `npm run lint` 在 T006-rag-lint-baseline 失败：全仓 734 errors、1 warning，包含未改动的迁移和其他模块；未批量格式化范围外文件。后端构建 T006-build 通过，Admin lint/TypeScript、Ant Design lint、`git diff --check` 通过。
- T007 PostgreSQL 证据：`apps/rag-api/.tmp/evidence/production-workflow-postgres.json`。脚本使用真实启动控制器、Run/任务/Outbox 服务和隔离 PostgreSQL；运行事件、Redis 队列和模型执行为模拟。真实钉钉投递和生产环境验证未执行。
- T004 范围增加 `production-workflow.state-service.ts`，因为新检查点状态必须初始化新增字段；T005 范围增加详情页的 `Alert` 漏导入修复。两处均有范围报告。

## 最终回归

- T008-build-final：后端构建通过。
- T008-workflow-regression：工作流 28/28 测试通过，包括启动、审批、修订、取消、质量门禁和同层并行恢复。
- T008-admin-lint、T008-antd、T008-diff：均通过。
- 本次改动涉及的后端服务另用 ESLint 排除 `prettier/prettier` 规则检查通过；后端全仓 lint 仍受上述存量错误阻断。
- 代码无生产部署；第三方钉钉通知投递仍需接入实际服务验证。

## 修改文件清单

- Admin：`apps/admin-web/src/pages/agent-ops/agent-ops-controller.tsx`、`agent-ops-workflow-panel.tsx`、`agent-ops-workflow-panel.spec.tsx`、`service.ts`、`workflow-detail/workflow-detail-artifact-sections.tsx`。
- 工作流：`apps/rag-api/src/modules/workflow/production-workflow-queue.service.ts`、`production-workflow.control.ts`、`production-workflow.dto.ts`、`production-workflow.events.ts`、`production-workflow.execution.ts`、`production-workflow.query.ts`、`production-workflow.role-support.ts`、`production-workflow.service.spec.ts`、`production-workflow.state-service.ts`、`production-workflow.state.ts`。
- 持久化与通知：`apps/rag-api/src/modules/agent-runs/agent-runs.service.ts`、`agent-tasks/agent-tasks.service.ts`、`domain-events/domain-events.service.ts`、`domain-events/domain-events.service.spec.ts`、`apps/rag-api/src/providers/notify/dingtalk.provider.ts`、`dingtalk.provider.spec.ts`。
- 验证脚本与记录：`apps/rag-api/scripts/verify-production-workflow-postgres.mjs`、`ROADMAP.md`、`specs/003-production-workflow-reliability/`。
