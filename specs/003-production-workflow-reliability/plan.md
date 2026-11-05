# 实施计划：产研运工作流启动与流转可靠性

## 已确认上下文

- 基线：远端 `main` 最新提交 `b4fc459f318aae6a731c41fc90cf5c511f347626`，本地 HEAD 相同；工作区初始干净。
- `production-workflow.execution.ts` 目前按 `batchRoleCursor` 执行岗位；生成失败会得到 `readyForApproval=false`，但 `finishBatch` 主要按审批模式判断是否继续。
- `generateStructuredRole` 把所有模型异常都重试一次；`persistRoleResult` 将模型失败任务记为 `waiting_approval`。
- 启动 API 目前先创建 AgentRun、再创建岗位任务、最后单独发 Outbox；`DomainEventsService.emitInTransaction(manager, ...)` 已可在调用方事务中持久化 Outbox。
- `domain_event_outbox.idempotencyKey` 已有唯一约束；可用 tenant/user/requestId 的哈希做稳定键，避免新表和迁移。
- Outbox dispatcher 会持续重试 pending 事件，但工作流派发事件达到 max attempts 后会进入 failed；需要为长期未派发记录补对账重投。
- 审批状态经 LangGraph checkpoint 保存；`ProductionWorkflowEvents.emitWorkflowState` 在图运行结束后调用，但审批通知目前在 `finishBatch` 中 fire-and-forget。`DingTalkProvider.notifyApproval` 也会吞掉发送失败。
- `buildProductionExecutionBatches` 已生成 hierarchical 层次 `product → [design, backend] → frontend → qa → operations`；LangGraph 当前依赖结果 Map reducer 与岗位游标路径。
- Admin API 的 `startWorkflow` 和 RAG client 已透传请求 body，暂不需要修改代理契约。

## 方案

- **质量判定**：在 `role-support` 统一产生 `passed`、`generation_failed`、`evidence_insufficient` 及原因。`finishBatch` 先检查整批质量；失败时停留在当前岗位，保持产物 review pending、任务失败并将工作流置为可修订状态；质量通过后才应用既有审批策略。质量失败岗位和原因单独记录，补充材料重试通过后清除对应质量阻塞标记，再按原 `approvalMode` 决定 auto 或人工审批；既有人工驳回触发的修订仍必须重新人工审批。auto 批准时同步更新本批所有通过质量检查的任务和产物，避免任务、产物、工作流状态不一致。失败原因传入工作流详情和运行记录。
- **重试边界**：只在结构化模型调用处重试可恢复错误；取消/Abort、401/403、无效请求及非模型副作用错误直接返回。
- **启动幂等**：前端为待确认启动持久化 `requestId` 和对应参数摘要，网络超时或页面恢复时沿用原 ID；服务端确认已受理后清理，用户明确新建工作流时才生成新 ID。服务端规范化请求参数并算摘要，按 tenant/user/requestId 算 Outbox 唯一键；同 ID 同摘要返回原 threadId，不同摘要冲突。
- **原子创建**：通过 DomainEvents 的事务管理入口启动 TypeORM transaction，在同一 manager 下创建 AgentRun、岗位计划和 `workflow.dispatch.requested` Outbox。并发唯一键冲突必须从事务中抛出并回滚；回滚完成后，使用事务外的基础 repository 读取并校验已存在 Outbox，再返回原 threadId。禁止在 PostgreSQL 已 aborted 的 manager/transaction 内捕获冲突后继续查询。事务提交后快速投递 BullMQ；快速投递失败不撤销受理状态。
- **派发恢复与状态**：对长期 failed 的 workflow dispatch 记录做有退避的自动重投/对账；BullMQ job ID 仍由 threadId 稳定生成。API 状态合并 Outbox、BullMQ job 与 LangGraph 执行进度，返回 `accepted/queued/running/failed`，并把 outbox 错误交给管理端显示。超时操作可按原 ID 重试。
- **审批通知**：把通知意图放在 `pending_approval` 状态 checkpoint 之后，使用 workflow/revision/batch/checkpoint 摘要作为 Outbox 幂等键。重投进入既有检查点时，在终态早退前幂等补齐缺失意图；另设定时对账调用 T002 提供的活跃产研工作流 Run 查询，扫描 `production_workflow` 的 running/waiting_approval Run，读取图 checkpoint，对 `pending_approval` 状态重复 ensure 同一通知意图。这样即使在 checkpoint 与首次写 Outbox 之间强杀，或数据库短暂不可用，都有重投及定时对账路径。通知 handler 调用钉钉，发送失败时抛错以触发 Outbox 重试；禁用通知配置作为明确跳过处理。运行中心的待审批入口由持久 checkpoint 提供。
- **运行事件与 Goal**：事务内的 Run/岗位任务创建方法不发送 runtime event，避免事务回滚后留下幽灵事件。事务提交后按稳定幂等键补发 `run.started`、`task.created`；检查点重投时即使 Run/任务计划已存在也重复执行 ensure，修复“提交后进程退出、事件尚未写入”的窗口。Goal 激活在每次恢复时按 runId 检查并幂等补齐；不会因预创建 Run 而跳过。
- **同层并行**：新建 workflow checkpoint 版本由 LangGraph `Send` 为每个岗位传入独立的 `{ role, batchIndex, revisionNumber, input }`，并发执行同一个 per-role 子图/节点。每次写入使用 `roleResults[role]`、`roleErrors[role]` 等按岗位键控的 reducer；并行节点不写共享 `currentRole`、`batchRoleCursor`、`rolePhase` 或 `currentRoleModelError` 标量。汇总节点读取整层每个岗位状态，通过质量门禁后才进入审批或下一层。LangGraph 节点 pending writes 在 Worker 恢复时复用已成功岗位结果。保留旧 version 1 `executeBatch`、version 2 游标检查点和 sequential 流程。
- **管理端**：默认展示项目 ID、需求背景、岗位和审批策略；步骤数、插件、协作策略、风险阈值放入“高级配置”。客户端按同一岗位 DAG 展示依赖层，并按显式审批策略标记预计节点；risk_based 明示由生成风险决定。增加派发状态和失败原因；质量失败复用现有 workflow detail 的 `requiresRevision` 补充材料/重试入口，不重复建设或修改详情页文件。
- **性能证据**：用固定 fake model 延迟和输入对 sequential/hierarchical 做同 fixture 比较，记录 wall time、model calls、估算 input tokens；另用跨 Worker 模拟验证强杀恢复和同层一成一败。

