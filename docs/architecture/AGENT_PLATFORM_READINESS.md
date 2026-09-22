# 高级 Agent 平台能力现状

更新时间：2026-09-22

这份文档只记录当前仓库已经落地、已经验证，或明确标注边界的能力。它不是“未来规划清单”。

## 结论

项目已经具备高级 AI 应用／Agent 的主要工程骨架：三条问答链路、Agent Loop、LangGraph Checkpoint、审批恢复、运行中心、质量评测、Prometheus 指标、Langfuse 追踪和故障降级都已存在。本次补齐了四个生产缺口：

1. Agent Run 可以取消、记录取消原因和最后检查点，并且取消是幂等的。
2. Trace span 从只保留内存，升级为优先写 PostgreSQL；数据库不可用时仍回退内存，不阻塞问答。
3. 统一评测默认覆盖 `simple`、`auto`、`agentic`，CI 会执行确定性质量门禁。
4. 增加 Agent Runtime 的 Prometheus 告警与 Grafana 看板模板，部署时再接入实际环境。

本轮又收敛了五类容易造成“看起来通过、实际不可靠”的问题：结构化直答会校验问题目标与证据事实是否匹配，评测后台区分离线结构校验与真实问答，Agent Loop 检查点保存并恢复已消耗的时间预算，生产工作流租约会续期且队列操作使用稳定任务 ID，Auto 文档与多意图实现保持一致。

本轮还把异步租户上下文和真实 usage 观测接入运行边界：文档入库队列、产研工作流队列和新工作流 Redis Checkpoint 均携带 `tenantId`，Worker 恢复时继续传递并在文档写入／工作流读取侧校验；LLM Provider 解析 LangChain／OpenAI 兼容响应中的真实 prompt／completion token，Prometheus 以 `rag_llm_tokens_actual_total` 单独记录，Chat Run 在有真实 usage 时标记 `provider_reported_tokens`，没有 usage 时保留 `estimated_from_completed_nodes`，避免把估算值误当供应商账单。统一请求上下文还注册了 LangChain `handleLLMEnd` 回调：直接使用底层 `getModel()` 的结构化／流式调用会从原始 `LLMResult.llmOutput.tokenUsage` 回传 usage，并与 `invoke()` 走同一统计口径且不会重复上报。供应商没有返回 usage 时仍只能使用估算，供应商账单对账和价格版本管理仍需目标环境接入。

