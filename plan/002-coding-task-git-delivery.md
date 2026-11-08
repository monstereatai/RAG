# RAG Coding Task 与 Git 交付改造路线图

> 状态：进行中。2026-11-07 已完成并验证 P1 首个 ZIP Workspace 异步 Coding Task 切片；真实 OpenSandbox E2E 按主人要求暂缓，Git Provider/PR/CI 交付及后续 P2/P3 尚未实施。

## 目标

复用现有 Workspace Agent、AgentLoop、Tool Policy、Run/Task/Event、Outbox/BullMQ、OpenSandbox、Artifact 与管理端，逐步补齐可恢复的异步 Coding Task、确定性验收和受控 Git 交付。保留 ZIP 工作区及产研 Workflow DAG，不重建通用 Agent、Sandbox、RAG、审批或队列底座。

## 已核对事实

- 基线为 `main@e497aa7db882a96dd2b4cc9d0f918c15e4970acf`；主人已批准创建并使用 `codex/rag-coding-task`。
- 原 Workspace Agent 是同步 HTTP 调用；本切片新增异步 Coding Task 接口并保留旧同步 API，管理端现提交后轮询。
- `AgentLoopService` 既有 `run()` / `resume()`、预算、取消与 Checkpoint 已复用；未另建 Agent Loop。
- 主人已批准本切片所需 schema/migration；新增 AgentTask 字段及 migration 已实现，migration 未执行。
- OpenSandbox API key/目标服务不可用；主人要求本轮先不做，真实 ZIP 沙箱验收暂缓，不使用模拟结果冒充真实 E2E。

## 分期

### P0：真实 ZIP 工作区验收（暂缓）

- 通过现有路径验收 ZIP → OpenSandbox → Agent 命令 → 测试/构建 → 预览 → 导出。
- 核对租户隔离、egress、资源限制、取消/超时、失联错误、销毁回收和导出拒绝。
- 只使用无敏感演示项目；不改安全策略来迁就测试。
- **进入条件**：主人在目标环境安全配置并启动 OpenSandbox；Codex 只核验配置是否具备，不收集或回显密钥。
- **完成条件**：真实服务端与 SDK 兼容，运行结果和导出文件可复核；否则记录具体阻塞，不把 mock 结果当实测。
- 当前状态：主人表示 OpenSandbox 尚无 API key，要求先不做；待目标环境可用后再安排。

### P1：Coding Task 持久化与 Git 交付

1. **已完成（ZIP 模式）**：将现有 Workspace Agent 接入可查询、可取消的异步 Coding Task；保存稳定 `taskId/runId/attempt`、进度与可解释终态，复用现有 Run/Task/Event、Outbox/BullMQ 和 `AgentLoop.resume()`。
2. **已完成（本地/mock 验证）**：按实际 ZIP manifest 生成文件差异，并对已声明的 lint/test/build 脚本记录退出码和输出；未运行/不适用/失败分别呈现，LLM 的 `complete` 仅触发验收。
3. 保留 ZIP 模式，新增授权 Git 仓库来源、基准 commit、工作分支、Diff、受控提交、PR/CI 状态及远端副作用对账；unknown 先查询远端，不盲目重放。
4. **已完成（Coding Task 部分）**：扩展 Agent Ops API 与现有管理端页面，展示任务进度、事件、取消、验收结果和 Diff；Git 交付状态待后续切片。
- **完成条件**：直接 Coding Task 不阻塞 HTTP；同一 Run 可恢复或明确停止等待对账；Worker 中断后可解释/接管；重试不会重复创建 PR；旧 ZIP 路径通过回归。
- **审批门**：所需 schema/migration、仓库凭据配置、网络白名单、CI/CD 配置分别单独确认后才实施对应部分。

### P2：产研 Handoff 与步骤控制

- 在现有质量/审批门禁后，将已审核 Handoff Manifest 派发为 Coding Task。
- 增加版本化的 `auto / approval / manual` 步骤策略与绑定 Run/Step/Attempt 的审批身份；与现有岗位审批、工具审批分层。
- 复用 Admin API/Web 的权限边界，补充 Step timeline、人工接管、后端/QA 的明确工具授权。
- **完成条件**：拒绝只返工必要步骤；审批不能跨 Run/Step 复用；外部副作用不因人工重试而重放。

### P3：按需扩展

- 仅在真实任务证明内置 Agent 不足时接入一个外部 Coding Agent；之后再评估飞书 Bot/审批。
- 生产部署、主分支合并和数据库迁移保持独立人工审批；本路线图不授权发布或部署。

## 实施与验证控制

- OpenSandbox P0 未通过；本地 mock/单测不代表真实 Sandbox 验收。
- 首个 P1 切片已获主人批准并完成：定向 RAG API Jest、RAG build、Admin API Jest/typecheck、Admin Web Hook 测试/lint、`git diff --check` 均通过；真实 OpenSandbox E2E 暂缓。
- 已获主人批准的分支和 migration 只在本地建立；本轮没有应用数据库 migration、提交、推送或部署。
- 提交策略：`none`；未经单独指示不提交、不推送、不合并。

## 尚待确认

- 真实 OpenSandbox 目标环境及 API key 何时可供验收。
- Git Provider、仓库 allowlist、凭据托管和 PR/CI 服务的目标契约。
- Git 交付、P2 Handoff/步骤审批和 P3 外部 Coding Agent 尚未实施。
