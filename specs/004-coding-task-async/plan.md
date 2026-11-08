# 实施计划：ZIP Workspace 异步 Coding Task 与确定性验收

## 已确认上下文

- 基线：`codex/rag-coding-task`，从 `main@e497aa7db882a96dd2b4cc9d0f918c15e4970acf` 创建；用户此前工作区的三份路线图文档随分支保留。
- Workspace Agent 当前同步返回；`AgentLoopService.resume()` 校验 thread/actor/run 身份并继承已消耗的时间预算。
- `AgentTaskEntity` 已有 runId、状态、retryCount、Artifact 关联；新增少量 Coding 专属列即可复用既有任务表。`AgentRunEntity.mode` 当前不含 coding，但数据库字段是 varchar。
- `ProductionWorkflowQueueService` 只有一个现有 BullMQ Worker；扩展其 job union/专属处理器，不新建队列或 Outbox。
- OpenSandbox 配置缺失，真实 sandbox E2E 暂缓。

## 方案

- 数据流：管理端 → Admin API → RAG AgentOps 新异步端点 → 事务创建 AgentRun/AgentTask + `workflow.dispatch.requested` Outbox → 现有 DomainEvents 派发至同一 BullMQ 队列 → Coding Task Worker → 现有 Workspace Agent / AgentLoop。
- 数据权威：AgentTask 新增 `taskType/ownerUserId/requestId/requestHash/codingContext/verification/lastCompletedStep`；Run 继续使用 AgentRunEntity；运行轨迹沿 AgentRuntimeEvents 关联 taskId/runId。Outbox 只存稳定任务身份，不复制指令或凭据。
- 恢复：首次执行用同一 runId `run()`；BullMQ 自动重投与人工续跑均用同一 runId `resume()`。未知工具结果、无 Checkpoint、Redis 缺失或预算耗尽时不从初始状态重跑；保存明确阻塞原因。
- 验收：Workspace 服务根据 seed Artifact 与沙箱文件树生成确定性文件差异；按 `package.json` 脚本检测 lint/test/build，并通过既有 ToolExecution 权限/审计执行；只有适用检查全过且有文件差异才自动标 completed。
- 兼容性与回退：旧同步 Agent API 保持不变；ZIP Workspace 仍作为唯一任务来源；数据库 migration 仅新增可空/有默认值列和唯一索引，可通过新代码回滚迁移（不在本任务运行生产迁移）。

## 文件清单

| 文件 | 操作 | 原因 | 对应 AC |
| --- | --- | --- | --- |
| `apps/rag-api/src/providers/db/entities/agent-task.entity.ts` | modify | 加入 Coding 任务持久字段 | AC-01–04 |
| `apps/rag-api/src/migrations/1794000000000-AddCodingTaskFields.ts` | add | 为既有 AgentTask 增加可追踪字段与幂等索引 | AC-01–04 |
| `apps/rag-api/src/providers/db/database.module.ts`、`typeorm.config.ts` | modify | 注册已有 AgentTask entity（核对漏项后仅做必要改动） | AC-01 |
| `apps/rag-api/src/modules/agent-tasks/agent-tasks.service.ts`、`.spec.ts` | modify | 提供 Coding Task 的事务写入、owner 查询、状态 CAS；阻止岗位 retry handler 错接 | AC-01–04 |
| `apps/rag-api/src/modules/agent-runs/agent-runs.service.ts`、`.spec.ts`、`apps/rag-api/src/providers/db/entities/agent-run.entity.ts` | modify | 记录 coding Run、取消与同 Run 恢复状态 | AC-02–03 |
| `apps/rag-api/src/modules/agent-loop/agent-loop.types.ts`、`agent-loop.service.ts`、`agent-loop.service.spec.ts` | modify | 关联 taskId 事件并检查 Checkpoint/取消语义 | AC-02–03 |
| `apps/rag-api/src/modules/workflow/production-workflow-queue.service.ts`、`workflow-dispatch-contract.ts`、`workflow-dispatch-contract.spec.ts` | modify | 复用现有 Outbox/BullMQ 增加 coding_task job 处理器 | AC-02 |
| `apps/rag-api/src/modules/workflow/coding-task.service.ts`、`.spec.ts` | add | 任务受理、幂等、Outbox、Worker、状态与恢复编排 | AC-01–04 |
| `apps/rag-api/src/modules/workflow/workflow.module.ts`、`production-project-workspace.dto.ts` | modify | 注册 Coding Task service 和新异步 DTO | AC-01–04 |
| `apps/rag-api/src/modules/workflow/production-project-workspace.service.ts`、`.spec.ts` | modify | ZIP 校验、seed 与工作区差异、脚本检测/验收命令 | AC-01、04 |
| `apps/rag-api/src/modules/workflow/production-project-workspace-agent.service.ts`、`.spec.ts` | modify | 支持指定同一 runId/resume 并保留 AgentLoop 终态 | AC-02–04 |
| `apps/rag-api/src/modules/agent-ops-admin/agent-ops-admin.controller.ts`、`.spec.ts` | modify | 受保护的提交、查询、取消、续跑 API | AC-01、03、05 |
| `apps/admin-api/src/modules/agent-ops/agent-ops.controller.ts`、`.spec.ts` | modify | 代理新异步任务入口及控制接口，沿用权限守卫 | AC-05 |
| `apps/admin-api/src/modules/rag-client/rag-client-workflows.ts` | modify | 代理到 RAG AgentOps | AC-05 |
| `apps/admin-web/src/pages/agent-ops/workspace-service.ts`、`workflow-detail/workflow-detail-workspace-controller.ts`、`workflow-detail/workflow-detail-shared.tsx`、`workflow-detail/workflow-detail-artifact-sections.tsx` | modify | 提交、轮询、取消并展示差异/验证状态 | AC-05 |
| `ROADMAP.md`、`plan/002-coding-task-git-delivery.md`、`specs/004-coding-task-async/verify.md` | modify | 如实同步状态与验证限制 | 全部 AC |