本轮生产边界又补齐了运行控制与安全门禁：Agent Run 的完成／取消使用带状态条件的原子更新；检查点键包含 `runId`，并发运行互不覆盖；Redis 不可用且开启 `REQUIRE_DISTRIBUTED_LOCK=true` 时，定时任务和生产工作流拒绝执行副作用，写入型工具在幂等存储不可用时 fail-closed。生产工作流队列提供状态、失败任务列表和按 owner 重试入口；ACL 缓存失效使用 `SCAN`，ES 映射异常不再自动删除已有索引，文档删除按 owner 过滤。外部 URL 导入会拒绝私网／本机地址并校验 DNS、重定向和动态渲染后的最终地址；聊天与 AG-UI 断流同时触发本地 AbortSignal 和持久取消标记。
本次补齐运行治理边界：聊天／AG-UI 的 SSE 退订会按会话和用户写入取消标记，并提供 `POST /api/v1/chat/conversations/:threadId/cancel` 主动取消入口；文档 ACL 替换在单事务内完成，提交后才清理权限缓存。
本轮继续收口安全与可靠性边界：内部管理 API 的 `ServiceTokenGuard` 不再接受普通 JWT；浏览器 SSE／TTS 改用 60 秒、一次性 Redis 票据，长期 JWT 不进入 URL；工具预算使用带旧计数条件的原子预留，副作用完成标记写入失败会返回 `unknown`；LLM 调用会继承请求取消信号，生产可通过 `REQUIRE_CORE_DEPENDENCIES=true` 和 `REQUIRE_DISTRIBUTED_TOKEN_STORE=true` 将 Redis 缺失提升为未就绪。查询日志在入库前脱敏并按保留期清理，Milvus 删除补偿在 Redis 可用时持久化，其他索引通过只读对账接口暴露状态；生产启用周期性索引 Reconciler，将可修复缺口投递到 Redis／BullMQ，队列不可用时自动修复 fail-closed。
管理后台运行详情补上显式 Run／Artifact 契约，首次加载、轮询和页面卸载都会传播 `AbortSignal`，避免旧请求在切换运行详情后覆盖新状态。
本地运行验收已在 `TYPEORM_SYNCHRONIZE=false` 下完成：两份 Backend 实例同时连接 PostgreSQL、Redis、Elasticsearch、Milvus、Neo4j，并分别通过健康检查、登录和文档队列状态检查；Redis Checkpoint 双进程恢复 smoke 通过。该结果证明共享依赖和基础运行路径可用，不代表生产故障转移、死信接管、容量水位或 SLA 已验收。
索引对账接口现在以 PostgreSQL 分块数为基准，同时核对 BM25、Elasticsearch、Milvus 和启用时的 Neo4j 来源投影；每个索引明确返回 `ok／mismatch／unavailable／skipped`。发现异常后，管理端可将选中文档提交到 Redis／BullMQ `rag-index-repair` 队列，由任一 Backend 实例执行重建并提供失败重试；生产或严格依赖模式缺少 Redis 时拒绝修复任务，开发环境才允许同步降级。生产默认按周期运行 Reconciler，仅将计数不一致或图谱缺口投递到修复队列，避免把审批／过期等治理问题误当成索引问题；状态和手动触发入口为 `/rag/admin/documents/index-reconciler/status` 与 `/rag/admin/documents/index-reconciler/run`。这仍不等同于数据库事务内 Outbox，跨写入原子性和真实故障演练需在目标环境验收。
Domain Event Outbox 的多实例定时派发现在使用 Redis 租约，同一时刻只由一个 Backend 扫描并投递；生产 Redis 不可用时停止派发，避免退化成重复 webhook。并发写入撞到唯一幂等键按已存在处理，其他数据库错误继续暴露。文档审核状态／审核记录、归档／恢复与版本生效已经把业务写入和对应 Outbox 记录放入同一个 PostgreSQL 事务；事务边界外的 ES／BM25 同步继续由索引对账修复。其他业务领域尚未接入同事务 Outbox。
生产 `core.requireDependencies` 默认开启，`/health/ready` 会把认证共享存储、租户配额、分布式锁和 Outbox 租约涉及的 Redis 视为必需依赖；异步队列拒绝入队时，实例也会同时从负载均衡就绪池摘除。
固定的 `documents/index-audit` 路由已置于动态任务／文档参数路由之前，真实本地服务回放返回 200；当前存量资料中发现 BM25、Elasticsearch、Milvus 与 PostgreSQL 分块数不一致。生产 Reconciler 会把可修复缺口交给持久修复队列，开发环境仍不会因只读审计自动改写本地存量索引，需通过人工确认后的重建入口处理。

## 能力边界

### Agent Runtime

- `agent_runs` 保存 `cancelledAt`、`cancelReason` 和 `lastCheckpointAt`。
- `POST /api/v1/agent-ops/run-center/:id/cancel` 支持取消运行。
- `POST /api/v1/chat/conversations/:threadId/cancel` 支持用户按本人会话主动取消当前运行；浏览器断开聊天／AG-UI SSE 时也会触发同一归属校验和取消标记。
- Agent Loop 每轮开始前读取 Redis 取消标记，在安全边界结束，不会在未知副作用状态下自动重放。
- 失败或取消的运行才允许重试；终态运行的取消请求保持幂等，不会被重新打开。
- 迁移文件：`backend/src/migrations/1787800000000-AddAgentRuntimeControls.ts`。

### 审批与恢复

现有工作流继续使用 `pending_approval`、`revision_required`、`resume` 和 `revise` 状态流。工具层已有 `completed`、`running`、`unknown` 幂等状态：未知副作用只能进入人工确认或局部重跑，不能直接盲目重放。审批、恢复、运行和工具动作通过 Runtime Event 关联到 `threadId`、`runId`。

这部分不等于“所有业务都自动审批”。高风险动作仍要走审批；不需要审批的任务只能通过自动门禁和证据校验后继续。

通用 Agent Loop 的恢复语义是“从最后一个成功检查点继续”：检查点包含 `step`、`toolCalls`、`state` 和累计 `elapsedMs`，恢复时不会重新获得已经消耗的总超时预算。未知副作用仍不会自动重放；取消、审批和重试需要由上层业务明确决定。

生产工作流在 Redis 可用时使用稳定的 `start／resume／revise` 任务 ID 做队列去重，并对五分钟租约每分钟续期。生产环境 Redis 不可用时现在直接拒绝队列任务和进程内接管；仅开发环境允许受限的本地降级，因此不能把开发模式结果宣称为跨实例互斥或死信接管。

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

### 评测结果的解释规则

