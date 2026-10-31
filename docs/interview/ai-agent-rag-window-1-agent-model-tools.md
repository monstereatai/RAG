# 执行窗口 1：Agent、模型与工具

本任务单供主人在第 1 个 Codex 窗口执行。它拆分自[当前缺口清单](./ai-agent-rag-missing-and-optimization-checklist.md)，不替代原清单；以原清单和当前源码为准。

## 负责范围

- 技术栈与面试模块：T00–T13。
- 第 5 节中与工具发现、多 Agent/A2A 相关的 P2 优化项。
- 个人面试准备项只给准备建议，不伪装成仓库代码缺口。

## 独占源码范围

- `apps/rag-api/src/providers/llm/`
- `apps/rag-api/src/modules/agent-loop/`
- `apps/rag-api/src/modules/agent-runtime/`
- `apps/rag-api/src/modules/agent-collaboration/`
- `apps/rag-api/src/modules/supervisor/`
- `apps/rag-api/src/modules/skills/`
- `apps/rag-api/src/providers/mcp/`
- `apps/rag-api/src/tools/`
- `apps/rag-api/src/rag/prompts/`

不要修改其他窗口负责的记忆、文档索引/召回、队列/Tracing、Sandbox、Admin Web 和评测目录。

## 当前已知实现，避免重复造轮子

- `LlmProvider` 启动时校验当前选择的 Qwen/DeepSeek/智谱 Key；未选中的 Provider 不阻断启动，fallback 仅在对应 Key 非空时启用。
- Agent Loop 已有步数、工具次数、总时限、取消、Redis 中止信号、成功检查点与身份校验恢复。
- 写权限工具无论调用方是否标注 `sideEffect` 都要求 Redis 原子幂等状态；未取得锁 fail-closed。工具结果 `unknown` 会让 Agent Loop 停止后续动作。RAG 内部 reconciliation service 可在终态事件缺失时凭唯一 `tool.call`、精确 unknown marker 和已过期 lease 登记人工结论；`runId` 可从该事件推导。可序列化且不超过 20,000 字符的结果仅在 Redis 临时保留一小时供重放；更大或不可序列化的结果会保留完成标记并明确提示不重跑，但结果本身无法恢复。Admin API 的 RBAC 转发与管理台入口仍由第 4 窗口接线。Redis/进程崩溃后的真实外部副作用仍要目标系统核实。
- MCP Provider 只把逐工具策略完整、alias 唯一的工具交给 Agent Loop；策略要求权限、风险、审批、mode、timeout、tenantScope，tenant 工具还要求 schema 有 `tenantId` 并由服务端可信上下文覆盖。Agent Loop 可将返回的 MCP alias 经现有 ToolExecution 执行。当前业务决策器尚未主动选择 MCP 工具；远端 ACL 必须由 MCP Server 再校验，尚未目标环境联调。Skills 已有 SHA-256 版本、运行注入记录；`skillLimit` 已做边界归一，0 时早退。
- Prompt Registry 已有版本/hash 元数据；上下文与生成输入预算已有裁剪。
- Python/FastAPI 及其专属 API、Java/Spring 及其专属 API按主人确认排除。

## 执行规则

1. 先检查 `git status --short` 和目标文件现有 diff；保留已有未提交改动。
2. 只修有源码证据、且不依赖目标模型、真实工具目录或业务规则即可确定的功能缺口；不要为题库扩建自治 Agent 或 A2A。
3. 不运行单测。可以做目标文件 lint、类型/构建静态检查；四个窗口并行期间不要运行会覆盖共享 `dist/` 的全量 build。
4. 完成后向主人报告：修改文件、行为变化、未验证的真实场景，以及一条可合并进 ROADMAP 的进展描述。并行期间由主窗口统一合并 ROADMAP/缺口清单，避免同时改同一文档。

## T00–T13 逐项结果

