# 任务清单：产研运工作流启动与流转可靠性

## T001：质量门禁与模型重试边界

- 依赖：无
- 允许文件：`apps/rag-api/src/modules/workflow/production-workflow.execution.ts`、`apps/rag-api/src/modules/workflow/production-workflow.role-support.ts`、`apps/rag-api/src/modules/workflow/production-workflow.state.ts`、`apps/rag-api/src/modules/workflow/production-workflow.events.ts`、`apps/rag-api/src/modules/workflow/production-workflow.service.spec.ts`
- 操作：统一评估生成失败/证据不足/质量通过；质量失败不进入人工审批策略，产物不标已批准；补充材料修复通过后按原 auto/人工策略流转；人工驳回后的修订仍强制复核；仅重试可恢复模型调用错误；暴露失败原因和失败岗位。
- 对应 AC：AC-01
- 验证：`cd apps/rag-api && npm test -- --runInBand src/modules/workflow/production-workflow.service.spec.ts`
- 状态机验证命令：以同一命令注册。
- 范围基线：`specs/003-production-workflow-reliability/scope-baseline-T001.json`
- 范围报告：`specs/003-production-workflow-reliability/scope-report-T001.json`
- 完成定义：默认 auto 下失败/证据不足阻止下游；质量修复与人工驳回两类 revision 在 auto 下分别按原策略和强制复核流转；本批通过质量检查的任务、产物、工作流状态一致；取消/权限/无效输入不重试。
- 状态：pending
- 证据 ID：`T001-unit`

## T002：requestId 幂等、原子启动与派发恢复

- 依赖：T001
- 允许文件：`apps/admin-web/src/pages/agent-ops/agent-ops-controller.tsx`、`apps/admin-web/src/pages/agent-ops/service.ts`、`apps/rag-api/src/modules/workflow/production-workflow.dto.ts`、`apps/rag-api/src/modules/workflow/production-workflow.control.ts`、`apps/rag-api/src/modules/workflow/production-workflow.state-service.ts`、`apps/rag-api/src/modules/workflow/production-workflow.events.ts`、`apps/rag-api/src/modules/workflow/production-workflow.query.ts`、`apps/rag-api/src/modules/workflow/production-workflow-queue.service.ts`、`apps/rag-api/src/modules/domain-events/domain-events.service.ts`、`apps/rag-api/src/modules/domain-events/domain-events.service.spec.ts`、`apps/rag-api/src/modules/agent-runs/agent-runs.service.ts`、`apps/rag-api/src/modules/agent-runs/agent-runs.service.spec.ts`、`apps/rag-api/src/modules/agent-tasks/agent-tasks.service.ts`、`apps/rag-api/src/modules/agent-tasks/agent-tasks.service.spec.ts`、`apps/rag-api/src/modules/workflow/production-workflow.service.spec.ts`
- 操作：前端持久化待确认 requestId；服务端按 tenant/user/id 和参数摘要复用 threadId；Run、岗位任务和 dispatch Outbox 在一个 TypeORM manager 事务落库；新增按 route/status 查询活跃产研工作流 Run 的方法供 T003 定时通知对账；事务化创建 Run/任务时不提前发 runtime event，事务提交后用稳定幂等键补发，重投时即使 Run/任务已存在也 ensure 事件和 Goal；唯一键冲突先回滚，再通过事务外 repository 读回并核对摘要；增加长时间未派发对账与 accepted/queued/running/failed 状态。
- 对应 AC：AC-02、AC-06
- 验证：`cd apps/rag-api && npm test -- --runInBand src/modules/domain-events/domain-events.service.spec.ts`；`cd apps/rag-api && npm test -- --runInBand src/modules/workflow/production-workflow.service.spec.ts`
- 状态机验证命令：两条命令均注册。
- 范围基线：`specs/003-production-workflow-reliability/scope-baseline-T002.json`
- 范围报告：`specs/003-production-workflow-reliability/scope-report-T002.json`
- 完成定义：同 ID 并发和重提只创建一个 Run/任务计划及 runtime event；参数不同冲突；可枚举 running/waiting_approval 的产研工作流 Run，且已登记的 `production-workflow.service.spec.ts` 在 T003 使用该查询前覆盖过滤/候选恢复行为；事务异常无半成品，唯一键冲突路径会先回滚并在事务外读回；提交后 Redis 不可用仍可恢复派发；Run 已存在时能幂等补齐 Goal 激活。真实 PostgreSQL 行为由 T007 单独验收。
- 状态：pending
- 证据 ID：`T002-idempotency`、`T002-transaction`

## T003：审批通知 Outbox

