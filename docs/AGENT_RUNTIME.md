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
| 预算与取消 | 对运行时间、步骤、工具调用和重试设上限；请求取消与超时沿调用链传递 |
| 人工介入 | 高风险步骤可进入 `pending_approval`；审批恢复前验证用户、任务和剩余执行上下文 |
| 幂等与恢复 | 持久状态和队列支持重试、恢复和失败查询；关键写操作不可因依赖不可用而静默成功 |
| 结果门禁 | 校验结构化结果、证据引用和任务完成条件；无法满足时标记失败、跳过或待人工处理 |

确定性路径优先由普通代码和 Workflow 执行；模型用于节点内理解、归纳和受约束生成。无限制 ReAct 不作为工作流控制面。

## 3. 上下文、记忆与工具

Runtime 从当前请求和认证身份开始，依次获取必要的会话状态、有效知识证据和允许使用的工具结果。上下文拼装、裁剪、时间过滤和记忆边界见[项目上下文工程](CONTEXT_ENGINEERING.md)。

常用实现入口：

- Chat 路由与收口：`apps/rag-api/src/modules/chat/chat.service.ts`
- Agentic 检索状态图：`apps/rag-api/src/rag/agentic/`
- 生产工作流 DAG、状态与工具：`apps/rag-api/src/modules/workflow/`
- 通用 Agent Runtime：`apps/rag-api/src/modules/agent-runtime/`
- 工具注册和执行策略：`apps/rag-api/src/tools/`
- Checkpoint：`apps/rag-api/src/providers/langgraph-checkpointer/`
- Run／Task／事件持久化：`apps/rag-api/src/providers/db/entities/`

## 4. 评测与可观测

评测必须区分结构检查、离线样本、真实后端回放和真实业务验收。静态脚本通过不等于答案质量通过；缺依赖、缺凭据或未执行应记录为 `skipped`、`unavailable` 或 `blocked`，不能汇总为成功。

项目已有 RAG、Agent、工作流评测入口和运行 trace。排障时至少区分：解析／权限过滤、计划与路由、召回融合、证据充分性、上下文、模型、工具、持久化与结果门禁。每次运行的结论和限制记录在 ROADMAP，而不是另建时间戳报告。

`AGENT_PLATFORM_REQUIRE_LIVE=true` 用于要求真实后端回放；环境不满足时必须保留 `skipped`／`blocked` 状态。路由回归覆盖 `QueryPlannerService`，Bad Case 回归报告通过 `datasetHash` 标识输入数据集。

代码入口包括：

- `apps/rag-api/scripts/eval-agent-platform.mjs`
- `apps/rag-api/scripts/eval-rag-e2e.mjs`
- `apps/rag-api/scripts/eval-bad-case-regression.mjs`
- `apps/rag-api/scripts/eval-query-routing.mjs`
- `apps/rag-api/src/modules/chat/chat-run-observability.service.ts`
- `apps/rag-api/src/providers/observability/`

质量指标按检索、回答、任务和运行分别判断：Recall／MRR／nDCG 与过滤正确性；引用支撑、拒答和冲突处理；任务完成、工具成功和恢复；延迟、降级、超时及错误率。没有真实数据集和运行记录时，不把目标值写成项目实绩。

## 5. 核心架构决策

1. **Workflow First**：DAG 管依赖、审批和终止条件，模型只在节点内做受约束推理。
2. **多路召回与条件精排**：语义、BM25／全文和可用图谱互补，融合后按质量收益决定是否重排。
3. **证据门禁**：答案关键结论要有可追溯证据，证据不足时拒答或要求确认。
4. **分层记忆**：运行状态、短期会话、长期偏好和治理知识有不同生命周期。
5. **有限预算与可解释降级**：外部依赖按超时、重试和预算受控；降级结果与成功结果分开。

以上决策已从多份独立 ADR 收敛在项目文档中；工程进度和缺口以 ROADMAP 为准。
