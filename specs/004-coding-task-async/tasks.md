# 任务清单：ZIP Workspace 异步 Coding Task

## T001：持久任务与 Outbox/BullMQ 接线

- 依赖：无
- 允许文件：`apps/rag-api/src/providers/db/entities/agent-task.entity.ts`、`apps/rag-api/src/providers/db/entities/agent-run.entity.ts`、`apps/rag-api/src/migrations/1794000000000-AddCodingTaskFields.ts`、`apps/rag-api/src/providers/db/database.module.ts`、`apps/rag-api/src/providers/db/typeorm.config.ts`、`apps/rag-api/src/modules/agent-tasks/agent-tasks.service.ts`、`apps/rag-api/src/modules/agent-tasks/agent-tasks.service.spec.ts`、`apps/rag-api/src/modules/agent-runs/agent-runs.service.ts`、`apps/rag-api/src/modules/agent-runs/agent-runs.service.spec.ts`、`apps/rag-api/src/modules/workflow/production-workflow-queue.service.ts`、`apps/rag-api/src/modules/workflow/workflow-dispatch-contract.ts`、`apps/rag-api/src/modules/workflow/workflow-dispatch-contract.spec.ts`、`apps/rag-api/src/modules/workflow/coding-task.service.ts`、`apps/rag-api/src/modules/workflow/coding-task.service.spec.ts`、`apps/rag-api/src/modules/workflow/workflow.module.ts`、`apps/rag-api/src/modules/workflow/production-project-workspace.dto.ts`、`apps/rag-api/src/modules/agent-ops-admin/agent-ops-admin.controller.ts`、`apps/rag-api/src/modules/agent-ops-admin/agent-ops-admin.controller.spec.ts`
- 操作：加入可幂等创建和查询/取消/续跑的 Coding Task；在同事务保存 AgentRun、AgentTask 和 dispatch Outbox；复用现有 BullMQ Worker，job 只携带稳定身份；保留旧同步 API。
- 对应 AC：AC-01、AC-02、AC-03
- 验证：`cd apps/rag-api && npm test -- --runInBand src/modules/agent-tasks/agent-tasks.service.spec.ts src/modules/agent-runs/agent-runs.service.spec.ts src/modules/workflow/workflow-dispatch-contract.spec.ts src/modules/workflow/coding-task.service.spec.ts src/modules/agent-ops-admin/agent-ops-admin.controller.spec.ts`
- 状态机验证命令：以上命令整条注册。
- 范围基线：`specs/004-coding-task-async/scope-baseline-T001.json`
- 范围报告：`specs/004-coding-task-async/scope-report-T001.json`
- 完成定义：重复 requestId 幂等、不同 payload 冲突；事务创建原子；队列重复投递不重复运行；身份不匹配被拒；自动 retry 沿用 taskId/runId；取消和旧 retry handler 不混淆 Coding Task。
- 状态：done
- 证据 ID：`T001-unit-r2`、`T001-scope`

## T002：同 Run 恢复与确定性工作区验收

- 依赖：T001
- 允许文件：`apps/rag-api/src/modules/agent-loop/agent-loop.types.ts`、`apps/rag-api/src/modules/agent-loop/agent-loop.service.ts`、`apps/rag-api/src/modules/agent-loop/agent-loop.service.spec.ts`、`apps/rag-api/src/modules/workflow/coding-task.service.ts`、`apps/rag-api/src/modules/workflow/coding-task.service.spec.ts`、`apps/rag-api/src/modules/workflow/production-project-workspace.service.ts`、`apps/rag-api/src/modules/workflow/production-project-workspace.service.spec.ts`、`apps/rag-api/src/modules/workflow/production-project-workspace-agent.service.ts`、`apps/rag-api/src/modules/workflow/production-project-workspace-agent.service.spec.ts`
- 操作：将 taskId 写入 Loop 事件；恢复前识别缺失 checkpoint、超预算、取消和 `tool.unknown`；导出 seed/工作区 SHA256 manifest 差异；通过已注册工具执行 package scripts 验收并精确保留退出码。
- 对应 AC：AC-02、AC-03、AC-04
- 验证：`cd apps/rag-api && npm test -- --runInBand src/modules/agent-loop/agent-loop.service.spec.ts src/modules/workflow/coding-task.service.spec.ts src/modules/workflow/production-project-workspace.service.spec.ts src/modules/workflow/production-project-workspace-agent.service.spec.ts`
- 状态机验证命令：以上命令整条注册。
- 范围基线：`specs/004-coding-task-async/scope-baseline-T002.json`
- 范围报告：`specs/004-coding-task-async/scope-report-T002.json`
- 完成定义：所有结论由数据库、Loop 返回值、事件、文件哈希和命令退出码推导；模型 `complete` 不可直接将任务标记为完成；unknown 外部副作用没有自动重放路径。
- 状态：done
- 证据 ID：`T002-unit-r4`、`T002-scope`

