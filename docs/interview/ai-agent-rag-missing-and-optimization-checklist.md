# AI Agent 面试与 JD：项目待补齐项和优化清单

审计基准：2026-10-31
依据：[全仓差距分析](./ai-agent-interview-rag-gap-analysis.md)、题库与 JD 汇总文件，以及当前仓库代码和项目文档。
项目约束：[CLAUDE.md](../../CLAUDE.md)

## 1. 阅读说明

这份清单只记录仍未完成、证据不足或需要按目标岗位决定的内容。它把“改项目”“真实环境验收”和“候选人面试准备”分开：源码存在不等于生产验收；模拟数据通过不等于真实业务质量已证明。

- 优先级：P0 是质量或安全验收前置项；P1 是可靠性和核心项目闭环；P2 是由具体岗位/规模触发的增强项。
- 范围：不要求大改项目架构；不把 Python/FastAPI、Java/Spring 等语言或语言专属 API 列为本项目改造任务。
- 行业功能：不为覆盖题库而把营销、汽车、酒店、物流、支付、客服等多个行业系统一并塞入当前项目。先确定目标 JD 与真实业务场景。
- `[ ]` 表示尚未完成或尚未取得证据，不表示代码一定不存在。
- 覆盖范围：本文已逐项列出 T00–T43 共 44 个题库模块、J01–J14 共 15 个岗位（J01 拆为两个岗位）、10 项可优化事项，以及项目级 P0/P1 缺口。清单完整度不等于实施完成度；已实现、待外部验收、岗位可选和候选人准备分别标注。

### 当前仓库质量基线（2026-10-31）

- 历史基线：RAG API 全量 ESLint 首轮为 **1,106 errors / 29 warnings**；当时仅对干净且可安全处理的文件做格式整理后为 **416 errors / 29 warnings**（73 条 Prettier、343 条其他 lint errors）。
- 最新复核：逐文件修正测试夹具类型边界、过期断言和错误契约后，2026-10-31 对 RAG API 全量 TypeScript 目标运行 ESLint，**635 个文件为 0 errors / 0 warnings**，全量 lint 通过。生产源码同为 0/0。该结果只代表静态 lint，不代表测试或真实环境验收。
- Admin Web 最新复核：修复 Search Ops 图谱节点的非语义交互与数组 index key，清理未使用代码和非空断言，并将 antd 弃用属性迁移到当前 API。`pnpm run lint`（Biome 全量 239 文件 + TypeScript）通过，`pnpm run build` 通过；`pnpm exec antd lint ./src` 扫描 199 个文件、无问题。首轮发现的 Biome 6 errors / 21 warnings / 2 infos 和 antd 46 条弃用提示均已清零。
- 私有评测夹具复核：193 条 business 回归样本明确标记为 `synthetic_fixture`；补全 31 个短来源文档的模拟上下文后，`eval:business-private` dry-run 和 `fixtures:private:check` 均通过。该数据仅证明导入/评测流程可用，不是 P0 所需的真实业务金标准或生产效果证据。
- 全量验证状态（2026-10-31）：此前 RAG API 全量 ESLint 的 635 个 TypeScript 文件为 **0 errors / 0 warnings**；本轮 Agent Run、BM25、ToolExecution、Trace、Vision 用量、Admin→RAG trace/request ID、平台治理 DTO、评测关键词校验、Reconciler、记忆归纳、Skill limit、索引清理、定时任务取消、Token 日期校验和 此前 Admin API/RAG API `pnpm run build` 均通过；Admin Web 本轮构建也通过。Window 1 最后新增的 Provider Key/fallback 校验、工具副作用 fail-closed 与 MCP 初始化清理未运行会写 `dist` 的全量 build；改动文件 ESLint、Prettier、`git diff --check`、`pnpm exec tsc --noEmit -p tsconfig.build.json`、文档一致性和 Roadmap 数量检查均通过。历史全量 Jest 为 **125 suites：109 通过、16 失败；651 tests：622 通过、29 失败**；这 16 个失败 suites 后续分别定向复跑均通过。按主人要求优先实现功能后，最终全量 Jest 进程已中止，不能据此宣称全量通过。本轮上述功能改动均未运行单测；本机 PostgreSQL 5433 的 32 个源码迁移已执行，生产及其他环境仍需部署并验收。工作区已有大量未提交修改，完整全量结果仍待后续验证。
- 本清单的“代码缺口”仅指可按现有架构增量处理的内容；真实业务语料、目标服务、权限策略和生产容量需要相应业务/运行环境提供证据。

## 2. 必须优先补齐的项目缺口

### P0：真实业务质量和权限证据

