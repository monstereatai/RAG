# ZIP Workspace 异步 Coding Task 与确定性验收

## 背景与目标

- 背景：现有 Workspace Agent 通过同步 HTTP 请求运行，并在服务内部生成 `runId`；运行时间最长约 8 分钟。`AgentLoop` 已有 Checkpoint、`resume()`、取消与工具幂等保护，但 Coding 入口没有持久任务状态或同一 Run 的恢复契约。
- 目标：保留现有 ZIP 工作区和旧同步接口，新增异步 Coding Task；以现有 AgentRun/AgentTask、Outbox/BullMQ、AgentLoop 和运行事件支撑查询、取消、安全恢复和确定性验收。
- 成功标准：管理端提交后立即拿到稳定 `taskId/runId`；任务可按用户/租户查询和取消；Worker 重试沿用同一 runId；未知副作用不会自动重放；代码差异和适用的 lint/test/build 结果由规则产生并准确呈现。

## 范围

- 包含：现有 Workflow 内 ZIP Workspace Agent 的异步任务入口；请求幂等、持久状态、取消、Checkpoint 恢复；ZIP 文件差异；检测并运行项目已声明的 lint/test/build 脚本；管理端轮询和结果展示。
- 不包含：OpenSandbox 真实环境验收（按主人指示暂缓）；Git 仓库来源、分支/提交/PR/CI；直接脱离 Workflow 的开发入口；P2 StepPolicy/Handoff；外部 Coding Agent、飞书 Bot、生产部署。

## 用户与行为

### AC-01：异步受理与归属查询

- 前置条件：用户拥有目标 Workflow 和 ready 的代码 ZIP Artifact。
- 操作：管理端提交开发指令与稳定 `requestId`。
- 预期结果：API 快速返回 `taskId/runId/status`；可以只按同一 owner/tenant 读取任务及运行事件；同一 `requestId` 同一请求返回原任务，参数不同返回冲突。
- 验证方式：Controller/Service 测试覆盖受理、重复请求、身份/租户越界和参数冲突。

### AC-02：持久队列与安全恢复

- 预期结果：Task、Run 和 Outbox 在同一数据库事务中创建；Outbox 到现有 BullMQ 的 jobId 稳定。Worker 自动重试只使用相同 taskId/runId；仅从同一 AgentLoop Checkpoint 恢复。没有可恢复 Checkpoint、Checkpoint 超期或存在 `tool.unknown` 时置为可解释阻塞/待对账，不从初始状态盲目重放。
- 验证方式：事务/Outbox/重复 job 测试，Worker 重试与缺失 Checkpoint 测试。

### AC-03：状态、事件与取消保真

- 预期结果：保留 `completed / failed / blocked / budget_exceeded / cancelled` 的 Loop 结果；任务额外区分 `queued / running / waiting_review / waiting_reconciliation / verification_failed`。取消沿用 AgentRun/Redis 取消标记；迟到结果不能覆盖 cancelled。状态与事件均关联 taskId/runId。
- 验证方式：状态映射、取消并发和运行事件关联测试。

### AC-04：确定性 ZIP 验收

- 预期结果：比较 seed ZIP 与当前工作区，保存新增/修改/删除文件列表；仅运行 `package.json` 中实际声明的 lint/test/build 脚本，记录命令、退出码和有界输出。缺少脚本标记 `not_applicable`，未执行标记 `not_run`，不得显示为通过。模型 `complete` 只触发验收；适用检查失败为 `verification_failed`，无适用检查或无差异时进入 `waiting_review`，只有存在差异且所有适用检查通过才为 `completed`。
- 验证方式：ZIP manifest 差异、脚本发现、退出码映射和完成门禁测试。

### AC-05：管理端任务控制

- 操作：从现有 Workflow Workspace 区域发起异步任务。
- 预期结果：页面展示排队/执行/阻塞/取消/验收状态、步骤日志、差异文件和逐项检查结果；运行中可取消；页面不等待 Coding Task 完整执行才返回。
- 验证方式：Admin API 路由测试、管理端组件/Hook 测试及 lint/typecheck。

## 边界与约束

- 兼容性：保留原 `POST workflows/:threadId/workspace/agent` 同步接口；新增异步入口供管理端切换使用。
- 状态语义：`AgentTaskEntity` 是任务细节权威源，`AgentRunEntity` 保留通用 Run 状态；AgentLoop Redis Checkpoint 只作恢复游标，不能替代数据库任务记录。
- 安全：所有任务操作先验证 owner、tenant、thread；不修改 `.env`、网络白名单、CI/CD，不写入或回显凭据；Tool Policy 和现有隔离命令策略不放宽。
- 沙箱限制：目标 OpenSandbox 尚未配置，本次只能做 mock 单测/静态验证，不能宣称真实 ZIP 工作区 E2E 通过。
- 生命周期：复用当前 6 小时 Workspace 与 24 小时 AgentLoop Checkpoint；超过有效期或缺少必要状态时明确阻断，不声称跨期恢复。

## 待确认项与假设

- [x] 用户已授权跳过 OpenSandbox P0，并要求直接实现。
- [x] 用户已授权创建 `codex/rag-coding-task` 分支及本切片所需 schema/migration。
- [ ] Git Provider、凭据和目标仓库契约属于后续切片，不在本次假设。

## 审批

- Spec 状态：approved
- 批准人：主人
- 批准证据：用户回复“直接做就好了 openSandbox先不做先，没有api key”。