- `passed` 只表示已执行的评测样本全部通过；
- `skipped` 表示只完成结构校验、没有审核样本，或运行条件不足；
- `unavailable` 表示没有报告文件或报告无法解析；
- `golden-business-latest.json` 在 `live !== true` 时只显示“结构校验已完成”，不会把 `ok: true` 当成真实问答通过；
- `failedSamples` 只统计已执行样本中的失败数，不把“未执行”伪装成失败。

### 本轮完整优化门禁

仓库内可以直接验证的门禁已经收敛为：回答与问题目标匹配、证据不足拒答、多问题按子问题覆盖、版本／条件／否定词不被忽略、评测状态可解释、估算成本带来源标记、预算和取消边界统一、工作流队列稳定去重、长任务租约续期、Agent Loop 恢复位置与剩余时间、ACL 原子替换、文档与实现分支一致。真实业务数据、生产 QPS／SLA、跨实例故障演练、真实 IAM／ABAC／DLP、生产死信与值班、真实 GraphRAG／多模态效果和备份灾备仍必须在目标环境完成验收。

### 运行治理边界

- 生产认证存储为空时不再自动补齐 `admin／user` 已知种子账号；新建 API Token 默认只授予 `rag:chat`，其他能力必须显式申请 scope。认证用户和 Token 仍可使用 Redis 共享 JSON；正式 IAM、组织角色和租户主数据已落 PostgreSQL，认证存储切换仍需按环境逐步完成。
- 文档异步入库会先把原始文件写入对象存储，BullMQ 只携带 `objectKey`、任务和租户上下文，Worker 在处理完成或失败后清理临时对象；同步与管理端上传统一受 `DOCUMENT_UPLOAD_MAX_BYTES`（默认 200 MB）限制。对象存储不可用时不会把完整文件重新塞入 Redis。
- Domain Event Outbox 的隐式幂等键按事件内容摘要生成，显式 `idempotencyKey` 仍可用于业务操作级幂等；payload 脱敏递归处理嵌套对象和数组；按订阅维度的持久投递账本已记录每次尝试、退避和最终状态。
- 定时任务只有在 BullMQ Scheduler 注册成功后才会写入 `running`，刷新和停止也会等待持久调度操作完成；注册／注销失败会显式返回错误，不再静默吞掉。Supervisor 的总超时和取消信号已贯穿领域路由、Agent 管线及模型调用；真实供应商连接释放和跨实例故障演练仍需目标环境验证。