| 项目 | 当前结果 | 证据与未闭环内容 |
| --- | --- | --- |
| T00 项目叙事与职责 | 不改仓库 | 由主人补真实职责、决策、协作边界和可核验结果。 |
| T01 Python/FastAPI | 按确认范围排除 | Python/FastAPI 及语言专属 API 不纳入本项目改造。 |
| T02 技术栈选型 | 现有实现可供讲解 | `CLAUDE.md` 锁定 NestJS、LangChain/LangGraph、Milvus、PostgreSQL、Redis、Elasticsearch；仍需准备取舍和迁移代价。 |
| T03 LLM 基础与推理 | 不改仓库 | 需准备上下文、采样、工具调用等理论并联系真实项目案例。 |
| T04 模型接入与选型 | 补齐选中 Provider Key 启动校验、无 Key fallback 跳过 | `apps/rag-api/src/providers/llm/llm.provider.ts`、`llm-gateway.policy.ts`；真实任务集上的质量、延迟、成本比较仍待数据。 |
| T05 Agent 推理范式 | Agent Loop 与确定性 Workflow 已有实现 | `apps/rag-api/src/modules/agent-loop/agent-loop.service.ts`、`apps/rag-api/src/modules/supervisor/supervisor.service.ts`；需用真实轨迹解释路由和任务成功标准。 |
| T06 LangChain/LangGraph | 已有执行、重试、取消、checkpoint 链路 | `apps/rag-api/src/rag/agentic/`、`modules/agent-loop/`；需准备按真实源码讲解状态、节点、边和恢复。 |
| T07 多 Agent 协作 | 协作数据模型和工作流编排已存在 | `apps/rag-api/src/modules/agent-collaboration/`、`modules/supervisor/`；真实委派/协作收益待样本，不扩建自治协商或 A2A。 |
| T08 Function Calling/工具契约 | ToolExecution 按有效 `permission: write` 启用 Redis 原子幂等；未知副作用会阻断 Agent Loop；RAG 内部 reconciliation 支持事件缺失时按唯一调用和精确 unknown marker 人工对账，也支持旧调用缺少 `runId` | `apps/rag-api/src/tools/tool-execution.service.ts`、`tool-execution-reconciliation.service.ts`、`modules/agent-loop/agent-loop.service.ts`；Admin API 的 RBAC 转发/UI 尚未接；外部副作用核验仍需真实系统证据。 |
| T09 MCP/A2A | Agent Loop 向决策回调提供获准 MCP 工具目录，并将所选 alias 经 ToolExecution 执行；无效/无范围策略默认隐藏 | `apps/rag-api/src/providers/mcp/mcp.provider.ts`、`modules/agent-loop/agent-loop.service.ts`；现有业务决策器尚未主动消费 MCP 目录；远端 ACL 与目标协议仍待联调。A2A 按真实场景评估。 |
| T10 工具发现 | 有静态 Tool Registry 与插件约束 | `apps/rag-api/src/tools/tool-registry.ts`、`modules/plugin-runtime/`；真实工具目录下的选择准确率、遗漏率、延迟和上下文成本待测。 |
| T11 Skills | 有版本 hash、运行注入记录与边界处理 | `apps/rag-api/src/modules/skills/`；真实 Bad Case 人审、版本修改和回归质量待验证。 |
| T12 Prompt/结构化输出 | 有 Prompt Registry 与模型调用版本 metadata | `apps/rag-api/src/rag/prompts/prompt-registry.ts`、`providers/llm/llm.provider.ts`；生产 trace 关联和真实提示词回归仍待验证。 |
| T13 上下文工程/压缩 | 有输入预算和裁剪实现 | `apps/rag-api/src/providers/llm/llm.provider.ts`、`docs/CONTEXT_ENGINEERING.md`；真实多轮摘要保真、字段保留及估算误差待测。 |

## 仍需本人或目标环境提供

T04 模型质量/延迟/成本对比、T05/T07 真实 Agent 轨迹与协作收益、T08 外部副作用查询/补偿证据及 Admin API RBAC/UI 转发、T09 真实 MCP Server 权限策略和远端 tenant ACL、MCP 写/高风险工具的可信审批上下文、T10 工具选择收益、T13 多轮摘要保真仍需要业务授权、策略或真实服务/样本。Agent Loop 目前没有可信 approver 注入，因此 MCP 写/高风险调用会安全地被阻断；不能让模型提供审批人。当前 smoke 只证明本地 MCP 协议连通和 status 工具调用，不代表业务 MCP 已接入或 ACL 已验证。缺少这些输入时保持默认拒绝并记录阻塞证据，不编造指标或扩大执行权限。

## 本轮执行结果（2026-10-31）

- 多个子 Agent 并行复核 T00–T13；本地补齐 Provider Key/fallback fail-fast、写工具幂等、unknown 阻断与人工 reconciliation、MCP 策略化调用入口及 tenantScope 默认拒绝。幂等键采用租户/线程/工具范围隔离；旧格式 marker 不回放结果。MCP 业务策略和远端 ACL 仍待配置/联调。
- 本地证据：`LlmProvider.onModuleInit` / `LlmGatewayPolicy.fallbackProvider`、`ToolExecutionService` / `ToolExecutionReconciliationService` / `AgentLoopService`、`McpProvider`、`mcp:validate` 与本地 `smoke:mcp`。T00–T03/T06 个人讲解项已标明；真实轨迹和模型对比未编造。
- MCP runtime 层已连接，但当前业务 `decide` 回调没有实际选择 MCP 工具；没有统一 LLM `bindTools` 调度器，本轮保持现有业务工作流架构。要让具体业务使用 MCP，仍需该业务的决策器、可信写操作审批上下文和远端 ACL 验收。Agent Loop 没有 approver 注入，所以写/高风险 MCP 工具会保持 fail-closed。
- RAG 内部 reconciliation 可处理匹配的 unknown 事件、调用事件之后未写出终态事件的 orphan unknown marker、过期 running 和缺失 marker，并且不会自动调用工具；`runId` 缺省时只从 tenant/thread 下唯一的持久化调用事件推导。受信运营人员仍须提供完成/未执行/已补偿证据。Admin API 的 `admin:qa-ops:write` 转发/操作者身份注入和 UI 入口仍待第 4 窗口；本地接口本身不能替代这层 RBAC。工具执行只传递 AbortSignal，不能保证忽略取消的远端服务不会迟到提交；各真实写工具仍需验证目标端幂等、状态查询和补偿。当前 RedisProvider 使用单节点客户端；若部署迁移至 Redis Cluster，执行锁 Lua 还需把 legacy 兼容 key 纳入同一 hash slot 并制定旧 key 迁移策略。
- 验证：MCP 相关文件 Prettier、`pnpm run mcp:validate`、`pnpm run smoke:mcp` 由前序执行记录通过；本轮改动文件 ESLint/Prettier、RAG API `pnpm exec tsc --noEmit -p tsconfig.build.json`、`pnpm run docs:consistency` 和全仓 `git diff --check` 通过。未运行全量 build 或单测。