## 执行顺序

1. T001：实体迁移、AgentRun/AgentTask 状态方法、事务受理与现有队列派发。
2. T002：AgentLoop taskId/同 Run 恢复、Workspace 文件差异和确定性脚本验证。
3. T003：RAG/Admin API 与 Admin Web 异步状态、取消、验证结果呈现。
4. T004：完整定向回归、构建/类型检查、差异审阅、Roadmap 与 Verify 记录。

## 验证计划

| 层级 | 命令或操作 | 通过条件 |
| --- | --- | --- |
| unit | `cd apps/rag-api && npm test -- --runInBand src/modules/agent-tasks/agent-tasks.service.spec.ts src/modules/agent-runs/agent-runs.service.spec.ts src/modules/agent-loop/agent-loop.service.spec.ts src/modules/workflow/workflow-dispatch-contract.spec.ts src/modules/workflow/coding-task.service.spec.ts src/modules/workflow/production-project-workspace.service.spec.ts src/modules/workflow/production-project-workspace-agent.service.spec.ts src/modules/agent-ops-admin/agent-ops-admin.controller.spec.ts` | 所有定向用例通过；不宣称真实 Sandbox E2E |
| backend build | `cd apps/rag-api && npm run build` | 编译通过 |
| backend lint | `cd apps/rag-api && npx eslint <T001–T003 变更 TypeScript 文件>` | 变更文件通过 |
| admin API | `pnpm --dir apps/admin-api exec tsc --noEmit` 与相关 Jest | TypeScript/相关测试通过 |
| admin web | `pnpm --dir apps/admin-web run lint` 与相关页面测试 | lint/页面测试通过 |
| scope | `git diff --check` 及 scope_gate | 无空白错误、无计划外文件 |
| migration | 编译并检查 `migration:show`；仅在目标确认是本地 loopback 数据库且待执行迁移仅此一项时才应用 | 不连接/修改非本地数据库；不运行生产迁移 |

## 执行控制

- 状态恢复：on
- 独立审查：off（当前协作规则不允许未请求时派生审查 Agent）
- 分支策略：已获主人本轮授权，使用 `codex/rag-coding-task`
- 提交策略：none

## 状态机注册

- 已注册 AC：AC-01–AC-05
- 任务：T001–T004
- 状态文件：`specs/004-coding-task-async/state.json`

## 风险与回退

- 风险：真实沙箱缺失使环境集成仅能以 mocks 验证；任务长期暂停超过 24 小时会丢失 AgentLoop Redis Checkpoint。
- 风险：同步旧 API 继续保留，因此期间有两种入口；管理端只切换到新异步入口。
- 回退：关闭/不调用新端点即可回到旧同步入口；新增 DB 列可通过 migration down 回滚。不得自动执行回滚或删除数据。

## 审批

- Plan 状态：approved
- 批准人：主人
- 批准证据：用户回复“直接做就好了 openSandbox先不做先，没有api key”，明确要求跳过 P0 并直接实施。