- 依赖：T002
- 允许文件：`apps/rag-api/src/modules/workflow/production-workflow.execution.ts`、`apps/rag-api/src/modules/workflow/production-workflow.control.ts`、`apps/rag-api/src/modules/workflow/production-workflow.events.ts`、`apps/rag-api/src/modules/domain-events/domain-events.service.ts`、`apps/rag-api/src/modules/domain-events/domain-events.service.spec.ts`、`apps/rag-api/src/providers/notify/dingtalk.provider.ts`、`apps/rag-api/src/providers/notify/dingtalk.provider.spec.ts`、`apps/rag-api/src/modules/workflow/production-workflow.service.spec.ts`
- 操作：审批 checkpoint 保存后写稳定键通知 Outbox；复用 T002 的活跃 Run 查询执行定时补账；通知 handler 失败可重试；移除 fire-and-forget 直发。
- 对应 AC：AC-03
- 验证：`cd apps/rag-api && npm test -- --runInBand src/modules/domain-events/domain-events.service.spec.ts`；`cd apps/rag-api && npm test -- --runInBand src/providers/notify/dingtalk.provider.spec.ts`；`cd apps/rag-api && npm test -- --runInBand src/modules/workflow/production-workflow.service.spec.ts`
- 状态机验证命令：三条命令均注册。
- 范围基线：`specs/003-production-workflow-reliability/scope-baseline-T003.json`
- 范围报告：`specs/003-production-workflow-reliability/scope-report-T003.json`
- 完成定义：审批状态在通知失败时保留；checkpoint 后、Outbox 前强杀及 Outbox 暂时不可用时由 Bull 重投或定时对账补齐通知意图；重复执行产生一个通知意图；mock 服务恢复后 Outbox 成功重试。
- 状态：pending
- 证据 ID：`T003-checkpoint`、`T003-outbox`

## T004：hierarchical 同层并行与部分恢复

- 依赖：T001、T003
- 允许文件：`apps/rag-api/src/modules/workflow/production-workflow.execution.ts`、`apps/rag-api/src/modules/workflow/production-workflow.state.ts`、`apps/rag-api/src/modules/workflow/production-workflow.state-service.ts`、`apps/rag-api/src/modules/workflow/production-workflow.plan.ts`、`apps/rag-api/src/modules/workflow/production-workflow.plan.spec.ts`、`apps/rag-api/src/modules/workflow/production-workflow.service.spec.ts`、`apps/rag-api/scripts/verify-production-workflow-cross-worker.mjs`。`state-service.ts` 需为新 checkpoint 初始化 `parallelRole` 和 `qualityBlockedRoles`。
- 操作：新 checkpoint 版本对同层岗位 fanout，每个岗位使用独立 role 输入与按角色键控结果/错误状态，不写共享游标标量；整批质量通过后推进依赖岗位；失败岗位单独修订/重跑；保留 sequential 和旧版本检查点。
- 对应 AC：AC-04、AC-07
- 验证：`cd apps/rag-api && npm test -- --runInBand src/modules/workflow/production-workflow.plan.spec.ts`；`cd apps/rag-api && npm test -- --runInBand src/modules/workflow/production-workflow.service.spec.ts`；`cd apps/rag-api && npm run verify:workflow:cross-worker`
- 状态机验证命令：三条命令均注册。
- 范围基线：`specs/003-production-workflow-reliability/scope-baseline-T004.json`
- 范围报告：`specs/003-production-workflow-reliability/scope-report-T004.json`
- 完成定义：design/backend 同层并行且并行节点没有共享标量写冲突；同层一成一败和 Worker 强杀后成功侧不重复调用；顺序模式和旧检查点回归通过；记录模拟耗时、调用次数与估算 Token。
- 状态：pending
- 证据 ID：`T004-unit`、`T004-worker-recovery`、`T004-benchmark`

## T005：启动表单、预览与状态呈现

- 依赖：T002、T004
- 允许文件：`apps/admin-web/src/pages/agent-ops/agent-ops-controller.tsx`、`apps/admin-web/src/pages/agent-ops/agent-ops-workflow-panel.tsx`、`apps/admin-web/src/pages/agent-ops/agent-ops-workflow-panel.spec.tsx`、`apps/admin-web/src/pages/agent-ops/service.ts`、`apps/admin-web/src/pages/agent-ops/workflow-detail/workflow-detail-artifact-sections.tsx`。最后一项补上原有的 `Alert` 漏导入，使 Admin TypeScript 检查可执行。
- 操作：将低频配置折叠到高级配置；显示岗位依赖层、预计审批条件、派发状态和失败原因；质量失败复用 workflow detail 已有补充材料/重试入口，不修改详情页文件。
- 对应 AC：AC-01、AC-05、AC-06
- 验证：`pnpm --dir apps/admin-web exec vitest run src/pages/agent-ops/agent-ops-workflow-panel.spec.tsx`；`pnpm --dir apps/admin-web run lint`；`pnpm --dir apps/admin-web exec antd lint ./src`
- 状态机验证命令：三条命令均注册。
- 范围基线：`specs/003-production-workflow-reliability/scope-baseline-T005.json`
- 范围报告：`specs/003-production-workflow-reliability/scope-report-T005.json`
- 完成定义：常用项默认可见；高级项收纳；DAG/审批预览与后端策略一致；timeout 重试沿用原 requestId；文案准确。
- 状态：pending
- 证据 ID：`T005-ui`、`T005-lint`