## 文件清单

| 文件 | 操作 | 原因 | 对应 AC |
| --- | --- | --- | --- |
| `apps/rag-api/src/modules/workflow/production-workflow.execution.ts` | modify | 质量门禁、通知恢复节点、同层并行和旧图兼容 | AC-01、03、04、06、07 |
| `apps/rag-api/src/modules/workflow/production-workflow.role-support.ts` | modify | 统一岗位质量判定与可处理原因 | AC-01 |
| `apps/rag-api/src/modules/workflow/production-workflow.state.ts` | modify | 新版本/岗位质量和派发视图状态，兼容旧检查点 | AC-01、04、06 |
| `apps/rag-api/src/modules/workflow/production-workflow.plan.ts` | modify | 确定性依赖层与预览共享逻辑 | AC-04、05、07 |
| `apps/rag-api/src/modules/workflow/production-workflow.dto.ts` | modify | 接收并校验 requestId | AC-02、06 |
| `apps/rag-api/src/modules/workflow/production-workflow.control.ts` | modify | 原子受理、事务冲突处理、通知 handler 与重投协调 | AC-02、03、06 |
| `apps/rag-api/src/modules/workflow/production-workflow.state-service.ts` | modify | 创建 Run/任务/Outbox 事务、稳定 job ID 和 dispatch 状态恢复 | AC-02、06 |
| `apps/rag-api/src/modules/workflow/production-workflow.events.ts` | modify | 状态/错误/审批通知事件与稳定通知去重键 | AC-01、03、06 |
| `apps/rag-api/src/modules/workflow/production-workflow.query.ts` | modify | 查询时合并 queue/outbox 执行状态 | AC-02、06 |
| `apps/rag-api/src/modules/workflow/production-workflow-queue.service.ts` | modify | 查询 BullMQ job 状态与稳定重投 | AC-02、06 |
| `apps/rag-api/src/modules/domain-events/domain-events.service.ts` | modify | 事务包装、Outbox 幂等读取及失败派发对账 | AC-02、03 |
| `apps/rag-api/src/modules/domain-events/domain-events.service.spec.ts` | modify | 事务写入、重复请求、失败重投测试 | AC-02、03 |
| `apps/rag-api/src/modules/agent-runs/agent-runs.service.ts` | modify | 在外部事务 manager 下创建 Run，并查询活跃产研工作流 Run | AC-02、03 |
| `apps/rag-api/src/modules/agent-runs/agent-runs.service.spec.ts` | modify | Run manager、活跃工作流 Run 查询及恢复测试 | AC-02、03 |
| `apps/rag-api/src/modules/agent-tasks/agent-tasks.service.ts` | modify | 在同一 manager 下创建岗位任务计划 | AC-02 |
| `apps/rag-api/src/modules/agent-tasks/agent-tasks.service.spec.ts` | modify | 任务 manager 事务测试 | AC-02 |
| `apps/rag-api/src/providers/notify/dingtalk.provider.ts` | modify | 把真实发送失败变成 Outbox 可重试错误 | AC-03 |
| `apps/rag-api/src/providers/notify/dingtalk.provider.spec.ts` | modify | 通知失败/禁用配置测试 | AC-03 |
| `apps/rag-api/src/modules/workflow/production-workflow.service.spec.ts` | modify | 质量、幂等、审批/修订/取消和并行回归 | AC-01–04、06、07 |
| `apps/rag-api/src/modules/workflow/production-workflow.plan.spec.ts` | modify | DAG 层次与预览 fixture 测试 | AC-04、05、07 |
| `apps/rag-api/scripts/verify-production-workflow-cross-worker.mjs` | modify | 同层 worker 强杀、部分成功恢复验证 | AC-04、06 |
| `apps/rag-api/scripts/verify-production-workflow-postgres.mjs` | add | 真实 PostgreSQL 并发 requestId、事务回滚和唯一键冲突恢复 | AC-02 |
| `apps/admin-web/src/pages/agent-ops/service.ts` | modify | requestId、派发状态和依赖预览服务契约 | AC-02、05、06 |
| `apps/admin-web/src/pages/agent-ops/agent-ops-controller.tsx` | modify | 保留超时 requestId、受理状态和质量修订操作 | AC-02、05、06 |
| `apps/admin-web/src/pages/agent-ops/agent-ops-workflow-panel.tsx` | modify | 高级配置、依赖/审批预览和准确状态文案 | AC-01、05、06 |
| `apps/admin-web/src/pages/agent-ops/agent-ops-workflow-panel.spec.tsx` | add | 表单状态、依赖预览和操作交互验证 | AC-05、06 |
| `ROADMAP.md` | modify | 记录实际实现、阻塞和验证结果 | AC-01–07 |
| `specs/003-production-workflow-reliability/tasks.md` | modify | 记录任务状态与实际证据 | AC-01–07 |
| `specs/003-production-workflow-reliability/verify.md` | modify | 记录命令、范围及验收证据 | AC-01–07 |

