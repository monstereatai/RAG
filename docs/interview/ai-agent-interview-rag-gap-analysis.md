# AI Agent 面试与 JD 对照 RAG 项目差距清单

审计日期：2026-10-31  
对照材料：`/Users/monster/Desktop/ai-agent-interview-questions-tech-stack-jd_副本.md`  
项目定位依据：[CLAUDE.md](../../CLAUDE.md)

> 便于执行的未完成项、外部验收项和可选优化汇总见：[待补齐与优化清单](./ai-agent-rag-missing-and-optimization-checklist.md)。

## 1. 审计范围与口径

- 按全仓文件匹配和源码/文档检索检查 `apps/`、`packages/`、`infra/`、`scripts/`、`docs/` 与根目录项目说明；生成目录、依赖目录和运行时数据不作为产品能力证据。
- 对照题库中的 T00–T43 共 44 个能力模块，以及 J01–J14 共 15 个岗位描述。J01 含两个独立岗位；没有招聘 JD 的面试场次不推造招聘要求。
- 题库中 1,460 条问题/提示已由原文按 T 编号映射。本文按 T 模块逐项核对，避免复制整份题库；具体原题、追问、反问和 JD 全文仍以对照材料为准。
- 按主人确认的范围，不把 Python/FastAPI 和语言专属 API 列为本项目待实现项。语言要求只在 JD 适配结论里标记，不据此改项目技术栈。
- 本文区分“代码存在”“代码已验证”和“真实业务/目标环境已验收”。代码与模拟数据通过，不代表线上质量、隔离强度或业务收益已经证明。

### 状态说明

| 标记 | 含义 |
| --- | --- |
| ✅ 已有 | 仓库可找到对应实现；不等于真实业务验收通过 |
| △ 部分/可优化 | 主链路存在，但范围、证据、覆盖率或质量仍有边界 |
| ⏳ 外部待验 | 需要真实数据、凭据、目标服务、业务决策或生产环境 |
| — 非本项目 | 面试者个人知识、语言专属能力或当前产品不承担的行业功能 |

## 2. 结论

项目已覆盖多数通用 RAG/Agent 工程主链路：混合检索与引用、Agent 状态编排、工具契约、记忆与上下文、任务预算/取消/恢复、MCP、运行观测、评测脚手架、知识索引治理和 OpenSandbox 代码接入。把这些一概写成“项目没有”会与仓库事实不符。

当前最大的差距不是再添一套框架，而是**真实证据与边界验收不足**：没有可代表业务的留存评测集和真实答案质量结果；OpenSandbox、Mem0 自托管、Redis/Worker 故障恢复和生产容量没有在目标环境闭环；游戏官网/活动、组织主数据、GraphRAG、视觉/视频等真实业务源还未接入。

代码层仍有几项可优化：Agent 工作区命令的安全边界需由真实沙箱隔离和可验证策略保证；Mem0 周度归纳草案已实现但默认关闭，目标服务协议与真实记忆质量尚未验证；模型预算和调用耗时指标已覆盖 Vision、多模态 Embedding、Qwen Embedding 与 Skills 的共享调用路径，Qwen Embedding 的预算取消和本地超时已通过 SDK fetch 传到实际 HTTP 请求；响应提供 usage 时实际 Token 用量也会独立记入 Prometheus。预算 Token/费用仍需按真实 Provider usage 和账单校准；通用 A2A 和大规模工具按需发现没有形成已验收能力。它们是否都要做，应由目标岗位/业务场景决定，不能为覆盖 JD 名词而盲目扩展架构。

提示词追踪也覆盖了原来未进入统一清单的 Supervisor 执行路径：路由 system prompt、用户模板和结构化输出 schema 按实际内容生成哈希，五个子 Agent 提示词纳入现有注册表，阶段结果携带实际 prompt version。仍需在目标观测平台核验 trace 关联完整性，并建立对应真实回归集。

### 本轮已补代码项（本地代码，不代表目标环境验收）