- 队列状态和失败任务接口只提供应用层观测与按 owner 重试；真正的跨实例死信转移、告警接收、值班和容量水位仍由 Redis／BullMQ 生产环境验收。
- 外部 URL 的 SSRF 防护覆盖常见私网地址、DNS 解析、重定向和 Playwright 最终地址；生产仍应在网络层补充 egress 白名单、代理隔离和请求审计，不能只依赖应用层校验。
- `tenantId` 已通过两条迁移覆盖资源表并回填 `legacy`，但字段暂时可空、应用层仍有旧调用方，尚不能宣称 ABAC 规则已经覆盖所有业务资源；后续需按租户逐模块收紧查询过滤。
- 产研工作流的状态、列表、交接 Manifest、Schema 预览和项目导出会复用请求租户校验；带租户请求拒绝读取未绑定租户的历史 Checkpoint。启动同一 `threadId` 时先校验已有 Checkpoint 的 owner／tenant，避免把越权访问误判为首次执行并覆盖已有工作流。这是应用层保护，不替代资源表 `tenant_id` 迁移。
- Chat 审批恢复也会把当前认证租户传入 Agentic Checkpoint；请求租户与检查点租户不一致或检查点缺少租户时拒绝恢复。该 fail-closed 规则保护新链路，但历史无租户检查点需在迁移或兼容策略确定后处理。
- LangGraph Checkpoint 在生产或严格依赖模式下对 Redis 读写采用严格错误语义，连接失败不会退回进程内 `MemorySaver`，避免单实例假成功和跨实例恢复丢失；开发环境才保留内存降级。真实 Redis 故障转移与恢复演练仍需目标环境验收。
- Artifact 生成队列和定时任务启动恢复同样在生产／严格依赖模式下拒绝 Redis 缺失时的进程内降级；Artifact 入队失败会落库为 `failed`，定时任务不会被当前实例私自接管。真实 BullMQ 故障转移、死信和重放仍需目标环境演练。
- 生产 `JwtAuthGuard` 已对用户 JWT／API Token 启用租户上下文 fail-closed：没有 `tenantId` 的用户身份不能访问业务接口；内部 Service Token 仍由独立守卫处理。该门禁避免迁移前的无租户身份继续读写共享资源，但不替代关系型租户字段迁移。
- 多索引补偿目前保留失败状态、删除重试和人工入口；Milvus 删除重试在 Redis 可用时已持久化并可跨实例恢复。管理端索引审计已能逐文档核对 PostgreSQL、Elasticsearch、BM25、Milvus 和 Neo4j 来源状态，生产 Reconciler 会把可修复缺口投递到 `rag-index-repair`；Domain Event Outbox 已有 Redis 派发租约和并发幂等保护，文档审核状态／审核记录、文档生命周期／版本生效已在同一 PostgreSQL 事务中写入 Outbox，其他业务领域、告警和真实故障演练仍未完成。
- SSE 票据依赖 Redis 的 `SET` 与一次性消费；Redis 不可用时不会退回 JWT URL 参数或不安全的进程内票据。认证用户和 API Token 仍优先使用 Redis 共享 JSON 存储，生产 Redis 不可用时认证读写直接 fail-closed；激活／重置 token 在生产同样默认要求 Redis（`REQUIRE_DISTRIBUTED_TOKEN_STORE=true`），仅开发环境允许进程内降级。组织、角色和租户主数据已具备 PostgreSQL IAM 表，但认证用户切换到 IAM 的迁移仍需按环境执行。
- SSE 票据依赖 Redis 的 `SET` 与一次性消费；Redis 低版本不支持 `GETDEL` 时使用 Lua 原子读删，避免并发重复消费。
- 工作流失败任务现在记录结构化 dead-letter 日志并支持配置保留期；生产 Redis／BullMQ 不可用时拒绝进程内降级。真正的持久化死信、告警路由、值班确认和跨实例重放仍需目标环境接入。
- 文档异步入库队列与工作流／定时队列保持相同边界：生产或 `core.requireDependencies=true` 时 Redis／BullMQ 不可用会拒绝入队并把任务标记为失败，开发环境才允许受限同步降级；Redis 队列可用时使用稳定 `taskId` 去重并由 Worker 接管。
- `tenantId` 已进入 JWT／用户记录类型和运行时匹配工具；资源表已拥有对应字段和索引，文档 ACL 在用户带 `tenantId` 时会按文档 owner 所属租户过滤共享／public／role 结果。外部索引已写入租户字段，但旧索引仍需通过对账和重建逐步补齐，不能把 ABAC 视为一次迁移后自动完成。
- API Token 的 `scopes` 现在进入请求身份并由 `JwtAuthGuard` 按接口元数据校验；Chat、AG-UI 用户流、文档、Graph、Memory、Workflow、RAG Gateway、周报、Structured、MCP、Skills、Supervisor、Agent Runtime、Agent Evals、Jobs、Obsidian、Speech、Observability 和 Token 管理接口分别声明最小 scope，SSE 一次性票据会保留 API Token 身份和 scope，普通 JWT 与内部 Service Token 继续走各自认证边界。资源表租户字段和组织角色主数据迁移已完成，仍需逐接口把旧角色判断切换到 IAM 权限码。
- Chat、Chat SSE 和 AG-UI 用户流会把认证上下文中的 `tenantId` 传入统一 RequestContext、Hybrid／BM25-only 检索和 Document ACL；当 `users` 表尚未同步租户但认证存储已有租户时，ACL 仍按认证租户过滤；数据库用户与认证租户冲突时直接拒绝。资源表已完成租户字段回填，旧入口未传租户时由数据库默认落到 `legacy`，后续按模块收紧为必填。
- 生产对象存储默认要求 MinIO 或兼容远程对象存储；`OBJECT_STORAGE_REQUIRE_REMOTE=true` 或 `NODE_ENV=production` 时，初始化、读写失败均直接报错，不会静默落到本地磁盘。
- 查询日志和 LangFuse 追踪默认执行邮箱、手机号、凭据和长编号脱敏；`QUERY_LOG_RETENTION_DAYS` 控制查询日志保留期，`LANGFUSE_REDACT_CONTENT=false` 只能在完成数据分级与第三方合规评审后使用。
- Simple／Agentic 的关键模型流式生成、结构化判断、证据压缩兜底、公共知识直答和 DeepAgent 查询规划会接收请求级 `AbortSignal`；`LlmProvider.getModel()` 返回的底层模型及其结构化 Runnable、stream／batch／transform 也会自动继承当前信号。Bocha 联网搜索与 DashScope Rerank 的出站 `fetch` 同样合并请求取消信号与 10 秒超时，Simple、Auto、Agentic 三条入口均会传递；仍有少数独立离线脚本或不经过 Chat 执行上下文的旧调用，需要在目标环境做取消演练。
- Chat／AG-UI 用户入口已增加租户／用户固定窗口限流和可选日成本预算；生产通过 Redis Lua 原子“限额内预留”实现跨实例共享，超额请求不会先增加计数再拒绝，Redis 不可用时按 `TENANT_QUOTA_REQUIRE_REDIS` fail-closed。成本目前按每请求估算额度预留，真实模型 usage 对账和租户账单仍需接入真实计费数据。

