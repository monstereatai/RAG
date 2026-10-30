# 智能体运行时与任务治理

本页描述模型与工具如何在有界运行环境中完成问答和多岗位任务。长期进度、缺口和验证记录统一以[ROADMAP.md](../ROADMAP.md)为准。

## 1. 运行路径

- **统一入口**：所有用户问题进入同一个 `ChatService` 用例；旧 `simple/auto/agentic` 请求值只做兼容归一化。
- **快速路径**：由 QueryPlan 判定为简单问题，执行受约束的检索与证据回答。
- **深度路径**：复杂、多子问题或证据不足时进入状态图，执行规划、检索充分性判断、有限重试和最终收口。
- **产研协作 Workflow**：按岗位依赖组织产品、设计、前端、后端、测试和运营任务；风险节点可以等待人工审批并在修订后局部重跑。

真实节点和状态转换见[功能步骤流程](interview/功能步骤流程.md)。

## 2. 执行边界

| 控制面 | 作用 |
| --- | --- |
| 状态与所有权 | Run、Task、Runtime Event、Checkpoint、Artifact 分别记录请求、工作项、事件、恢复点和交付产物 |
| 工具注册与策略 | 工具先注册风险、权限、Schema 和执行约束，再由执行层进行授权和调用 |
| 预算与取消 | 对运行时间、步骤、工具调用、模型调用次数及累计 Token 预留设上限；HTTP 请求和主要 BullMQ 任务各自共享预算；请求取消与超时沿调用链传递 |
| 人工介入 | 高风险步骤可进入 `pending_approval`；仅内部 Artifact 与隔离工作区命令列入自动批准白名单，其他要求审批的工具缺少可验证审批人时 fail closed；自动策略写独立审计事件。真实 OpenSandbox 隔离仍需目标环境验证 |
| 幂等与恢复 | 持久状态和队列支持重试、恢复和失败查询；关键写操作不可因依赖不可用而静默成功 |
| 结果门禁 | 校验结构化结果、证据引用和任务完成条件；无法满足时标记失败、跳过或待人工处理 |

确定性路径优先由普通代码和 Workflow 执行；模型用于节点内理解、归纳和受约束生成。无限制 ReAct 不作为工作流控制面。

## 3. 中断、异常与重跑

- **用户取消**：普通 Agentic 运行按 Run ID 写 Redis 标记，再把 PostgreSQL Run 更新为 `cancelled`；产研工作流按 Thread 写独立 Redis 标记并更新 LangGraph checkpoint、Run 和未完成 Task。两条链路都向当前模型调用传 `AbortSignal`，并在节点边界复核状态；队列执行器每 500ms 检查工作流取消标记。Redis 不可用或取消标记写入失败时，不伪报跨进程取消成功。底层工具调用不响应取消信号时，要等该调用返回或自身超时后才能退出；已完成的产物不会回滚。
- **客户端断流**：Chat/SSE 的请求断开会立即 abort 本次请求，并尽力写持久取消标记；取消标记写入失败不会变成未处理的 Promise rejection。客户端断流的请求信号仍负责停止本次调用。
- **完成与取消竞争**：Run 终态更新只允许从 `running` / `waiting_approval` 转换；已取消运行不能被迟到的完成或失败事件覆盖。
- **失联运行收口**：启动时及每分钟扫描一次；`running` Run 超过配置时限（默认 30 分钟，最少 5 分钟）仍无更新时，以条件更新改为 `failed`，并尽力写入事件。状态和事件目前不是同一事务，事件存储失败会留服务端错误日志。它只关闭卡住的状态，不自动重放工具操作，因为崩溃时外部副作用是否已完成无法确定。
- **模型预算用尽**：HTTP 请求和主要 BullMQ 任务共享调用数、输入估算和总 Token 保守预留；越界就拒绝后续模型调用。队列预算耗尽后标记任务不再重试，避免重复消耗预算。Token 是估算与最大输出预留，不代表供应商精确计费；独立视觉／Embedding SDK 不在该计数器内。
- **模型降级**：主模型在尚未输出任何 token 时可以切备用模型；已输出部分答案后发生断流则结束为失败，不把两次生成的文本拼在一起。请求取消或超时会向上抛出，不进入普通降级答案。
- **审批恢复**：Chat Agentic 通过 LangGraph `Command.resume` 恢复原检查点，并校验消息 Run ID 与最新 Checkpoint 的 Run ID。产研工作流的 BullMQ 审批任务记录原 Run、批次、步骤和待审批岗位；重试时先核对身份，若工作流已推进到后续批次，只补旧审批的收尾，不会再次应用旧批准。驳回决定先写入 Checkpoint，再更新 Task/Artifact；同一决定重试只补未完成的写入。Checkpoint 进入 `revision_required` 后，事件、运行记录或索引收尾失败也可用相同反馈和岗位重试补齐，不重做 Task/Artifact 副作用。没有原检查点身份的旧审批重试按 fail-closed 处理；Runtime Event 去重只检查最近 500 条。Run 状态与通用 `run.updated` 事件分开写入，但驳回收尾重试会查询完整载荷并补发缺失事件。工作流跨 Worker 的取消与恢复仍需在真实 Redis/BullMQ 环境故障注入验证。
- **运行重跑**：运行中心只允许对当前 Thread 最新的失败/取消 Auto 或 Agentic Run 执行完整链路重跑。它使用新的 Run ID，恢复原运行快照中的 scope、知识库、插件、岗位、审批和记忆开关；附件正文未持久化的请求、旧版不完整快照明确拒绝。旧的 Thread ID 重跑 API 不能保留授权和审批输入，现已 fail closed，返回引导使用运行记录 ID 的新入口。

