# 高级 Agent 平台能力现状

更新时间：2026-09-21

这份文档只记录当前仓库已经落地、已经验证，或明确标注边界的能力。它不是“未来规划清单”。

## 结论

项目已经具备高级 AI 应用／Agent 的主要工程骨架：三条问答链路、Agent Loop、LangGraph Checkpoint、审批恢复、运行中心、质量评测、Prometheus 指标、Langfuse 追踪和故障降级都已存在。本次补齐了四个生产缺口：

1. Agent Run 可以取消、记录取消原因和最后检查点，并且取消是幂等的。
2. Trace span 从只保留内存，升级为优先写 PostgreSQL；数据库不可用时仍回退内存，不阻塞问答。
3. 统一评测默认覆盖 `simple`、`auto`、`agentic`，CI 会执行确定性质量门禁。
4. 增加 Agent Runtime 的 Prometheus 告警与 Grafana 看板模板，部署时再接入实际环境。

## 能力边界

### Agent Runtime

- `agent_runs` 保存 `cancelledAt`、`cancelReason` 和 `lastCheckpointAt`。
- `POST /api/v1/agent-ops/run-center/:id/cancel` 支持取消运行。
- Agent Loop 每轮开始前读取 Redis 取消标记，在安全边界结束，不会在未知副作用状态下自动重放。
- 失败或取消的运行才允许重试；终态运行的取消请求保持幂等，不会被重新打开。
- 迁移文件：`backend/src/migrations/1787800000000-AddAgentRuntimeControls.ts`。

### 审批与恢复

现有工作流继续使用 `pending_approval`、`revision_required`、`resume` 和 `revise` 状态流。工具层已有 `completed`、`running`、`unknown` 幂等状态：未知副作用只能进入人工确认或局部重跑，不能直接盲目重放。审批、恢复、运行和工具动作通过 Runtime Event 关联到 `threadId`、`runId`。

这部分不等于“所有业务都自动审批”。高风险动作仍要走审批；不需要审批的任务只能通过自动门禁和证据校验后继续。

### 三条问答链路评测

`npm run eval:agent-platform` 是统一入口，执行以下门禁：

- Query Routing：内部信息必须 `local_only + retrieve`，公共稳定事实才允许直答。
- Agent Task：工作流、检索、Bad Case、工具降级、引用、拒答和记忆覆盖。
- Production Workflow：岗位 DAG、并发批次、审批、局部重跑、证据门禁和工具预算。
- Project／Hybrid RAG 接口回放：默认请求 Simple、Auto、Agentic 三种模式；后端不可用时只报告 `skipped`，不会冒充线上通过。

真实服务回放时，可显式设置：

```bash
cd backend
AGENT_PLATFORM_REQUIRE_LIVE=true npm run eval:agent-platform
```

这会要求服务健康检查、登录、上传评测资料，并通过同一个 `/api/v1/chat` 入口逐模式执行。评测报告会保留答案、引用数量、检索充分性、路由和失败原因。

`eval:query-routing`、`eval:golden-business` 与 `eval:agent-platform` 会把最新报告写入 `.tmp/evidence`（可用 `EVAL_REPORT_DIR` 指向其他目录）。RAG Admin／RAG Ops 治理接口读取这些报告，不再用硬编码的“通过”数据填充后台；缺少报告时会明确显示不可用，而不是把未执行误报为通过。

本次补充了 `backend/eval/golden-business.dataset.json` 业务黄金评测集：当前包含 86 条可审计案例和 37 份脱敏／项目样本文档，覆盖内部业务问答、多轮上下文、冲突事实、引用准确性、拒答／联网降级和三模式路由六个维度。它通过 `npm run eval:golden-business` 做离线结构校验；设置 `GOLDEN_EVAL_REQUIRE_LIVE=true` 后，会登录真实后端、上传样本文档，并对同一批问题分别调用 `simple`、`auto`、`agentic` 三种模式，输出分模式通过率、引用数、检索充分性、路由和失败原因。

评测集目前是仓库内可复现的脱敏基线，不等同于真实生产黄金集。接入真实内部问题时，只需保留同一字段和六类维度，将 `sourceDocument.content` 替换为经过权限脱敏的业务资料，并由业务专家确认参考答案、引用片段和拒答边界。

三条链路现在共用证据顺序和回答门禁：已执行的 Rerank 结果优先按 `rerankScore` 排序，未执行 Rerank 的候选回退到 RRF 的 `totalScore`；生成结果统一经过引用校验，失败后按受约束语义总结、结构化事实抽取、安全降级依次处理。Agentic 的多路并发结果汇合后也复用同一排序器，不再把 Rerank 结果重新按旧 RRF 分数打乱。

### 可观测性

- HTTP 和 Agent Node span 写入 `trace_spans`，查询接口优先读数据库。
- 数据库暂时不可用时，查询回退到最近 200 个内存 span，并写告警日志。
- 原有 Prometheus 指标继续覆盖 HTTP、检索、LLM、缓存、Agent 节点、工具调用、空检索和循环终止原因。
- 新增模板：`docker/monitoring/prometheus/alerts.yml`、`docker/monitoring/grafana/rag-agent-overview.json`。
- 看板与告警模板不包含生产地址、密钥或通知接收人，部署时需由运维接入现有 `monitoring/` 配置。

## 当前不能宣称的内容

- 没有真实生产流量、真实业务评测集和告警接收地址时，不能宣称“生产 SLA 已达标”。
- CI 默认只做确定性评测；真实三模式接口评测必须在后端、数据库、Redis、Milvus 和模型配置齐全时设置 `AGENT_PLATFORM_REQUIRE_LIVE=true`。
- 黄金集的离线结构校验通过，不代表 86 条案例在真实模型和真实内部资料上全部答对；真实业务准确率、引用精度和路由准确率必须在 `GOLDEN_EVAL_REQUIRE_LIVE=true` 回放后，再由业务专家复核。
- `eval:query-routing` 的离线结果是用记录的模型结构化输出执行生产 `QueryIntentRouter` 的契约回放，不等同于真实模型每次推理的准确率；需要真实模型评测时，应提供固定模型、配额和采样窗口后再运行线上回放。
- 三模式 Hybrid E2E 在未配置服务时只会报告 `skipped`；设置 `AGENT_PLATFORM_REQUIRE_LIVE=true` 后，服务不可用或任一模式失败会返回非零，不能把“未执行”算作通过。
- Bad Case 回归现在走标准 `/api/v1/chat`，并校验引用、检索充分性、纠正内容、禁词和可选路由；每次报告带 `datasetHash` 便于跨时间窗口对账；无审核样本时是 `skipped`，不能作为质量通过证据。
- 新增迁移需要在目标环境执行 `npm run migration:run`，本地构建通过不代表生产数据库已经升级。

## 验证入口

本次变更的完整证据记录见：

- `specs/044-senior-agent-platform/verify.md`
- `specs/044-senior-agent-platform/evidence/`