## T003：Admin API 与 Workspace 管理界面

- 依赖：T001、T002
- 允许文件：`apps/admin-api/src/modules/agent-ops/agent-ops.controller.ts`、`apps/admin-api/src/modules/agent-ops/agent-ops.controller.spec.ts`、`apps/admin-api/src/modules/rag-client/rag-client-workflows.ts`、`apps/admin-web/src/pages/agent-ops/workspace-service.ts`、`apps/admin-web/src/pages/agent-ops/workflow-detail/workflow-detail-workspace-controller.ts`、`apps/admin-web/src/pages/agent-ops/workflow-detail/workflow-detail-shared.tsx`、`apps/admin-web/src/pages/agent-ops/workflow-detail/workflow-detail-artifact-sections.tsx`、`apps/admin-web/src/pages/agent-ops/workflow-detail/workflow-detail-workspace-controller.spec.tsx`
- 操作：将管理端改用异步端点；轮询状态、日志、差异和验证结果；提供取消与安全续跑入口；展示 not_run/not_applicable，避免显示为通过。
- 对应 AC：AC-05
- 验证：`pnpm --dir apps/admin-api exec tsc --noEmit`；`pnpm --dir apps/admin-web run lint`；Admin API 与 Admin Web 对应定向测试。
- 状态机验证命令：以上命令分别注册。
- 范围基线：`specs/004-coding-task-async/scope-baseline-T003.json`
- 范围报告：`specs/004-coding-task-async/scope-report-T003.json`
- 完成定义：HTTP 受理快速返回；UI 不阻塞等待 Agent；任务终态、运行事件、差异清单和检查结果一致；只有 owner 有权取消/续跑。
- 状态：done
- 证据 ID：`T003-web-unit`、`T003-admin-api-unit`、`T003-admin-api-tsc`、`T003-admin-web-lint`、`T003-scope`

## T004：最终回归、验收记录与项目进度

- 依赖：T001、T002、T003
- 允许文件：`ROADMAP.md`、`plan/002-coding-task-git-delivery.md`、`specs/004-coding-task-async/verify.md`、`specs/004-coding-task-async/tasks.md`
- 操作：运行最终定向验证；审阅全量 Diff；记录无法执行的真实沙箱检查和迁移环境限制；只将验证通过的能力标记完成。
- 对应 AC：AC-01–AC-05
- 验证：`cd apps/rag-api && npm run build`；`pnpm --dir apps/admin-api exec tsc --noEmit`；`pnpm --dir apps/admin-web run lint`；`git diff --check`。
- 状态机验证命令：四条命令分别注册。
- 范围基线：`specs/004-coding-task-async/scope-baseline-T004.json`
- 范围报告：`specs/004-coding-task-async/scope-report-T004.json`
- 完成定义：全部 AC 有自动证据；mock 不冒充真实 OpenSandbox；ROADMAP 与工作区最终结果一致。
- 状态：done
- 证据 ID：`T004-rag-build-r2`、`T004-admin-api-tsc`、`T004-admin-web-lint`、`T004-diff-check-r3`、`T004-scope`

## 主人批准的构建兼容修复

最终 build 首次发现 `production-workflow.control.ts` 未区分新增 `coding_task` 队列消息。主人明确批准扩展最小修复范围。修复使用独立任务状态 `fixup/state.json`，文件范围只有 `apps/rag-api/src/modules/workflow/production-workflow.control.ts`；`fixup/scope-report-T001.json` 通过，`npm run build` 与 workflow dispatch contract 定向测试通过。该文件不并入 T004 文档范围。