- Mem0 增加默认关闭的周度用户记忆归纳草案：Redis 分布式锁与用户轮转、稳定记忆筛选、`infer=false` 原文写入、来源指纹/提示词版本、pending 审核 API、审批前来源复核、驳回/撤销与来源变更后 stale；原始记忆不删除，检索仅注入 approved 草案并在同次召回中抑制其来源，撤销后来源恢复检索。目标 Mem0 Cloud/自托管版本与真实记忆质量仍待验收。
- OpenSandbox 工作区创建参数现在包含 CPU、内存、磁盘配额和 `secureAccess: true`；出站策略仍为默认拒绝并按 allowlist 放行。定向单测验证创建参数，真实 Server/tenant/egress/隔离仍待联调；PID 限制仍需在沙箱服务端配置。
- OpenAI Vision 与多模态 Embedding 的直接 HTTP 调用通过 `LlmProvider.runWithExternalModelBudget()` 计入请求级调用次数、输入估算和 Token 预留，并继承请求取消/超时信号。标准 Qwen Embedding 的查询及每个 10 条文档批次也经该预算入口；Skills 改用带缓存的共享 `EmbeddingProvider`，不再单独创建 SDK 客户端，缓存命中不计作外部模型调用。
- `MetricsService` 为 Vision 记录请求数/耗时，为 Qwen 与多模态 Embedding 记录请求数、耗时和向量化文档数；Qwen 响应提供 `prompt_tokens` 或 `total_tokens` 时单独记录实际 Embedding 用量（`rag_embedding_tokens_actual_total`），Grafana 总览新增对应用量面板；不与估算预算混用。
- Mem0 Cloud 的 `getAll()` 已从单页读取改为按照 `next` 翻页，读取完整结果并保留 user/run 过滤与 `latestOnly`；自托管 Open Source REST 文档没有列出分页参数，目标版本仍需联调确认完整性。
- Qwen Embedding 通过 `configuration.fetch` 与请求局部 `AsyncLocalStorage` 合并预算/取消信号、SDK 自身信号和现有 3/5 秒本地超时；LangChain 并发队列执行回调时会恢复请求 signal，并把取消错误规范成 `AbortError`，避免 LangChain 将取消当普通网络故障重试。真实安装的 LangChain/OpenAI SDK 集成测试验证取消能到达底层 fetch。显式设置 `encodingFormat: 'float'`，避免 OpenAI SDK 默认 Base64 解码与 DashScope 浮点数组响应不兼容。Qwen 响应提供 `prompt_tokens` 或 `total_tokens` 时会记入实际用量指标。目标 DashScope/OpenAI 兼容端点仍需真实联调；预算 Token/费用仍需对账真实 Provider usage 与账单。接口格式依据：[DashScope OpenAI 兼容 Embedding 文档](https://help.aliyun.com/en/model-studio/embedding-interfaces-compatible-with-openai)。
- Supervisor 五个子 Agent 的 system prompt 已抽到可哈希定义并加入 Prompt Registry；Supervisor 查询结果返回实际动态路由 prompt hash 及各阶段子 Agent prompt version。定向 Supervisor Jest 2/2、提示词注册表检查和 RAG API build 通过。该改动未建立 Supervisor 独立质量回归集，也未在真实 Langfuse/线上 trace 环境验收。
- 上述代码的定向验证：6 个 Jest suites / 29 tests、RAG API build 和 `docs:consistency` 通过；Qwen/Skills/Metrics 定向 ESLint 通过。合并检查全部改动文件的 ESLint 仍有 13 项，位于 Vision 的既有不支持方法/测试断言以及 `.mjs` 的 TypeScript 项目服务配置。结果只覆盖代码契约，不代表外部模型账单、真实 Sandbox 隔离或生产负载验收。

### 主要实现证据索引

| 能力组 | 主要源码/文档 |
| --- | --- |
| 模型调用、预算、用量 | `apps/rag-api/src/providers/llm/`、`apps/rag-api/src/modules/metrics/` |
| Agent、Workflow、工具与运行状态 | `apps/rag-api/src/rag/agentic/`、`apps/rag-api/src/modules/agent-runtime/`、`apps/rag-api/src/modules/workflow/`、`apps/rag-api/src/tools/` |
| MCP、Skills、插件 | `apps/rag-api/src/modules/mcp/`、`packages/rag-mcp-server/`、`apps/rag-api/src/modules/skills/`、`apps/rag-api/src/modules/plugin-runtime/` |
| 会话、记忆与上下文 | `apps/rag-api/src/modules/chat/`、`apps/rag-api/src/modules/memory/`、[上下文工程文档](../CONTEXT_ENGINEERING.md) |
| 文档、检索、索引与图谱 | `apps/rag-api/src/modules/document/`、`apps/rag-api/src/rag/`、`apps/rag-api/src/providers/milvus/`、`apps/rag-api/src/providers/elasticsearch/`、`apps/rag-api/src/modules/graph/` |
| 评测与观测 | `apps/rag-api/scripts/eval-*.mjs`、`apps/rag-api/src/modules/agent-evals/`、`apps/rag-api/src/providers/observability/`、`apps/rag-api/src/modules/metrics/` |
| 身份、权限与治理 | `apps/rag-api/src/modules/iam/`、`apps/rag-api/src/common/guards/`、`apps/rag-api/src/tools/tool-execution-policy.service.ts`、`apps/rag-api/src/modules/platform-governance/` |
| 工作区与部署 | `apps/rag-api/src/modules/workflow/production-project-workspace*.ts`、`infra/docker/`、`infra/monitoring/`、[运行与交付文档](../OPERATIONS.md) |

## 3. 优先级最高的缺口

### P0：真实业务质量证据

- 准备脱敏且有授权的真实文档，以及至少 100 条带标准答案、标准来源/引用、可回答性和业务场景标签的问题；按 development/holdout 分开，保持题目来源可追溯。
- 现有本地索引审计恢复过 13 份文档的切片，但对应原始上传文件缺失，无法与原件核对；这批内容不能直接当作已审核金标准。
- 在真实数据上分别评估检索、生成、引用、拒答和 Agent 任务完成。至少给出 Recall@K、MRR/nDCG、引用正确率、忠实度/覆盖率、拒答准确率、任务成功率、P95 和估算成本的样本数、计算口径、基线与结果。
- 补真实 bad case 闭环：收集 → 归因 → 修改 → 留存集回归 → 线上观察。模拟样例和 Judge 分数只能验证评测流程，不能代替质量结论。
- 在有权限差异的真实授权文档上验证检索 ACL，覆盖越权不可见、授权可见、权限变更和索引更新。

### P0：工作区沙箱安全与目标环境

- 仓库已有 OpenSandbox 工作区工具和隔离适配代码；创建参数已设置 CPU、内存、磁盘限额、secure access 和受控 egress。真实 Server/SDK、tenant 实际传递、策略是否由目标 Server 执行、PID 配额、资源回收和预览隔离尚未联调。`secureAccess` 的代码开关与真实身份授权验收不是一回事。
- 源码审计记录显示，工作区命令校验本身主要检查空命令、长度和 NUL；设置 `cwd` 或在提示词中要求“只操作项目目录”不能作为文件系统隔离。上线前要在沙箱执行层验证路径边界、命令权限、网络策略和宿主资源隔离，并覆盖越界访问、命令超时、取消和并发场景。
- 真实机器压测、故障恢复、多实例、Agent Ops 登录态 E2E、Graph Ops 页面复验和 CLI 在线 smoke 均待目标环境完成。

### P1：记忆生命周期

- 已实现用户原文来源、会话/消息指针、显式到期、明确更正后的旧记忆标记和 Outbox 重试进度。
- **Mem0 周期归纳草案代码已实现但默认关闭**：每周最多处理 10 个用户、每份最多使用 30 条稳定 user scope 原始记忆；生成后需审核，审批前核验来源指纹，来源更正后使草案失效，撤销已批准草案可恢复原始来源检索；原始记忆始终保留。真实 Cloud/自托管 API 协议、业务保留规则、记忆召回/污染率尚未验收。用户层和会话层以外的组织、商户、门店、设备等记忆范围也没有作为通用能力验收。
- Mem0 外部写入与本地 Outbox 进度不是原子提交；现在以 Outbox 事件 ID/scope 写入 metadata，并在重放时读取包含历史记录的记忆列表做 best-effort 去重，列表读取失败会让 Outbox 重试。远端可见性延迟仍可能造成重复写入，不能宣称 exactly-once；自托管目标实例的 metadata 更新协议还需要实机联调。
- Mem0 Cloud 全量列表现已按 `next` 分页；本地 REST 是否存在版本相关的分页/响应上限需用目标 Open Source Server 核实。
- 如果实施归纳，应先提供只读预览/来源追踪/人工确认方案，避免摘要遗漏事实后隐藏原始记忆；不得直接删除旧记忆。

### P1：生产数据、模型与治理

- 真实游戏官网/活动资料、复盘材料和组织主数据尚未作为可验收业务数据接入；GraphRAG 真实业务图谱、视觉/视频模型也未完成目标环境联调。
- 数据分级、保留周期、脱敏、审计与内审口径需要业务方确定；生产机器、域名、证书、网络、密钥注入、备份、监控、灰度和回滚方案也待确认。生产发布属于单独审批事项。

## 4. 技术栈 T00–T43 逐项对照

| 模块 | 仓库现状与证据 | 差距或可优化项 | 状态 |
| --- | --- | --- | --- |
| T00 项目叙事与职责 | 项目定位、链路和模块在 [项目背景](../PROJECT_BACKGROUND.md)、[系统架构](../architecture/ARCHITECTURE.md)、[功能步骤流程](功能步骤流程.md) 中有说明。 | 仓库无法证明个人职责、团队分工、用户规模、业务收益或离职/职业动机。面试材料应使用本人可核验事实，不能从代码推导个人指标。 | △ |
| T01 Python 与异步服务开发 | 不纳入本次项目补齐范围。 | Python/FastAPI 和对应语言专属 API 按主人确认排除；这是个人技术准备，不作为 RAG 项目缺口。 | — |
| T02 语言、框架与平台选型 | 项目锁定 NestJS/TypeScript、LangChain.js/LangGraph.js、Milvus、PostgreSQL、Redis、ES 等，见 [CLAUDE.md](../../CLAUDE.md)。 | 可准备项目为何选这些组件、替代方案和迁移代价的说明；不因其他 JD 的语言栈要求替换当前架构。 | △ |
| T03 LLM 基础与推理原理 | 项目通过 Provider 调用模型，应用结构化输出、提示词与受控流程。 | 理论知识与仓库代码是两回事；需能解释模型限制、上下文/采样/工具调用等，并用本项目运行记录支撑经验。 | △ |
| T04 模型接入、选型、部署与微调 | 有 LLM Provider、配置、预算和多模型调用边界。 | 缺真实任务集上的模型质量/延迟/成本对比与模型路由收益；微调/自部署不是当前项目已验证能力，也不是必然要补的功能。 | △ / ⏳ |
| T05 最小 Agent 与推理范式 | 有统一问答入口、Agentic RAG、受控工作流、有限重试和完成门禁，见 [Agent Runtime](../AGENT_RUNTIME.md)。 | 可用真实任务轨迹说明何时走确定性 Workflow、何时调用模型；当前模拟轨迹不证明自主任务成功率。 | ✅ / ⏳ |
| T06 LangChain 与 LangGraph 状态编排 | LangChain/LangGraph 用于模型、检索、状态图和恢复点。 | 需要用真实运行图讲清状态、边、重试、取消和 checkpoint；无需为了面试再平行加入另一套框架。 | ✅ |
| T07 多 Agent 拆分与协作 | 产研工作流按角色和依赖运行，Agentic 检索有多个受控节点。 | 现有 DAG/多节点不能自动等同通用自治多 Agent 协商系统；若目标 JD 要求 Agent 间消息协商，应先用场景证明需求并评估协议/失败模式。 | △ |
| T08 Function Calling 与工具契约 | 有工具注册、Schema、权限、超时、结果截断和执行审计；`permission: write` 自动进入 tenant/thread/tool 范围的 Redis 原子幂等保护；Agent Loop 遇到 `unknown` 会停止后续动作；RAG 内部 reconciliation 可按唯一调用和精确 Redis 状态登记人工结论，包括终态事件缺失的 orphan unknown marker，并允许从旧调用事件推导缺省 `runId`。 | Admin API 的 `admin:qa-ops:write` 转发与 UI 入口尚未接通；外部副作用查询、迟到提交和补偿仍需真实系统证据和目标环境演练。 | △ / ⏳ |
| T09 MCP、A2A 与交互协议 | MCP Provider 按显式 permission/risk/approval/mode/timeout/tenantScope 策略暴露唯一工具 alias；Agent Loop 决策回调接收获准目录，所选 alias 经 ToolExecution 执行。tenant 工具要求可信 tenantId 上下文与 schema 字段，并由服务端覆盖模型输入；本地 smoke server 已调用成功。 | 现有业务 `decide` 回调尚未消费目录，没有通用 LLM `bindTools` dispatcher；真实业务工具策略、远端 tenant ACL、凭据范围及协议兼容仍待联调。A2A 仅按实际互操作需求评估。 | △ / ⏳ |
| T10 工具规模化、发现与按需加载 | 有 Tool Registry、插件运行和 Skills 上下文装配。 | 尚无大规模工具目录下的召回准确率、工具选择耗时与遗漏率证据；可按需补充工具目录/延迟加载评测，避免一次性把所有工具说明塞入上下文。 | △ |
| T11 Skills、经验沉淀与持续进化 | 本地受信任 Skill 可匹配并按预算注入；项目有经验文档和运行事件。 | 从反馈/成功轨迹自动更新 Skill 的闭环没有质量证明。应先做人审、版本控制和回归，再考虑自动化沉淀，不能让失败轨迹直接改写规则。 | △ |
| T12 Prompt 与结构化输出 | 有结构化输出 Schema、提示词注册表/hash 和预算限制；Registry 已扩展至 41 项，本轮将显式模型调用中的 Agentic 评估、兜底/直接回答、纠错/证据总结、周报、结构化报告、项目生成、工作区 Agent 和 Artifact Studio 提示词登记，并把版本传入实际调用 metadata。 | 仍需用真实提示词回归语料比较模型升级前后结果，并在目标追踪后端验证 metadata 持久化、脱敏和回放。 | △ |
| T13 上下文工程与压缩 | 有上下文预算、历史摘要、裁剪、工具结果上限、上下文来源和证据边界，见 [上下文工程](../CONTEXT_ENGINEERING.md)。 | 摘要/裁剪的事实保真与关键字段保留尚无真实多轮留存评测；Token 估算与个别模型窗口需用真实调用校准。 | ✅ / ⏳ |
| T14 记忆与多轮生命周期 | 有 PostgreSQL/Redis 短期会话、结构化摘要、Mem0 用户/会话记忆、来源和过期治理；Cloud 全量列表已支持分页，Outbox 重放按事件 ID best-effort 查重；默认关闭的周度归纳草案和审核接口已实现。 | 目标 Mem0 Cloud/自托管 `infer=false` 与 metadata 协议仍需联调；组织/商户/设备等层级不完整；跨 Mem0/Outbox 重放不具原子性；本地 REST 全量列表需目标版本核验；真实用户偏好召回与污染率未知。 | △ |
| T15 规划、Todo、Deep Agents 与 Middleware | 有查询规划、工作流任务 DAG、持久状态、审批、局部重跑和 Nest 中间件/守卫。 | 复杂任务计划变更、失败子任务收敛和 Todo 状态在真实业务中的成功率未评估；不需要仅为名词对齐而另建一套 Deep Agents 架构。 | ✅ / ⏳ |
| T16 Harness 与运行可靠性 | 有调用/Token 预算、超时、取消、重试边界、断流收口、失联 Run 处理和恢复规则，见 [Agent Runtime](../AGENT_RUNTIME.md)。 | Redis/BullMQ 跨进程故障注入、外部副作用幂等及真实长任务恢复需实机验证；输入/Token 部分仍采用估算。 | ✅ / ⏳ |
| T17 安全、权限与沙箱 | 有 JWT/IAM、tenant/ACL、工具策略、审计和 OpenSandbox 适配代码；沙箱创建已配置 CPU/内存/磁盘限额、secure access 和默认拒绝 egress；平台治理写入端点增加了 class-validator DTO 运行时校验。 | 工作区安全不能只依赖提示词、`cwd` 或模型自律；真实沙箱路径、命令、网络策略实际执行、tenant 隔离、PID 限制、资源回收和预览授权仍需目标环境验收。PII/数据分级规则还需业务口径。 | △ / ⏳ |
| T18 RAG 适用边界与完整链路 | 文档入库、检索规划、向量/BM25/ES、融合、Rerank、证据回答、引用检查和拒答均有实现。 | 需用真实 bad case 比较 RAG、Skill/固定流程、直接模型回答和人工处理的边界；当前真实回答质量未形成留存证据。 | ✅ / ⏳ |
| T19 异构文档解析与数据清洗 | 支持常见文档、图像/语音处理链路及索引任务；相关模块见 `apps/rag-api/src/modules/document/`、`src/providers/vision/`、`src/providers/speech/`。 | 跨页表格、合同/报价单、多文件一致性和视频内容需按目标语料验收；真实视觉/视频模型联调未完成。 | △ / ⏳ |
| T20 Chunking、父子块与元数据 | 有切分器、文档元数据抽取、来源与索引生命周期字段。 | Chunk 大小/重叠、表格/跨页结构和父子块策略须由真实评测决定；不要仅为套用面试术语就增加父子块复杂度。 | ✅ / ⏳ |
| T21 Embedding 与向量索引 | 有 Milvus/pgvector Provider、Embedding 和索引维护/修复路径。 | 真实语料上的召回、维度/模型迁移、CPU/内存、并发和容量数据缺失；Milvus 搜索仍有短时 timeout warning 并依靠熔断/BM25 降级；多实例下 BM25 文件共享仍有部署风险记录。 | △ / ⏳ |
| T22 Hybrid、BM25、RRF 与重排 | 有 Dense + BM25/ES 混合召回、RRF、Rerank、fallback 与索引对账。 | 配额/权重/topK/rerank 的最优配置需要开发集调参、holdout 验证；没有真实质量报告时不宣称指标提升。 | ✅ / ⏳ |
| T23 意图、澄清与 Query 改写 | 有 QueryPlanner、统一路由、历史上下文和复杂问题规划。 | 真实多意图、槽位缺失、渠道/场景澄清、主题切换以及错误改写率未测；如游戏业务需要渠道/场景隔离，先补真实样本和权限规则。 | △ / ⏳ |
| T24 知识更新、版本、引用与 GraphRAG | 有文档版本/生命周期、索引协调、GraphRAG Provider/接口和引用门禁。 | 真实组织主数据与业务图谱未联调；跨 PostgreSQL/向量/ES/图索引不是单事务，需依靠对账/修复验证恢复。 | ✅ / ⏳ |
| T25 评估集、标注与用例 | 有 RAG/Agent/多轮/回归脚本、dev/holdout 规则和评估报告结构。 | 缺脱敏授权的真实 >=100 条金标准问题集、来源标注和独立 holdout；现有合成 fixture 只能验证工具执行。 | △ / ⏳ |
| T26 RAG 指标与分层归因 | 有检索、答案、成本和运行层评测逻辑及质量门禁。 | 缺真实 Recall@K/MRR/nDCG、引用正确率、忠实度/拒答、P95/成本基线和分层错误样本；Judge 要与人工标注校准。 | △ / ⏳ |
| T27 Agent 评测、反馈与回归门禁 | 有 Agent 事件轨迹评测、Bad Case 回归和门禁脚本。 | 缺真实用户任务轨迹、成功/失败标准、线上反馈闭环和业务 holdout 结论；预期事件匹配不等于答案正确。 | △ / ⏳ |
| T28 可观测、Trace 与回放 | 有 Prometheus、Langfuse、运行事件、提示词版本和请求关联能力；生产工作流阶段和定时分析 trace 会带实际提示词版本；本轮把全仓检索到的显式模型调用补入 prompt metadata，Registry 41 项校验通过。 | 指标和 LangChain metadata 不等于完整 trace；目标追踪后端对新增 metadata 的持久化、关联、脱敏和回放仍待实测，真实业务质量也未验证。 | △ / ⏳ |
| T29 时延、成本、容量与路由 | 有输入/输出预算、调用次数上限、请求耗时与估算成本埋点、模型路由边界；Vision、多模态 Embedding 和 Qwen Embedding 已接入共享请求预算，Skills 复用带缓存的 `EmbeddingProvider`；Qwen Embedding 使用 `encoding_format=float` 对齐 DashScope 响应，取消/超时已通过 SDK fetch 传到网络层，队列取消会阻止 LangChain 重试，响应提供 usage 时记录实际 Token 数并在 Grafana 总览显示。 | 预算 Token/成本仍需真实 Provider usage 与账单校准；流式与异步任务输入量不完整；缺真实并发、首 Token/P95 和模型分档成本数据；取消/用量行为仍需目标兼容端点联调。 | △ |
| T30 API、通信与流式交互 | 有 REST、SSE、gRPC/异步任务和断流取消处理。 | 目标客户端断线重连/续传、网关超时、跨服务请求 ID 贯通和实际代理超时需 E2E 验收。 | ✅ / ⏳ |
| T31 Java、Spring 与设计模式 | 本项目主栈为 NestJS/TypeScript。 | 按确认范围排除 Java/Spring 等语言/框架 API；可迁移的事务、分层、依赖注入等概念属于个人准备，不是项目改造项。 | — |
| T32 数据库、事务与分布式一致性 | 有 PostgreSQL/TypeORM、Redis、实体约束、Outbox、重试和索引对账；Mem0 重放会按事件 ID/scope 查重。 | 外部 Mem0 写入和本地 outbox 进度不能原子提交，列表可见性延迟仍可能造成重复；多索引写入也不是分布式事务。需对 at-least-once、幂等和补偿策略做目标环境故障注入。 | △ |
| T33 缓存、消息队列与任务调度 | 有 Redis、BullMQ、定时任务、重试、取消和任务状态；本地两个进程通过项目真实 Redis Checkpointer 验证 checkpoint 共享；索引修复队列 smoke 验证瞬时失败重试和重复完成任务 ID 去重；Metrics 模块为 8 个队列暴露状态水位、最老等待年龄、作业事件速率和等待/执行耗时，并对采样持续失败告警。 | Redis/Worker 崩溃重启、积压、取消、锁恢复、外部副作用幂等仍需隔离目标环境故障演练；积压与等待阈值需真实业务负载校准。 | △ / ⏳ |
| T34 容器、云原生与运行环境 | 有 Dockerfile/Compose、服务编排、健康检查及 OpenSandbox 适配。 | 目标 Kubernetes/云环境、网络策略、密钥注入、资源限额、多实例和可观测尚未验收；不以本地 Compose 代替生产部署结论。 | △ / ⏳ |
| T35 灰度、双活、容灾与性能排障 | 有熔断、fallback、索引修复、失败收口和运维文档。 | 没有经目标机器验证的压测、SLO、灰度/回滚、备份恢复、多活/容灾演练；是否需要双活应由业务可用性目标决定。 | ⏳ |
| T36 支付业务建模与高风险执行 | 有通用权限、审批、审计和工具执行策略。 | 项目定位不是支付执行系统；没有支付账务/资金/退款等领域模型或真实高风险交易验收。不要将“支付知识问答”误说成支付系统。 | — / △ |
| T37 AI Coding、Spec 与工程质量 | 有项目规范、ROADMAP、评测/构建/测试/代码审查和 AI 工具工作区；文档一致性检查已修正为扫描拆分后的 workflow query/state 源码，并通过。 | 仓库无法证明简历中的代码可用率或个人效率提升；需要明确定义、统计周期、样本和人工验收。最新 RAG API 全量 ESLint 的 635 个 TypeScript 文件为 0 errors / 0 warnings；多组夹具已更新但尚未运行 Jest 验证。 | △ |
| T38 Coding Agent 产品与工程环境 | 有 OpenSandbox 项目工作区、Agent 命令、测试/开发服务和产物预览代码。 | 真实 Sandbox Server、路径/网络隔离、tenant/资源限额和目标工程 E2E 未验收；不等同已具备完整 Coding Agent 商业产品。 | △ / ⏳ |
| T39 算法、数据结构与现场编码 | 不属于 RAG 项目运行功能。 | 题目要求的数据结构、算法和现场编码要另做个人练习，不能由仓库功能替代。 | — |
| T40 前端、全栈与交互 | 有用户端、Admin Web、Agent Ops、图谱/文档/记忆管理页面；2026-10-31 Admin Web Biome/TypeScript lint、生产构建及 antd 全量 lint 已通过。 | 缺真实用户可用性、任务完成率、无障碍和用户采纳/返工指标；目标用户任务 E2E 尚未形成证据。 | △ |
| T41 客服 Agent 与人机协作 | 有通用审批/运行等待和工作流交接机制。 | 不是完整客服产品；缺真实客服知识、情绪/订单工具、转人工队列、坐席工作台和分流/解决率验证。仅目标进入客服场景时补。 | — / ⏳ |
| T42 行业场景、业务集成与产品化 | 当前定位是游戏官网与活动产研团队的 RAG/Agent 工作台，具备通用文档/工具/工作流。 | 题库覆盖的营销、汽车、跨境电商、酒店、金融、物流、医疗、网络安全等行业数据与第三方系统并未全部接入。游戏官网/活动真实资料和业务指标也待准备。 | △ / ⏳ |
| T43 学习方法、前沿跟踪与反问 | 属于候选人面试准备，不是仓库功能。 | 需按目标 JD 准备学习复盘、技术取舍和反问；不能由项目 README 或框架清单代替真实经历。 | — |

## 5. JD J01–J14 逐岗对照

J01 包含两个岗位，因此下表共 15 个岗位。以下只判断当前 RAG 仓库的可复用能力，不声称项目已经满足招聘方的年限、学历、语言或行业经验要求。

| JD | 岗位摘要 | RAG 项目覆盖 | 未覆盖/需补证据 |
| --- | --- | --- | --- |
| J01-A | Coding Agent 长期记忆/多轮协作应用 | 部分覆盖：Mem0、会话摘要、带审核的周度记忆归纳草案、工具/Workflow、Eval、前端页面均有代码。 | 真实 Mem0 服务与记忆质量/污染评估、目标 OpenSandbox 验收；候选人的产品化职责与结果需本人举证。 |
| J01-B | AI 产品后端/记忆平台 API | 部分覆盖：有记忆搜索、列表、删除 API 和管理页面。 | 真实 SDK/API 合约、使用量/配额/多租户商业化指标和目标 Mem0 联调未形成闭环；语言专属要求不在本次代码范围。 |
| J02 | 真实业务 AI 应用全栈工程 | 通用能力较多：RAG、Agent、前后端、工作流、评估和权限。 | 真实业务文档、外部系统、效果指标及用户采纳证据缺失。 |
| J03 | 营销 AI Agent 平台 | 可复用 Agent、Workflow、RAG、工具/审计底座。 | 没有营销 CRM/CDP、企微/邮件/广告/海外社媒、线索/转化/推荐业务数据；Python/FastAPI 语言要求排除。 |
| J04 | 企业自主 Agent 与持续进化 | 有任务规划、记忆、工具、有限重试、运行事件和评测脚手架。 | 真实持续优化闭环、A2A、目标多模态集成及生产任务成功率未验收。 |
| J05 | Java 企业软件后端（面试偏 Agent） | 通用后端架构、数据库、缓存、队列、安全和 Agent 能力可用于讲系统设计。 | 本项目不是 Java/Spring 实现；语言专属要求按确认范围排除，个人 Java 能力不能从此仓库推断。 |
| J06 | 汽车软件/AUTOSAR Agent | 可复用 Skills/MCP、工作流、知识入库、Agent Runtime。 | AUTOSAR 需求/配置/调试工具、汽车领域知识卡片与样本、嵌入式数据源均缺；行业训练与落地不属于当前项目。 |
| J07 | 跨境电商自主 Agent/平台底座 | 可复用 Agent、RAG、记忆、工具、运行监控/调试。 | 商品/订单/ERP/供应链/客服等真实工具与数据、多 Agent 协作业务验证缺失；语言专属要求排除。 |
| J08 | 全球时尚零售/电商 Agent | 可复用通用 Agent、知识检索、数据接入骨架。 | 零售/商品/库存/销售/推荐数据和业务协作交付结果缺失；语言专属要求排除。 |
| J09 | 酒店服务 Agent/RAG | RAG、文档处理、Planner/Executor、状态和引用可复用。 | 酒店知识库、预订/订单/客服工具、转人工和服务指标缺失；目标模型/数据未实测。 |
| J10 | Harness 工具与 ERP/DC 接入 | 工具契约、权限、超时、审计、Workspace 与 MCP 底座存在。 | ERP/DC 真实系统、网关鉴权和目标环境端到端兼容未联调；大规模工具发现未量化。 |
| J11 | Agent Tool 安全与平台治理 | 有 JWT/IAM/权限、限流/审计、插件/工具策略和沙箱接入代码。 | 工作区沙箱强隔离、Agent Identity 到真实 Tool Gateway、PII 脱敏策略和 on-call 目标环境尚未验收。 |
| J12 | 多业务智能客服与算法 | 有 RAG、模型调用、意图/Workflow、审批等通用组件。 | 客服坐席转接、业务知识挖掘、分流/解决率；机器学习理论/数据平台能力是候选人能力，不是此 RAG 仓库缺失功能。 |
| J13 | 跨境物流寻报价/文档/数据 Agent | 文档解析、RAG、表格/结构化输出、Workflow、工具和观测有复用价值。 | 真实报价/运单/合同/物流知识、ERP/CRM/网页采集和多文件核对场景未接入或验收。 |
| J14 | 网络安全 AI 产品后端 | 可复用服务端、任务、缓存、观测、权限和运行可靠性。 | 安全检测数据、规则/模型集成、告警/响应和安全业务指标未接入；算法/数据结构要求是候选人准备项。 |

题库没有提供 JD 的场次维持“无 JD”状态；不把题目里的公司、业务描述或面试官假设补成招聘条款。目标岗位确定后，应只选对应 JD 深化，不建议把 15 个岗位的行业功能都塞进当前项目。

## 6. 外部验收与依赖清单

这些项目不能靠增加模拟代码或写文档标记为完成：

- [ ] 脱敏/授权真实业务文档与真实问题集；核对来源授权、版本、权限和数据保留要求。
- [ ] 接入真实游戏官网、活动资料和复盘材料，并在业务场景中验证问题集覆盖。
- [ ] 至少 100 条真实问题、标准答案、标准引用和可回答性标注；dev/holdout 分离并经过抽样复核。
- [ ] Simple、Auto、Agentic 三种运行路径的真实问答与引用检查；记录路由、召回、回答、拒答、延迟和成本。
- [ ] 真实用户反馈/bad case 与版本回归，不以离线 fixture 或 Langfuse mock 实验代替线上答案效果。
- [ ] OpenSandbox 目标 Server/SDK、tenant、egress、目录隔离、CPU/内存/磁盘/PID、回收、取消与预览授权验收。
- [ ] Mem0 Cloud/自托管目标接口兼容、metadata 更新、超时/失败/重放和真实记忆写入/检索验收。
- [ ] 真实 Redis/BullMQ 跨 Worker 故障注入、重复投递、恢复与取消验收。
- [ ] GraphRAG 真实组织主数据/业务图谱，视觉/视频模型和相关授权资料联调。
- [ ] 有权限差异的文档 A/B 检索与越权检查。
- [ ] 目标机器检索压测、故障恢复、多实例；Agent Ops 登录态 E2E、Graph Ops 复验、CLI `ask --stream`、`graph query`、`eval run` 在线 smoke。
- [ ] 真实低代码平台同步：需先拿到平台 Schema、组件 ID、API/鉴权约定和测试环境；现有模拟同步不算平台导入验收。
- [ ] 外部索引故障演练与多索引对账恢复；本地通过不代表目标服务故障时可以可靠恢复。
- [ ] 业务方确认数据分级、保留周期、脱敏、审计和内审；运维方确认生产机器、域名、证书、网络、密钥注入、备份、监控、灰度与回滚。

本地数据修复记录还指出，部分草稿/废弃版本和不可用的本地图索引保留历史告警；未在本次差距审计中删除或改写这些数据。

以上对应项在 [ROADMAP.md](../../ROADMAP.md) 中仍为待办。涉及 `.env`/密钥、数据库 schema/迁移、CI/CD 或生产部署的执行仍需遵守项目红线，不在本次文档整理中操作。

## 7. 可优化项与建议顺序

| 优先级 | 项目 | 处理建议 | 前置条件 |
| --- | --- | --- | --- |
| P0 | 工作区命令与沙箱边界 | 先做威胁模型，再把路径、命令、网络和资源限制落实到沙箱/执行层；为越界访问、恶意输入、取消和并发增加验证。不要把提示词当权限控制。 | OpenSandbox 目标版本与隔离策略可用；不变更生产环境。 |
| P0 | 真实评测数据 | 建立授权数据集、标注规范、dev/holdout 和基线报告，再调整 chunk、召回、Rerank、Prompt 或模型。 | 真实业务方提供脱敏数据与标准答案/证据。 |
| P1 | Mem0 周期归纳 | 默认关闭的周度归纳草案、来源指纹、人工审批/驳回、陈旧来源拦截和原文保留已实现；下一步评估真实记忆质量及污染率。 | 目标 Mem0 服务、授权样本与业务保留策略。 |
| P1 | 预算计量与取消 | Qwen Embedding 已通过 SDK 自定义 fetch 传递请求取消和本地超时；仍需在目标端点验证，并用真实 Provider usage/账单核对字符 Token 估算与成本。 | 目标 Provider 用量字段、价格口径和真实请求样本及目标兼容端点。 |
| P1 | 运行可靠性实测 | 本地已有 Checkpointer 跨进程、索引修复队列重试/重复提交 smoke 和 8 队列 Prometheus 状态/延迟指标；下一步对 Redis/Worker 断连、重启、积压、取消、模型超时、外部副作用和恢复做故障注入。 | 可运行的隔离目标环境；告警阈值需负载基线。 |
| P2 | 工具发现与上下文瘦身 | 当工具数增长时再测试按任务发现、延迟加载与缓存，观察选择准确率和 Token/延迟收益。 | 真实工具目录和选择评测样本。 |
| P2 | 多 Agent/A2A | 只有业务确有跨 Agent 独立身份、协商/委托需求时再扩展；优先说明现有 Workflow 与 A2A 的边界。 | 明确的跨系统互操作场景和协议契约。 |
| P2 | 记忆范围与租户策略 | 若要服务组织/商户/门店/设备，先定义身份、继承、授权、隔离与删除规则，再扩展 scope。 | 业务权限模型确认；涉及 schema 时按红线单独审批。 |
| P2 | 质量门禁清理 | 文档一致性检查已更新到 workflow query/state 拆分并通过；后续逐文件核对全量 lint 与前端全量检查的存量失败，再修复基线，使新问题可被门禁准确识别。 | 逐文件确认既有 lint/tsc 错误，避免顺带格式化和无关重构。 |

## 8. 面试准备与项目改造的边界

- 可由仓库证明的是架构、实现路径、测试结果和已复现边界；不能代替候选人的个人贡献、年限/学历、行业经历、算法理论、薪资/到岗选择或真实业务收益。
- 不应把尚未做的真实评测、生产容量、生产上线、行业连接器或自主进化表述成已完成。
- 下一步最有信息量的顺序是：**确认目标 JD → 获取有授权的真实业务语料和评估标签 → 建立真实基线 → 再决定代码优化**。目标 JD 未确定前，不补齐所有行业专有模块。

## 9. 仓库证据入口

- [项目路线图与真实待办](../../ROADMAP.md)
- [上下文工程与记忆边界](../CONTEXT_ENGINEERING.md)
- [Agent Runtime、审批与评测限制](../AGENT_RUNTIME.md)
- [运行、安全、集成和交付边界](../OPERATIONS.md)
- [参考上下文工程文章逐篇审计](../reference/CONTEXT_ENGINEERING_GUIDE_AUDIT.md)
- 原始面试题、技术栈和 JD 全文：`/Users/monster/Desktop/ai-agent-interview-questions-tech-stack-jd_副本.md`