## 执行顺序

1. 完成 P0-1：增加统一质量状态与错误分类；先阻断自动批准降级结果，再应用人工审批规则；补可修订入口与定向测试。
2. 完成 P0-2：以前端 requestId 到服务端事务/幂等为一条闭环；复用现有唯一 Outbox 键；补异步状态与长期失败重投。
3. 完成 P0-3：将通知意图写入 Outbox，并确保状态 checkpoint 保存后才能投递；失败时由 Outbox 重试。
4. 完成 P1-1：在新 checkpoint 版本实现 LangGraph 同层 fanout、汇总门禁及 partial-success 恢复；保留 sequential 和旧 checkpoint。
5. 完成 P1-2：整理默认表单与高级配置，预览 DAG/审批节点并显示受理状态。
6. 集成验证启动、审批、修订、取消、旧检查点、worker 强杀、Redis 暂不可用和同层一成一败；记录模拟性能数据与真实环境未覆盖项。
7. 使用真实 PostgreSQL 验证并发 requestId、事务中途失败回滚及 23505 后事务外读回；若 PostgreSQL 不可用，AC-02 保持未完整验收。
8. T007 若发现并修复后端缺陷，随后执行 T008 的完整 build/lint/diff 和最终记录，所有最终验证均针对 T007 后的代码。

## 验证计划