## 4. 上下文、记忆与工具

Runtime 从当前请求和认证身份开始，依次获取必要的会话状态、有效知识证据和允许使用的工具结果。上下文拼装、裁剪、时间过滤和记忆边界见[项目上下文工程](CONTEXT_ENGINEERING.md)。

常用实现入口：

- Chat 路由与收口：`apps/rag-api/src/modules/chat/chat.service.ts`
- Agentic 检索状态图：`apps/rag-api/src/rag/agentic/`
- 生产工作流 DAG、状态与工具：`apps/rag-api/src/modules/workflow/`
- 通用 Agent Runtime：`apps/rag-api/src/modules/agent-runtime/`
- 工具注册和执行策略：`apps/rag-api/src/tools/`
- Checkpoint：`apps/rag-api/src/providers/langgraph-checkpointer/`
- Run／Task／事件持久化：`apps/rag-api/src/providers/db/entities/`

## 5. 评测与可观测

评测必须区分结构检查、离线样本、真实后端回放和真实业务验收。静态脚本通过不等于答案质量通过；缺依赖、缺凭据或未执行应记录为 `skipped`、`unavailable` 或 `blocked`，不能汇总为成功。

项目已有 RAG、Agent、工作流评测入口和运行 trace。排障时至少区分：解析／权限过滤、计划与路由、召回融合、证据充分性、上下文、模型、工具、持久化与结果门禁。每次运行的结论和限制记录在 ROADMAP，而不是另建时间戳报告。

`eval:agent-tasks` 默认只检查评测样例契约；提供真实运行事件后，会按样例中 `expectedEvents` 的顺序、载荷条件和禁止事件对照轨迹。`eval:conversation-context` 对已审核真实多轮数据比较完整历史、最近 N 轮、无历史和服务端持久会话。case 标记 `expectCompaction:true` 后，脚本会读取服务端运行事件确认摘要压缩，并统计压缩完成后追问的规则命中；它不自动生成追问，也不等同语义保真裁判。当前两种入口都没有真实业务数据的评测报告。可从 `/agent-ops/runtime-events?threadId=...&runId=...` 读取 PostgreSQL 运行事件，按 `{ "runs": [{ "caseId": "retrieval-hybrid", "runId": "...", "events": [...] }] }` 组织后执行：

```sh
AGENT_TASK_EVENTS=/path/to/agent-events.json pnpm --filter backend eval:agent-tasks
```

可只提供部分 case 的真实轨迹，未提供的 case 会列入 `missingCaseIds`；设 `AGENT_TASK_REQUIRE_ALL_CASES=true` 可要求全覆盖。该评测衡量“执行是否经过预期节点”，不判断最终答案是否正确。当前数据集仍标记为模拟样例；真实轨迹需由对应场景的实际运行记录填入，不能用模拟事件报告生产质量。

`AGENT_PLATFORM_REQUIRE_LIVE=true` 用于要求真实后端回放；环境不满足时必须保留 `skipped`／`blocked` 状态。路由回归覆盖 `QueryPlannerService`，Bad Case 回归报告通过 `datasetHash` 标识输入数据集。

代码入口包括：

- `apps/rag-api/scripts/eval-agent-platform.mjs`
- `apps/rag-api/scripts/eval-rag-e2e.mjs`
- `apps/rag-api/scripts/eval-bad-case-regression.mjs`
- `apps/rag-api/scripts/eval-query-routing.mjs`
- `apps/rag-api/src/modules/chat/chat-run-observability.service.ts`
- `apps/rag-api/src/providers/observability/`

质量指标按检索、回答、任务和运行分别判断：Recall／MRR／nDCG 与过滤正确性；引用支撑、拒答和冲突处理；任务完成、工具成功和恢复；延迟、降级、超时及错误率。没有真实数据集和运行记录时，不把目标值写成项目实绩。

## 6. 核心架构决策

1. **Workflow First**：DAG 管依赖、审批和终止条件，模型只在节点内做受约束推理。
2. **多路召回与条件精排**：语义、BM25／全文和可用图谱互补，融合后按质量收益决定是否重排。
3. **证据门禁**：答案关键结论要有可追溯证据，证据不足时拒答或要求确认。
4. **分层记忆**：运行状态、短期会话、长期偏好和治理知识有不同生命周期。
5. **有限预算与可解释降级**：外部依赖按超时、重试和预算受控；降级结果与成功结果分开。

以上决策已从多份独立 ADR 收敛在项目文档中；工程进度和缺口以 ROADMAP 为准。