## 2026-09-22 六项生产治理改造

- **资源租户字段迁移**：迁移 `1788100000000-AddTenantIamRuntimeGovernance` 为资源表补齐 `tenantId`、租户索引，并将历史记录回填到 `legacy`；迁移 `1788200000000-DefaultLegacyTenantScope` 为旧调用方设置安全默认值。字段暂时保持可空，应用层可渐进收紧，避免历史任务在升级时丢失。
- **关系型 IAM**：新增 `iam_tenants`、`iam_memberships`、`iam_roles`、`iam_permissions`、`iam_role_permissions`、`iam_membership_roles`，内置 legacy 管理员／只读角色和 `platform.read` 权限；`IamService` 提供租户、成员、角色和权限查询，认证存储仍可独立运行，后续可按租户逐步切换正式授权。
- **跨实例运行事件序号**：`agent_runtime_event_sequences` 以 `(tenantId, threadId)` 唯一键和 PostgreSQL 原子 upsert 分配序号；`agent_runtime_events` 另加 `(tenantId, threadId, sequence)` 唯一索引，运行事件不再依赖单实例内存队列，跨实例追加事件不会产生重复序号。
- **订阅级 Outbox 账本**：`domain_event_deliveries` 以 `(eventId, subscriptionId)` 唯一键记录每个订阅的尝试次数、退避、成功和失败；某个 webhook 失败不会重复投递已经成功的其他订阅，人工 retry 会重置对应账本。
- **Supervisor 全链路取消**：Supervisor 自带可配置总超时，并把 `AbortSignal` 传入领域路由、Agent 管线和每个模型调用；取消或超时会中断后续阶段，不再把取消误报成普通低置信度结果。
- **索引 hash／版本对账**：文档元数据和切片保存 `contentHash`、`indexGeneration`；BM25 与 Elasticsearch 写入同一版本字段，RAG Admin 对账同时比较 chunk 数、内容 hash 和 generation，外部索引字段缺失会被标记为未完成对账而不是假成功。

本轮已在本地 PostgreSQL 执行四条迁移（`1788100000000-AddTenantIamRuntimeGovernance`、`1788200000000-DefaultLegacyTenantScope`、`1788300000000-UniqueRuntimeEventSequence`、`1788400000000-SeedRuntimeEventSequences`）并通过 `migration:show`；迁移只新增表／字段、回填租户、设置默认值、建立唯一索引和初始化运行事件序号，不删除既有业务数据。生产发布仍需先备份数据库，再按同样顺序执行迁移并核对资源表数量、IAM 成员数和索引对账报告。

## 2026-09-22 剩余生产大项收口

- **IAM 正式接管用户入口**：登录／刷新会为用户补齐租户成员、`reader`／`admin` 系统角色和 `platform.read` 权限；生产开启 `AUTH_ENFORCE_IAM` 时，所有带 `ApiScopes` 的用户接口除 API Token scope 外，还必须通过当前租户的 IAM 成员权限检查，服务令牌仍由独立 `ServiceTokenGuard` 处理。成员、角色和权限初始化具备并发幂等保护。
- **问答会话租户隔离**：Conversation 的创建、读取、列表、删除、消息写入、历史缓存和审批恢复均携带租户条件；同一用户跨租户时不会复用另一租户的会话缓存或向其中写入消息。
- **运行中心租户隔离**：Chat／AG-UI 创建 Agent Run 时写入租户，运行事件、客户端断流取消、审批恢复和按线程查找活动 Run 都复用同一租户条件，避免只凭 `threadId` 或 `runId` 跨租户读取或取消。
- **索引自动修复闭环**：`bm25_content_hash_mismatch`、`elasticsearch_content_hash_mismatch` 及 generation 不一致现在会进入 Index Reconciler 的持久修复队列，不再只被审计报告发现而不自动修复。
- **Outbox 故障恢复边界**：订阅级账本与 Redis 派发租约共同保证多实例单扫描；进程在 webhook 已发送但账本尚未落库时，下一轮会按稳定 `deliveryId` 继续恢复，人工 retry 只重置对应订阅投递状态。

本轮验证：Backend build 通过；Chat、JWT/IAM 门禁、索引 Reconciler 定向测试通过（共 20 项）；未新增破坏性数据库迁移。

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