| 层级 | 命令或操作 | 通过条件 |
| --- | --- | --- |
| RAG unit | `cd apps/rag-api && npm test -- --runInBand src/modules/workflow/production-workflow.service.spec.ts` | 质量门禁、审批、修订、取消和兼容测试通过；并覆盖通知对账所用的活跃产研 Run 查询 |
| transaction unit | `cd apps/rag-api && npm test -- --runInBand src/modules/domain-events/domain-events.service.spec.ts` | Outbox manager 复用事务；冲突/失败不留下部分记录 |
| workflow plan | `cd apps/rag-api && npm test -- --runInBand src/modules/workflow/production-workflow.plan.spec.ts` | DAG、层次和 sequential 契约通过 |
| task/run unit | `cd apps/rag-api && npm test -- --runInBand src/modules/agent-runs/agent-runs.service.spec.ts src/modules/agent-tasks/agent-tasks.service.spec.ts` | Run 与岗位任务可由同一 manager 创建；恢复时补齐事件与 Goal |
| PostgreSQL integration | `cd apps/rag-api && node scripts/verify-production-workflow-postgres.mjs` | 真实数据库并发 requestId、事务回滚和事务外冲突读回通过 |
| Final checks | `T008` 登记的 build、lint、Admin lint、antd lint 和 `git diff --check` 命令 | 所有结果针对 T007 最终代码；ROADMAP/verify 只记录实际通过项 |
| worker recovery | `cd apps/rag-api && npm run verify:workflow:cross-worker` | 强杀后恢复；成功岗位不重复模型调用/写产物；失败岗位单独重跑 |
| RAG build/lint | `cd apps/rag-api && npm run build && npm run lint` | build 通过；lint 结果与已知基线比较并记录 |
| Admin UI | `pnpm --dir apps/admin-web exec vitest run src/pages/agent-ops/agent-ops-workflow-panel.spec.tsx` | 表单、requestId 及状态显示通过 |
| Admin checks | `pnpm --dir apps/admin-web run lint && pnpm --dir apps/admin-web exec antd lint ./src` | Biome、TypeScript、antd 检查通过 |
| recovery flows | 模拟启动/重复提交、审批、修订、取消、旧 executeBatch checkpoint、Outbox/Redis 恢复 | 每条路径状态与任务计划一致 |
| diff | `git diff --check` | 无空白错误或计划外改动 |

真实 PostgreSQL 是 AC-02 并发唯一键、事务回滚与事务外读回的必需验证；mock 不足以证明 PostgreSQL aborted transaction 的行为。T007 执行真实数据库故障路径；若本地 PostgreSQL 不可用，必须将 AC-02 标记为未完整验证并报告阻塞，不能宣称全部验收通过。本阶段不执行迁移。真实钉钉投递不自动发送，单独记录为外部验收。完整 lint 若被已有仓库问题阻断，必须报告现状并运行改动文件目标 lint。

## 执行控制

- 状态恢复：on（任务超过 3 项且需要 Plan 人工等待）
- 独立审查：plan（独立审查者只写 `plan-review.md`，不改方案或代码）
- 分支策略：当前 `main` 受保护；取得主人明确许可后创建 `codex/production-workflow-reliability`
- 提交策略：none
- 详情页范围：复用 `apps/admin-web/src/pages/agent-ops/workflow-detail/workflow-detail-playway-sections.tsx` 与 `workflow-detail-controller.tsx` 现有 `requiresRevision` 行为，不修改这两个文件；T005 只确保质量失败状态进入该既有路径并在启动面板可见原因。

## 状态机注册

- 已注册 AC：AC-01–AC-07
- 已注册任务：T001–T008
- 状态文件：`specs/003-production-workflow-reliability/state.json`

## 风险与回退

- 风险：LangGraph 并发恢复依赖已锁定版本的 Send/pending-write 检查点行为；必须在跨 Worker 验证中证实。
- 风险：DingTalk webhook 的远端成功响应丢失时，Outbox 至少一次重试仍可能重复发送；此方案保证通知意图去重，不承诺远端 exactly-once。
- 风险：真实 PostgreSQL/Redis/钉钉环境未必可用；mock 测试不能代替相应外部联调。
- 回退方式：恢复由本次引入的 workflow graph version 路由、Outbox handler 和 Admin 表单改动；保留既有检查点读取分支。不得自动 git rollback 或删除文件。
- 数据兼容：不增加数据库 schema/migration；若实施中需要新增约束或列，停止该任务并重新取得数据库 schema 变更许可。

## 审批

- Plan 状态：draft，等待主人批准
- 批准人：
- 批准时间：