- [ ] 获取经过授权、脱敏并有来源/版本/权限记录的游戏官网、活动资料和复盘文档；核验本地恢复的 13 条文档切片与原始上传文件的一致性。原件缺失的切片不直接当作金标准。本机 PostgreSQL 5433 只读盘点（2026-10-31）：31 份文档、5,863 个切片，18 份 effective、10 份标记 official、31 份 reviewStatus=approved；仅 7 份有 docVersion，projectId/activityId 均为空。13/31 文档组的全部切片具有同一有效 SHA-256，且切片数与文档元数据一致；已在单个事务中将这 13 个提取后正文哈希回填至 documents_meta.contentHash 并复核一致，18 份无切片哈希的文档保持为空；所有 31 个切片组均无 indexGeneration。16 份文档关联 387 条 original resource 记录，本地对象 387/387 存在且无越界 objectKey，14 份文档有权限记录。回填的是提取后正文哈希，不是原始文件字节哈希，也不证明授权或来源真实性；未读取正文，真实授权、13 份恢复切片原件与金标准标签仍待人工核验。
- [ ] 建立至少 100 条真实问题样本，包含标准答案、标准引用、是否可回答、业务场景和来源；分为 development 与 holdout，并对标签抽样复核。当前有 193 条明确标记为 synthetic 的预检样本，不能替代真实集；release gate 已有真实来源声明、数量、标注和 split 校验。
- [ ] 在同一数据集上分别回放 Simple、Auto、Agentic 路径，记录路由、召回、最终答案、引用、拒答、延迟和成本。
- [ ] 给出有样本数、计算口径和基线的真实结果：Recall@K、MRR/nDCG、引用正确率、忠实度/覆盖率、拒答准确率、Agent 任务成功率、首 Token/P95、估算成本及用户采纳/返工情况。
- [ ] 建立真实 bad case 闭环：收集 → 归因 → 修改 → 留存集回归 → 线上观察；Judge 结果用人工标注校准。
- [ ] 用具有不同 ACL 的真实授权文档验证授权可见、越权不可见、权限变更和多索引更新。

### P0：OpenSandbox 目标环境安全验收

- [ ] 连接目标 OpenSandbox Server/SDK，逐项验证创建参数是否被服务端执行：tenant 身份、项目目录边界、默认拒绝 egress/allowlist、CPU、内存、磁盘、PID（服务端配置）、超时、取消、并发和资源回收。2026-10-31 环境盘点：本仓库 RAG runtime 未配置 `OPEN_SANDBOX_DOMAIN`、`OPEN_SANDBOX_IMAGE` 或 API key，Docker 中无 OpenSandbox Server；SDK 1.1.1 源码确认客户端会发送 secure access、资源限制、metadata 和 networkPolicy，但服务端执行效果未验。主人确认没有 API key，决定暂缓此功能；不生成临时 key、不使用无认证模式。具备受支持的 Server 和凭证后再继续验收。
- [ ] 验证 Agent 命令不能通过 `cwd`、路径穿越、符号链接或命令组合访问工作区外文件；不能把提示词约束当作文件系统隔离。本地 workspace export 单测已覆盖符号链接、相似前缀路径和 `..` 路径，并断言只读取工作区内的真实文件；mock 测试不代替真实 Sandbox 的命令隔离验收。本次没有目标 Server，因此未执行沙箱内命令边界验收。
- [ ] 验证预览票据授权、过期、跨用户/租户访问拒绝，以及 HTML/SVG/XML 内容隔离。本次没有运行中的 Sandbox workspace，未生成票据或访问预览代理。
- [ ] 对真实 Sandbox 做越界访问、恶意输入、超时、取消、并发和异常退出验证；保留可复核结果。本次未创建实例；当前主机卷已用约 95%（剩余约 23 GiB）、load average 约 128/76/66，不适合压力或故障注入。
- [ ] 完成目标机器容量/故障测试、多实例验收、Agent Ops 登录态 E2E、Graph Ops 页面复验和 CLI 在线 smoke。本次只读结果：RAG API `localhost:3000/api/v1/health` 为 200；Admin Web `localhost:8000`、Admin API `localhost:3001` 未监听。Admin API Compose 默认会启用数据库和迁移并启动 MySQL/Redis/RabbitMQ；Admin Web 没有 Dockerfile，现有 `/api/` 代理目标为容器内 `localhost:3001`；RAG staging Compose 会挂持久卷并读取 `.env`，因此都未启动。`rag-cli doctor` health OK，但 profile/skills/documents 为 401（无 CLI 配置/token）；当前容器为单副本，未做扩容、重启或压力测试。主机卷余约 23 GiB 且系统负载偏高，未构建额外镜像。

### P1：记忆、队列和多索引可靠性