## T006：集成验证与项目记录

- 依赖：T001、T002、T003、T004、T005
- 允许文件：`apps/rag-api/src/modules/workflow/production-workflow.service.spec.ts`、`apps/rag-api/scripts/verify-production-workflow-cross-worker.mjs`、`ROADMAP.md`、`specs/003-production-workflow-reliability/verify.md`、`specs/003-production-workflow-reliability/tasks.md`
- 操作：完成启动、审批、修订、取消、旧 checkpoint、transaction/Outbox、Redis 暂不可用、Worker 强杀和同层一成一败验证；审阅 diff 并记录真实限制。
- 对应 AC：AC-01–AC-07
- 验证：`cd apps/rag-api && npm run build`；`pnpm --dir apps/admin-web run lint`；`pnpm --dir apps/admin-web exec antd lint ./src`；`git diff --check`。后端全仓 `npm run lint` 已运行并记录失败（734 error，含大量范围外存量问题），不作为本任务完成门槛；不批量修改无关文件。
- 状态机验证命令：四条通过门槛命令均注册，后端 lint 失败另有命令证据。
- 范围基线：`specs/003-production-workflow-reliability/scope-baseline-T006.json`
- 范围报告：`specs/003-production-workflow-reliability/scope-report-T006.json`
- 完成定义：每项 AC 有证据；未跑的真实 PostgreSQL/钉钉/生产验证明确列为待办；ROADMAP 只记录已验证的完成项。
- 状态：pending
- 证据 ID：`T006-build`、`T006-lint`、`T006-diff`、`T006-acceptance`

## T007：真实 PostgreSQL 幂等与事务恢复验证

- 依赖：T006
- 允许文件：`apps/rag-api/scripts/verify-production-workflow-postgres.mjs`、`apps/rag-api/src/modules/domain-events/domain-events.service.ts`、`apps/rag-api/src/modules/domain-events/domain-events.service.spec.ts`、`apps/rag-api/src/modules/workflow/production-workflow.control.ts`、`apps/rag-api/src/modules/workflow/production-workflow.state-service.ts`、`apps/rag-api/src/modules/agent-runs/agent-runs.service.ts`、`apps/rag-api/src/modules/agent-runs/agent-runs.service.spec.ts`、`apps/rag-api/src/modules/agent-tasks/agent-tasks.service.ts`、`apps/rag-api/src/modules/agent-tasks/agent-tasks.service.spec.ts`
- 操作：在专用本地 PostgreSQL 数据库中并发提交同一 requestId、制造事务中途异常、制造唯一键冲突并验证 rollback 后事务外读回；校验只留一个 Run、岗位计划及 dispatch Outbox。测试仅使用随机隔离 ID 和专用测试库，不执行迁移。
- 对应 AC：AC-02
- 验证：`cd apps/rag-api && npm test -- --runInBand src/modules/agent-runs/agent-runs.service.spec.ts src/modules/agent-tasks/agent-tasks.service.spec.ts`；`cd apps/rag-api && node scripts/verify-production-workflow-postgres.mjs`
- 状态机验证命令：两条命令均注册。
- 完成定义：PostgreSQL 并发重复请求只有一套记录；参数变化报冲突；事务异常无半成品；唯一键冲突后的赢家记录在事务外读回；提交后重复分发沿用同一 threadId。若专用 PostgreSQL 不可用，任务和 AC-02 保持未验收。
- 状态：pending
- 证据 ID：`T007-run-task-unit`、`T007-postgres`

## T008：T007 后最终构建与验收记录

- 依赖：T007
- 允许文件：`ROADMAP.md`、`specs/003-production-workflow-reliability/verify.md`、`specs/003-production-workflow-reliability/tasks.md`、`apps/rag-api/src/modules/workflow/production-workflow.control.ts`。控制器在最终定向 lint 与工作流回归时补充载荷判空及可选队列方法判断。
- 操作：针对 T007 后的最终代码重跑完整 build、工作流回归、Admin lint、antd lint 和 diff 检查；只把真实通过的事项记入 ROADMAP 与 verify。
- 对应 AC：AC-01–AC-07
- 验证：`cd apps/rag-api && npm run build`；`cd apps/rag-api && npm test -- --runInBand src/modules/workflow/production-workflow.service.spec.ts`；`pnpm --dir apps/admin-web run lint`；`pnpm --dir apps/admin-web exec antd lint ./src`；`git diff --check`。后端全仓 lint 的存量失败在 T006 已留证，T008 复核受影响文件及最终构建。
- 状态机验证命令：五条通过门槛命令均注册。
- 完成定义：最终检查结果对应 T007 后工作区；ROADMAP 只把有通过证据的 AC 标记为完成，外部环境未验证项继续标为待办。
- 状态：pending
- 证据 ID：`T008-build`、`T008-rag-lint`、`T008-admin-lint`、`T008-antd-lint`、`T008-diff`