- [x] 已实现默认关闭的每周用户记忆归纳草案：预览、来源指纹、人工批准/驳回、审批撤销（恢复原始来源检索）、陈旧来源拦截与原始记忆保留；默认每周处理上限 10 个用户、每份最多 30 条来源。
- [ ] 用目标 Mem0 Cloud/自托管版本和真实授权用户记忆验证 `infer=false`、metadata 更新、远端列表完整性、归纳质量/污染率，并由业务确认是否启用与保留规则。
- [ ] 对 Mem0 Cloud 与自托管目标版本核验 metadata 更新、超时、失败和重放协议。Cloud `getAll()` 已按 SDK 的 `next` 链接递增 `page`，逐页读取全部结果（每页 50 条）；自托管 Open Source REST 文档目前没有列出分页参数，需在目标版本验证其是否返回完整结果。契约参考：[Mem0 TypeScript SDK](https://github.com/mem0ai/mem0/blob/main/mem0-ts/src/client/mem0.ts)、[Open Source REST API](https://github.com/mem0ai/mem0/blob/main/docs/open-source/features/rest-api.mdx)。
- [ ] 在目标 Mem0 Cloud/自托管版本对 Mem0 写入成功、Outbox 进度保存前崩溃做故障注入。代码按 Outbox 事件 ID/scope 查找包含历史记录的远端列表，覆盖分类 checkpoint 丢失并 fail-closed；读取失败会让 Outbox 重试。外部写入与本地进度仍不是原子提交，远端可见性延迟仍可能导致重复，不能宣称 exactly-once。
- [ ] 在真实隔离环境演练 Redis/BullMQ 跨 Worker 断连、重启、重复投递、积压、取消和恢复；确认外部副作用不会被不安全地重复执行。本地隔离 smoke 已验证索引修复队列瞬时失败重试、完成 job 重复提交去重；另在 run-specific 队列中对 active Worker 执行 SIGKILL，replacement Worker 在 stalledCounter=1 后完成同一 job（recoveryCalls=1），并清理本次队列。Agent Run stale sweeper 的取消待办现通过 `AgentRun.cancelSignalPending` 持久化，新增迁移 `1788900000000-AddAgentRunCancellationSignalStatus.ts`；服务启动与 recovery 轮次会重试待发送信号。迁移已应用于本机 `localhost:5433/rag`，并核对 `agent_runs.cancelSignalPending` 为 `boolean NOT NULL DEFAULT false`；服务重启后的实际恢复尚未实证，生产及其他环境仍需部署迁移。BM25 快照通过同目录临时文件 + fsync + 原子 rename 保留完整文件；写入型工具须先取得 tenant/thread/tool 范围的 Redis 原子执行状态与 lease，否则 fail-closed；人工对账可登记 orphan unknown/expired running 证据。Metrics 模块采集 8 个 BullMQ 队列的 backlog、最老等待年龄、作业事件速率和等待/执行耗时，并为采样失败配置独立告警。Redis 服务恢复/断连、积压、长任务恢复、多实例共享 BM25 文件、外部副作用幂等和业务积压阈值仍需目标环境演练。
- [ ] 演练 PostgreSQL、Milvus、Elasticsearch、BM25、Neo4j 中任一索引写入失败后的告警、对账、修复和查询降级。

### P1：目标岗位所需真实数据与系统集成

- [ ] 接入并验收真实游戏官网、活动资料与复盘材料；确认数据授权、版本、有效期和业务问题覆盖。
- [ ] 如目标岗位需要 GraphRAG，接入真实组织主数据/业务关系并验证实体、关系、更新和权限；不以本地 Neo4j 接口存在代替业务图谱验收。主人尚未指定目标 JD 或提供业务 Schema，因此未新增行业系统或虚构集成验收。
- [ ] 如目标场景需要视觉/视频，联调目标模型及授权资料，评估 OCR、抽帧、跨页表格、多文件一致性和引用定位。
- [ ] 如工作流要同步低代码平台，先获得平台 Schema、组件 ID、API、鉴权和测试环境；当前模拟同步不算真实平台导入。
- [ ] 由业务方确认数据分级、脱敏、审计、保留期限和内审口径；由运维方确认机器、网络、证书、密钥注入、备份、监控、灰度和回滚方案。生产发布仍按单独红线办理。

## 3. 技术栈与面试能力 T00–T43：逐项剩余准备

以下逐项对应原题库模块。已实现的主链路只列仍缺的实证、边界或个人准备，不把面试知识项伪装成代码缺陷。

| 模块                          | 仍需补齐/优化                                                                                                                                                                                                                                                                                                                                                                                  | 类别          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| T00 项目叙事与职责            | 准备本人真实职责、决策、协作边界、可核验结果；用户规模和收益没有数据就不要报数字。                                                                                                                                                                                                                                                                                                             | 面试准备      |
| T01 Python/异步服务           | Python/FastAPI 及其专属 API 按确认范围排除，不列为项目改造项。                                                                                                                                                                                                                                                                                                                                 | 排除项        |
| T02 语言/框架/平台选型        | 能说明 NestJS、LangChain/LangGraph、Milvus、PostgreSQL、Redis、ES 的选型、替代方案和迁移代价。                                                                                                                                                                                                                                                                                                 | 面试准备      |
| T03 LLM 基础与推理            | 补足模型限制、上下文窗口、采样、工具调用等理论，并能联系本项目案例解释。                                                                                                                                                                                                                                                                                                                       | 面试准备      |
| T04 模型接入/选型/部署/微调   | 启动时只对选中的 Qwen/DeepSeek/智谱 Provider 校验对应非空 API Key；LLM Gateway 会跳过未配置 Key 的 fallback，避免调用占位 Key。模型质量、延迟和成本仍需真实任务集比较；自部署/微调仅在目标岗位确有要求时评估。                                                                                                                                                                                                                                                                                                                  | 实证/可选     |
| T05 最小 Agent 与推理范式     | 用真实运行轨迹说明何时走确定性 Workflow、何时调用 Agent；建立任务成功标准。                                                                                                                                                                                                                                                                                                                    | 实证          |
| T06 LangChain/LangGraph       | 准备状态、节点、边、重试、取消、checkpoint 的真实链路讲解。                                                                                                                                                                                                                                                                                                                                    | 面试准备      |
| T07 多 Agent 协作             | 现有工作流节点不等于自治 Agent 协商；只有真实跨 Agent 委派/协商场景才扩展，并测失败模式。                                                                                                                                                                                                                                                                                                      | 可选/实证     |
| T08 Function Calling/工具契约 | ToolExecution 按有效 `permission: write` 启用 tenant/thread/tool 范围的 Redis 原子幂等；Agent Loop 对 `unknown` 以 blocked 收口。RAG 内部 reconciliation 依据唯一事件、指纹和 Redis 状态人工登记，不会调用工具；现支持无 `tool.unknown` 终态事件的精确 orphan unknown marker，并从唯一调用事件推导旧数据缺省 `runId`。Admin API 的 `admin:qa-ops:write` 转发及 UI 尚未接；真实工具的超时、忽略取消的迟到提交、状态查询和补偿仍需目标系统证据。 | 本地代码/实证 |
| T09 MCP/A2A                   | MCP Provider 只暴露配置完整、alias 唯一且具有显式 `tenantScope` 的工具；Agent Loop 决策回调收到工具目录并可派发 MCP alias，统一经过现有 ToolExecution 策略/超时/审计。tenant 工具要求可信上下文及 schema `tenantId`，以服务端值覆盖模型输入。现有业务决策器尚未实际消费工具目录；远端 ACL、目标协议仍需联调，A2A 仅在确有互操作需求时评估。                                                                                                                           | 本地代码/实证 |
| T10 工具发现与按需加载        | 工具规模增长后测选择准确率、遗漏率、选择耗时和上下文成本。                                                                                                                                                                                                                                                                                                                                     | 可选/实证     |
| T11 Skills 与持续进化         | 本地已为 Skill 内容生成 SHA-256 版本，运行事件记录选中版本与是否注入；AgentRuntime 对 `skillLimit` 做有限值归一化，0 时不枚举 Skill 或调用 Embedding；Bad Case 审核页展示对应版本并指引人工修改 `SKILL.md`、保留案例进入 Agent Evals 回归。失败反馈不会自动改写 Skill。仍需用真实 Bad Case 完成人工审阅、Git 版本变更和回归运行，验证闭环的操作体验与质量。                                                                                                                                 | 代码已补/实证待办 |
| T12 Prompt/结构化输出         | Prompt Registry 已从 22 项扩展到 41 项；本轮覆盖检索充分性/反思、纠错和证据总结、直接与兜底回答、周报/结构化报告、项目生成与工作区 Agent、Artifact Studio 等显式模型调用，并把 prompt name/version 传入 LangChain metadata；动态领域路由和 Artifact Studio 变体另记实际 hash。生产工作流阶段和定时分析仍进入 Langfuse trace。 | 实证/优化     |
| T13 上下文工程/压缩           | 用真实多轮样本测摘要事实保真、关键字段保留和 Token 估算误差。                                                                                                                                                                                                                                                                                                                                  | 实证          |
| T14 记忆生命周期              | 默认关闭的周度 user 记忆归纳草案、来源指纹、审批/驳回/撤销、来源变更失效和检索去重已实现；stale 提案不再永久占用其余有效来源或阻止同一来源集合重建。Outbox 重放覆盖分类 checkpoint 丢失时的事件查重及列表读取失败关闭。仍缺目标服务联调、真实记忆质量/污染率评估和最终一致性故障演练。组织级 scope 仅按业务需要决定。                                                                                                                                                                                              | 实证/外部验收 |
| T15 规划/Todo/Deep Agents     | 用真实复杂任务评估计划变更、失败子任务收敛和 Todo 状态正确性。                                                                                                                                                                                                                                                                                                                                 | 实证          |
| T16 Harness/可靠性            | Reconciler 将 audit reason `missing_chunks` 纳入自动修复白名单；仍在当前页所有 repair job 成功入队后推进游标，入队失败时重扫当前页。文档入库时 Elasticsearch 两个并发 sibling 全部 settle 后再进入失败清理，保留原始错误。Agent Run stale sweeper 将待发取消信号与失败状态一并写入 `AgentRun.cancelSignalPending`，服务启动及 recovery 轮次会重试。新增迁移 `1788900000000-AddAgentRunCancellationSignalStatus.ts` 已应用于本机 `localhost:5433/rag`，字段已核对为 `boolean NOT NULL DEFAULT false`；进程重启后的实际恢复还没有实证，生产及其他环境仍需部署迁移。本地隔离 smoke 已覆盖 BullMQ active Worker 硬崩溃与 stalled job 接管；仍需演练 Redis 服务恢复/断连、迁移后的取消恢复、外部副作用幂等和长任务恢复。输入与 Token 部分仍为估算。                                                                                                                                                                                                                                                                                                          | 实证          |
| T17 安全/权限/沙箱            | 平台治理写入端点已增加运行时 DTO 校验；API Token 的 `expiresAt` 要求严格 ISO 日期字符串；RagGateway 已将已审核纠错证据检索限定到当前 user/tenant；生产 JwtAuthGuard 强制执行 IAM，显式 `AUTH_ENFORCE_IAM=false` 会 fail-fast。当前 runtime 未配置 Sandbox Server，真实隔离、路径/网络/资源限制和租户验收未完成；PII/数据分级规则也需业务确认。                                                                                                                                                                                                 | P0 验收       |
| T18 RAG 边界与链路            | 用真实 bad case 比较 RAG、固定流程、Skill、直接模型回答和人工处理的适用边界。                                                                                                                                                                                                                                                                                                                  | 实证          |
| T19 文档解析/清洗             | 对目标语料测试跨页表格、合同/报价单、多文件一致性和视频；真实视觉/视频模型未联调。                                                                                                                                                                                                                                                                                                             | 实证          |
| T20 Chunking/父子块/元数据    | 用真实评测确定 chunk 大小、重叠、表格结构与父子块策略，不为术语堆复杂度。                                                                                                                                                                                                                                                                                                                      | 实证          |
| T21 Embedding/向量索引        | BM25 JSON 快照现在先写入同目录唯一临时文件、fsync 后原子 rename，单进程崩溃不会截断最后一份完整快照；仍需测真实召回、模型/维度迁移、容量和并发，并跟踪 Milvus timeout 与多实例共享 BM25 文件的并发覆盖风险。                                                                                                                                                                                                                      | 本地代码/实证 |
| T22 Hybrid/BM25/RRF/Rerank    | 用 development 调参、holdout 验证权重/topK/Rerank；没有真实基线前不宣称提升。                                                                                                                                                                                                                                                                                                                  | 实证          |
| T23 意图/澄清/Query 改写      | 测真实多意图、槽位缺失、渠道/场景澄清、主题切换和错误改写率。                                                                                                                                                                                                                                                                                                                                  | 实证          |
| T24 知识更新/引用/GraphRAG    | RAG Graph 查询已按 ACL 允许的文档来源过滤，返回后继续检查 ACL、生命周期和业务范围；仍需接入真实业务图谱，并演练 PostgreSQL、向量、ES、图索引的部分失败和恢复。                                                                                                                                                                                                                                                                                                                          | 实证          |
| T25 评估集/标注               | release gate 已校验真实来源声明、至少 100 条、expected claims、引用和 development/holdout；关键词校验拒绝空值、非字符串、首尾空白及大小写重复，避免空字符串命中和重复计分。目前只有 193 条 synthetic fixture，import dry-run 已通过但不能作为真实基线。仍需提供授权、脱敏且人工复核的真实集。                                                                                     | P0 数据       |
| T26 RAG 指标/归因             | 输出真实 Recall@K、MRR/nDCG、引用、忠实度、拒答、P95、成本基线和分层错误样本；校准 Judge。                                                                                                                                                                                                                                                                                                     | P0 数据       |
| T27 Agent 评测/反馈           | 建立真实任务成功标准、用户反馈和线上 bad case 回归闭环。                                                                                                                                                                                                                                                                                                                                       | P0 数据       |
| T28 可观测/Trace/回放         | Supervisor 动态路由、生产工作流阶段、定时分析和显式模型调用带 prompt metadata；GraphRAG 查询、Obsidian 笔记/工作流生成、文档元信息抽取新增只记录版本、耗时、状态及输入/输出摘要的 Langfuse trace，不发送问题或正文。RAG TracingInterceptor 通过 AsyncLocalStorage 将 HTTP trace 传到同步订阅创建的异步执行中，Agent 节点 span 共享 traceId 并以 HTTP span 为 parent；Admin QA SSE→RagClient 请求现转发 `traceparent`。合成 trace 已在本机 Langfuse 4.72.0 回读确认 metadata 和 generation observation 后删除。Prompt Registry 41 项校验通过；仍需验证实际 Cloud trace 关联、生产脱敏与回放，并建立真实提示词回归集。 | 本地代码及服务契约已验证/目标环境待验 |
| T29 时延/成本/容量/路由       | Qwen Embedding 已将请求预算/取消和本地超时信号传至 SDK 底层 fetch；DashScope 多模态 Embedding 响应提供 usage 时也记录实际 Token 指标；真实 LangChain/OpenAI SDK 集成测试覆盖队列上下文传递，取消会终止底层请求并阻止 LangChain 重试；显式请求 `encoding_format=float` 以匹配 DashScope 浮点向量响应；Embedding 和 OpenAI-compatible Vision 响应提供 usage 时记录实际 Token 指标，Grafana 总览可查看。仍需用目标兼容端点验证，并用 Provider usage/账单校准预算估算；补首 Token/P95、并发和成本对比。 | 外部实证      |
| T30 API/通信/流式交互         | Admin API 已在客户端断开时 abort 上游请求，信号经 RagClient 传至 RAG SSE，并由 Chat/LLM/工具执行链路处理；Admin QA SSE→RAG 同时转发 `traceparent` 和 `x-request-id`，RAG 校验 UUID 后交给 ChatService，AG-UI 事件使用同一 request ID。Structured Report SSE 也通过 Observable teardown 将取消信号传入模型流。当前 QA SSE 不支持同一 run 的精确 Last-Event-ID 续传；增加事件重放前需定义持久事件格式、run 身份、游标和重复事件语义。仍需目标环境验证网关超时、跨服务 trace 关联和断线行为。                                                                                                                                 | 本地链路/目标环境待验 |
| T31 Java/Spring               | Java/Spring 和框架专属 API 按确认范围排除；可迁移的架构概念做个人准备。                                                                                                                                                                                                                                                                                                                        | 排除/面试准备 |
| T32 数据库/事务/一致性        | Mem0 Outbox 重放通过事件 ID、scope、来源会话查重，分类 checkpoint 丢失时可跳过重复写入，读取失败则交由 Outbox 重试；远端写入与数据库进度仍非原子。Reconciler 在分页任务全部入队后才推进游标。写入型工具执行要求 Redis tenant/thread/tool 范围原子锁和 lease，未取得时 fail-closed；unknown 可人工对账。仍需对 Mem0 与多索引 at-least-once、幂等、冲突和补偿策略做目标环境故障注入。                                                                                                                                                      | 实证/优化     |
| T33 缓存/队列/调度            | 本地 Redis smoke 通过两个独立进程调用真实 `RedisCheckpointer` 验证 checkpoint/metadata/列表与清理；新增 BullMQ 索引修复队列 smoke，在隔离 DB 15 验证瞬时失败重试、重复完成 job 去重，以及 SIGKILL active Worker 后由 replacement Worker 恢复 stalled job 并完成（stalledCounter=1、recoveryCalls=1）。Metrics 模块已为 8 个 BullMQ 队列导出状态水位、最老等待年龄、作业事件速率、等待/执行直方图和监控状态，并对持续采样失败配置告警；停止/删除 `at` 类型任务会移除尚未启动的一次性 delayed job，active job 保持运行。隔离 Redis 上 8/8 状态采样成功。仍需目标环境验证 Worker/Redis 重启、积压、取消、锁恢复、外部副作用幂等，并按真实负载校准延迟/吞吐阈值。 | 本地代码与 smoke 已验证/外部实证待办 |
| T34 容器/云原生/环境          | 目标云/Kubernetes（若目标环境采用）、网络策略、密钥、资源限制和多实例未验收。本次只读盘点未发现本仓库 Admin/RAG 多副本部署；目标主机卷余量约 23 GiB 且负载较高，未做压力/故障注入。                                                                                                                                                                                                                                                                                                                  | 外部验收      |
| T35 灰度/容灾/排障            | 建立目标环境 SLO、压测、备份恢复、灰度/回滚和容灾演练；双活仅按业务可用性要求决定。                                                                                                                                                                                                                                                                                                            | 外部验收/可选 |
| T36 支付建模/高风险执行       | 当前不是支付系统，不补支付账务能力；若 JD 涉及，准备领域知识但勿声称项目已实现。                                                                                                                                                                                                                                                                                                               | 排除/面试准备 |
| T37 AI Coding/工程质量        | 不以仓库证明个人效率；定义可用率/效率指标的样本口径。历史全量 Jest 为 125 suites 中 109 通过、16 失败（651 tests 中 622 通过、29 失败）；16 个失败 suites 后续分别定向复跑均通过，但按主人要求中止的最终全量运行未完成，不能宣称全量通过。本轮 AgentRun、BM25、ToolExecution、Trace、Vision/Embedding usage、request ID、RagGateway user/tenant 证据过滤、平台治理 DTO、评测校验、Reconciler、记忆归纳、Skill limit、Provider Key/fallback 校验、工具未知副作用收口、MCP 初始化清理、索引清理和 Admin Ops 工作区 artifact 绑定提示改动均未运行单测；继续建立可用率/效率的真实样本口径。                                                                                                    | 面试准备/优化 |
| T38 Coding Agent              | Admin Ops 在工作区状态未知时会禁用版本选择、启动和 Agent 执行；状态正常时锁定已绑定 artifact 并提示导出后销毁。任务委派会校验 run 与父/依赖任务的会话归属并限制依赖数量；当前 Admin Web/API 未运行、Sandbox Server 未配置，真实工程环境和目标工程 E2E 尚未验收。                                                                                                                                                                        | P0 验收       |
| T39 算法/数据结构/现场编码    | 独立准备题目与现场表达，不属于 RAG 仓库功能。                                                                                                                                                                                                                                                                                                                                                  | 面试准备      |
| T40 前端/全栈/交互            | Admin Web lint、TypeScript、构建和 antd 专项检查已通过；仍需用真实用户任务评估完成率、无障碍、采纳和返工。                                                                                                                                                                                                                                                                                       | 实证          |
| T41 客服 Agent/人机协作       | 当前不是客服产品；只有目标场景需要时才接知识、订单工具、坐席转接并衡量分流/解决率。                                                                                                                                                                                                                                                                                                            | 可选/目标岗位 |
| T42 行业集成/产品化           | 优先接当前游戏/活动真实业务；题库其他行业系统按目标 JD 选择，不全量实现。                                                                                                                                                                                                                                                                                                                      | P1/目标岗位   |
| T43 学习/前沿/反问            | 准备本人真实学习复盘、技术取舍和针对目标岗位的反问。                                                                                                                                                                                                                                                                                                                                           | 面试准备      |

## 4. JD J01–J14：按岗位列出项目剩余差距

J01 包含两个独立岗位，因此这里列出 15 个岗位。岗位年限、学历、语言和个人经历需要候选人单独证明，仓库不能代替。

| JD    | 岗位                           | 项目尚缺/需举证                                                                                                  |
| ----- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| J01-A | Coding Agent 长期记忆/多轮协作 | 周度归纳与可撤销审批代码已实现但目标 Mem0/真实记忆质量仍待验证；OpenSandbox 目标环境验收；个人产品化贡献和结果。 |
| J01-B | AI 产品后端/记忆平台 API       | 真实 SDK/API 合约、目标 Mem0 联调、配额/使用量/多租户产品指标；个人语言要求独立证明。                            |
| J02   | 真实业务 AI 应用全栈           | 真实业务资料、外部系统、效果指标和用户采纳证据。                                                                 |
| J03   | 营销 AI Agent 平台             | CRM/CDP、企微/邮件/广告/海外社媒及线索/转化数据连接；Python/FastAPI 不改当前项目。                               |
| J04   | 企业自主 Agent/持续进化        | 真实持续优化闭环、多模态目标集成和生产任务成功率；A2A 按实际互操作需要决定。                                     |
| J05   | Java 企业后端（面试偏 Agent）  | 仓库不是 Java/Spring 项目；个人 Java 能力需单独举证，不为 JD 改本项目架构。                                      |
| J06   | 汽车软件/AUTOSAR Agent         | AUTOSAR 需求/配置/调试工具、汽车领域语料和嵌入式数据源；只有选择该岗位才接入。                                   |
| J07   | 跨境电商 Agent/平台底座        | 商品、订单、ERP、供应链、客服真实工具/数据与多 Agent 业务验证。                                                  |
| J08   | 全球时尚零售/电商 Agent        | 零售商品、库存、销售、推荐数据和真实业务协作结果。                                                               |
| J09   | 酒店服务 Agent/RAG             | 酒店知识库、预订/订单/客服工具、转人工流程和服务指标。                                                           |
| J10   | Harness 工具与 ERP/DC 接入     | ERP/DC 真实系统、网关鉴权、端到端兼容；大规模工具发现量化。                                                      |
| J11   | Agent Tool 安全/平台治理       | Sandbox 强隔离、Agent Identity 到真实 Tool Gateway、PII 脱敏和 on-call 环境验证。                                |
| J12   | 多业务智能客服/算法            | 客服坐席转接、知识挖掘、分流/解决率；ML/数据平台理论是个人准备项。                                               |
| J13   | 跨境物流/报价/文档 Agent       | 报价、运单、合同/物流语料，以及 ERP/CRM/网页采集和多文件核对场景。                                               |
| J14   | 网络安全 AI 产品后端           | 安全检测数据、规则/模型集成、告警/响应链路和安全业务指标；算法题单独准备。                                       |

没有招聘 JD 的面试场次不推造岗位要求。确定目标岗位后，只把对应行转为项目计划。

## 5. 可优化项清单

| 优先级 | 优化项           | 建议做法                                                                                                                                                                                                                       | 触发/前置条件                                                            |
| ------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| P0     | 沙箱边界         | 将目录、命令、网络和资源限制落实到执行层；用越界/取消/并发场景验证。                                                                                                                                                           | 目标 Sandbox Server/SDK 可用。                                           |
| P0     | 真实评测基线     | 先建授权数据、标注规范、dev/holdout 和基线，再调整检索、Prompt 或模型。                                                                                                                                                        | 业务方提供真实资料和答案证据。                                           |
| P1     | Mem0 周期归纳    | 默认关闭的周度草案、来源指纹、审批/驳回及原始记忆保留已落地；下一步只在目标 Cloud/自托管版本验证协议与质量后再由业务决定启用。                                                                                                 | 真实 Mem0 服务、授权记忆样本、保留策略确认。                             |
| P1     | Mem0 分页完整性  | Cloud 已逐页读取全部结果，并增加跨页测试；仍需用目标 Cloud SDK 和自托管版本确认分页/完整返回契约。                                                                                                                             | 目标 API 环境可用。                                                      |
| P1     | 预算、用量和取消 | Qwen Embedding 已通过 SDK fetch 传递请求取消与本地超时、显式请求 DashScope 所需的 float 编码，并记录响应提供的实际 Token 用量；OpenAI-compatible Vision 现在也记录响应返回的 prompt/completion Token。仍需在目标兼容端点核验，并对账 Provider usage/账单与字符估算预算。                                  | 真实 Provider 样本及目标端点可用。                                       |
| P1     | 运行可靠性       | Mem0 Outbox 已按事件 ID 做 best-effort 重放查重，stale 记忆提案不会永久挡住有效来源重归纳；Reconciler 使用精确修复原因白名单；已处理 `missing_chunks`，并在当前页所有 repair job 成功入队后推进游标，纳入可修复的检索描述错误、排除服务不可用和元数据计数错误。文档入库等待 Elasticsearch 并发写结束后才清理索引。stale Agent Run 取消待办已数据库持久化，本机 `localhost:5433/rag` 已应用并核对迁移。BM25 快照已改为 fsync + 原子 rename；GraphRAG 查询按允许的文档来源过滤共享图事实；`/debug/chunks` 需 JWT 并传当前用户 ID，避免匿名全局检索。写入型工具未取得 Redis 幂等锁时始终阻断。服务重启后的取消恢复尚无实证，生产及其他环境仍需部署迁移。本地 Redis Checkpointer 与 BullMQ smoke 覆盖跨进程状态、瞬时重试、重复 job 和 Worker SIGKILL 接管；8 个 BullMQ 队列有水位、等待年龄、事件速率及延迟指标。仍需在隔离目标环境演练 Redis 服务恢复/断连、重启、队列积压、长任务锁恢复、外部副作用幂等和 Mem0 远端可见性延迟。 | 隔离测试服务可运行。 |
| P2     | 工具发现         | 工具规模增长后再测试按任务召回、延迟加载、缓存及上下文收益。                                                                                                                                                                   | 有真实工具目录和选择评测集。                                             |
| P2     | 多 Agent/A2A     | 先说明现有 Workflow 边界；仅在跨 Agent 身份、委托/协商确有需求时扩展。                                                                                                                                                         | 明确互操作场景和协议契约。                                               |
| P2     | 记忆层级         | 如需组织/商户/门店/设备 scope，先定身份继承、授权、隔离和删除语义。                                                                                                                                                            | 业务权限模型确认；schema 变更须单独走项目红线。                          |
| P2     | 质量门禁         | RAG API 全量 ESLint 的 635 个 TypeScript 文件为 0 errors / 0 warnings；历史全量 Jest 中 16 个失败 suites 后续分别定向复跑均通过，但最终全量运行按主人要求中止，不能宣称全量通过。本轮 AgentRun、BM25、ToolExecution、Trace、Vision 用量和 Admin→RAG traceparent 改动不跑单测；当前构建状态见 ROADMAP。Admin Web lint、TypeScript、build 与 antd lint 结果沿用前次验证。 | 按项目验证约定复核，不关闭规则、不批量格式化无关文件。 |

## 6. 推荐执行顺序

需要并行执行时，按以下四份任务单划分代码范围，避免多个窗口同时改同一模块：

- [窗口 1：Agent、模型与工具](./ai-agent-rag-window-1-agent-model-tools.md)
- [窗口 2：记忆、知识入库与 RAG](./ai-agent-rag-window-2-memory-retrieval-data.md)
- [窗口 3：评测、可观测与运行可靠性](./ai-agent-rag-window-3-evaluation-reliability.md)
- [窗口 4：Sandbox、安全、产品化与 JD](./ai-agent-rag-window-4-sandbox-product-jd.md)

1. **先选目标 JD**：明确当前需要准备的岗位与题库模块，不同时建设多个行业产品。
2. **先拿授权数据**：真实业务语料、权限边界、答案/引用标签和保留规则不齐时，不调整检索参数追指标。
3. **先做安全与可靠性验收**：Sandbox、Mem0、Redis/Worker 和多索引恢复按隔离目标环境逐项复核。
4. **建立真实基线再优化**：固定数据集版本和指标口径，比较优化前后结果并保留 bad case。
5. **补个人面试证据**：项目职责、技术取舍、失败案例、个人贡献和可验证结果由候选人本人准备。

## 7. 来源与边界

### 窗口 3 本地实现与验收（2026-10-31）

- **T25–T26 评测门禁**：报告含逐模式统计时，以逐模式样本数为准；零样本不再回退到顶层 `ok/total` 并误报通过。
- **T29 预算与用量**：核对确认共享 `LlmProvider` 已把 `image_url` 图片载荷替换为预算占位符，避免将 Base64 当成超长文本；实际请求仍发送原图，本轮未重复实现这段逻辑。
- **T30 流式链路**：Admin QA SSE 按客户端背压读取上游，断连时停止读取并尝试取消上游；Structured SSE 向客户端返回稳定错误码/文案，并把断连取消传到模型流。
- **T32–T33 运行可靠性**：stale Agent Run 取消待办每轮最多扫描 100 条；定时 Agent 与分析任务把超时取消传给下游，移除可能重复执行工具副作用的 Agent 整链路自动重试；一次性任务成功或失败后都会禁用，避免重启后重放。
- **本地验证**：全仓 `pnpm run build` 退出码 0。8 个 Agent 任务离线样例、10 个工作流模拟样例、多模态素材就绪 smoke 通过；DB15 隔离 Redis 上 BullMQ 重试/去重/Worker 崩溃恢复和 Checkpointer 跨进程 smoke 通过。100KB 图片经真实 `OpenAiVisionProvider`、共享预算和本机 fake HTTP 服务完成调用，确认 Base64 原图发出且用量指标记录正确。Admin 目标 ESLint、评测脚本 Node 语法检查与相关 `git diff --check` 通过；RAG ESLint 因共享环境长时间无输出而中止。单测未运行。
- **验收限制**：第一次 BullMQ smoke 的 writer 子进程没有输出，原因未确认；补充子进程状态/错误信息后重跑通过。Admin API、QA Ops Web、Docker Compose 与 Admin MySQL 当前不可用，未做真实 QA/Structured SSE 用户链路验证。
- **仍待外部验收**：真实授权金标准与人工 Judge 校准、线上 bad case/账单核对、Cloud Trace、慢客户端/断线、Provider 是否及时停止生成计费，以及 Redis/BullMQ 多实例和目标环境重启恢复演练。

- 完整题库/技术栈/JD 模块对照：[AI Agent 面试与 JD 对照 RAG 项目差距清单](./ai-agent-interview-rag-gap-analysis.md)。
- 当前项目进度：[ROADMAP.md](../../ROADMAP.md)。
- 运行/安全边界：[OPERATIONS.md](../OPERATIONS.md)。
- Agent 评测与运行状态：[AGENT_RUNTIME.md](../AGENT_RUNTIME.md)。
- 本文所列外部目标环境、真实数据、生产容量和岗位专属系统均未据此视为已验收。
