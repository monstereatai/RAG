# 项目进度路线图

> 项目真实进度源。保留当前状态、待办、阻塞和最近 20 条进展；更早的过程细节由 Git 历史追溯。

## 读取规则

- 已完成只记录已实现且验证过的事项。
- 当前状态、待办和阻塞不计入“最近 20 条进展”。
- 外部依赖或目标环境尚未验证时，标为待办或阻塞，不作生产就绪结论。

## 当前状态

- **代码文件职责拆分**：按现有 feature/page/package 边界拆分 RAG、Agentic、Document、工作流、Provider、Admin API/Web 与评测脚本，保留 Nest Injectable 门面、构造注入和原页面/脚本入口契约。扫描 1,222 个手写 TS/JS 源码与脚本，没有文件超过 1,000 行。RAG 后端、Admin API、Admin Web build 通过；fixture dry-check 和 Admin Web 改动文件 Biome 检查通过。重点 Jest 197 项中 195 项通过，memory 与 chat 各有一条既有断言和当前实现不符；Agentic 23 项、RAG Admin 35 项、RagClient 34 项及 Document 8 项通过。Admin API 全量 verify 在 2 个未改动套件的 9 条测试失败后停止；RAG 全量 ESLint 为 1,038 errors / 29 warnings。Admin Web 全量 lint/tsc 受仓库其他问题阻断，tsc 的 4 个错误都在未改动 `src/app.tsx`。本次重启后本地 QA Ops 8000 与 RAG API 3000 均可用；管理端会话列表接口可用；旧管理员历史会话已迁移至当前映射身份，并验证 221 条列表及详情读取成功；未发送真实模型问题。

- **RAG 架构重构**：本地代码拆分与能力边界调整已完成。6 个 workspace 构建通过；RAG/Agentic/Chat/Document/Gateway 定向测试 5 suites / 95 tests 通过，检索专项 5 suites / 21 tests 通过，smoke 40/40 通过。全量 Jest 仍有 7 个与重构前相同的既有失败套件。
- **本地真实数据与索引修复（2026-10-30）**：31 份文档中 18 份为生效且已审核版本；13 份缺少 PostgreSQL 切片的文档，各从已持久化 BM25 快照恢复 1 条切片后，18 份有效文档的 PostgreSQL、BM25、Elasticsearch、Milvus、图片索引和检索描述审计全部通过。Milvus 过滤器改为兼容本地 v2.4.4 的转义表达式；索引修复复用正文一致的现有向量，Elasticsearch 分批写入以避免大文档请求超限。13 份恢复切片没有原始文件可供比对，来源是本地 BM25 快照，无法证明与最初上传原件逐字一致。草稿/废弃版本与不可用的本地图索引仍有历史告警，均未删除或降级。
- **验收边界**：本地 18 份有效文档的多索引对账已完成；真实环境 Simple/Auto/Agentic 全链路回放、外部索引故障演练、真实业务质量与生产压测尚未完成；不得以本地模拟数据代替生产验收。
- **仓库结构**：应用位于 `apps/`，CLI/MCP 位于 `packages/`，基础设施位于 `infra/`；迁移所需工作区构建、readiness 和 Compose 配置检查已通过。
- **Langfuse 本地迁移**：已并入统一 Docker 项目 `docker`，Langfuse 健康接口返回 200；当前源项目 639 个 trace、6144 条 observation 已导入，目标共 6783 行（每个 trace 增加一个合成根 span）；逐条核对源 observation ID、trace ID 和父级关系均一致，导入失败 0。迁移时源项目的评分配置、Prompts、Scores、Datasets 均无数据；191 个模型为 Langfuse 托管模型。Cloud 项目现有 19 条合成观测回归数据，并已运行 Dataset Experiment。用户/权限、仪表盘、组织/项目设置和历史 dataset runs 不在 API 迁移范围内。RAG 应用后续 trace 仍发往 Cloud。
- **产研工作流历史保留与恢复状态**：工作流 Redis checkpoint 和历史索引已取消 30 天自动过期，RAG API build 通过；运行中服务尚未重启加载改动。旧 `docker_postgres_data` 卷仍在，包含 3 条相关 workflow run、18 个 task、8 个 artifact；活动库也有相同 thread 的 run 记录及另一批 task/artifact。旧 Redis 快照中的 checkpoint 正文已过期，当前尚未执行数据库/Redis 数据迁移，等待主人批准恢复范围。
- **知识入库链路补漏**：同步与异步上传的音频、图片、视频都走对应的 ASR/OCR/视觉/抽帧逻辑；媒体解析不再把二进制占位文字当正文。Neo4j 改由 BullMQ 持久任务重试与恢复，长文分批抽取覆盖全文；删除前等待图索引退出，已配置但不可用的图存储会阻止继续删除。RAG 后端构建及音频、图片、长文抽取 smoke 通过；本地 RAG Redis、Neo4j 队列联调待运行服务后验证。
- **上下文、评测、索引及任务恢复改造**：问答生成、QueryPlanner、纠错回答、Agentic 充分性/反思/direct-answer、Mem0 分类、会话摘要压缩/恢复现有完整输入预算预检；通用 Agent 工具结果上限 2,000 字符，超长结果尝试生成 Artifact，单工具超时及权限在执行时生效。核心提示词按内容 hash 登记；AgentEval 移除关键词伪分数，未启用 Judge 或缺少黄金标准时不判通过；离线发布评测要求 dev/holdout 分组。ES/BM25 主写入失败会向上反馈，并补充索引持久化与生命周期对账。Agentic 运行与审批恢复轮询取消标记并传 AbortSignal；审批消息绑定 Run/Checkpoint，恢复失败会收口；旧 Thread 重跑入口 fail closed，新入口校验并恢复原始执行参数。RAG 后端、管理端构建、提示词注册表检查和 `git diff --check` 通过；未跑单测。完整逐文件对照见 `docs/CONTEXT_ENGINEERING.md` 与 `docs/AGENT_RUNTIME.md`。HTTP 请求和主要 BullMQ 文档、图谱、定时分析、索引修复、产物与工作流任务现已共享累计 LLM 预算；输入按字符估算且异步输入流内容量不精确，视觉／Embedding SDK 不在该计数器内。仍缺真实业务留存集和真实问答回放。
- **Agent OpenSandbox 项目工作区（代码层）**：RAG 服务、受控 Agent 工具、Admin API 与管理端操作已接入；支持工作区隔离/重连、依赖安装和测试命令、开发服务器、短时授权预览与 ZIP Artifact 导出。RAG 构建和 3 suites / 19 tests 通过；Admin API 构建、lint（2 条既有 warning）、本次相关 4 suites / 50 tests、e2e 19 / 19 与 migration check 通过。管理端改动文件 Biome 检查通过。全量 Admin API Jest 仍有 2 个未改动套件失败；Admin Web 全量 Biome/tsc 有既有错误。未连接真实 OpenSandbox；Server/SDK 兼容、真实 tenant 传递和磁盘/PID 配额仍待目标环境验收。
- **Context Engineering 缺项实施**：压缩摘要文字有界，旧 JSON 字段兼容；多轮评测可要求真实自动压缩事件并核对压缩后追问，但当前无真实业务结论。Mem0 保存 user 记忆的来源会话/消息 ID/记录时间；仅对用户明确绝对到期日过滤过期 user 记忆，云端 latestOnly 生效，本地冲突裁决仍未实现。`LlmProvider` 在最终输入预算拦截外，又增加 HTTP 请求和主要 BullMQ 任务的累计调用次数、输入估算与总 Token 预留限制。产研工作流审批任务绑定原检查点，重试不会把旧批准应用到后续批次；驳回收尾失败可按同一决定补齐；Run 状态事件缺失会按完整载荷查找并补发。稀疏压缩消息 ID 达 128 个时强制压缩最旧连续前缀并推进水位线，近期 PostgreSQL 校验按页读取，不再靠累积 ID 扩大单次查询。后端构建通过，无数据库 schema 变更、未跑单元测试。
- **参考指南逐篇核对**：固定上游提交 `ec349a470e2992adc1d98899a46cb085839c0676` 下 `docs/` 的 43 篇 Markdown 已逐篇对照，其中 3 篇无正文。新增 OpenSandbox workspace Agent 后，Bash、项目内搜索、文件写入和权限文章改为部分适用，并明确提示词/cwd 不等于沙箱隔离、审批事件不等于人工确认。Langfuse 合成实验只测观测契约，不代表问答质量。真实业务评测数据与 Redis/Worker 跨进程故障演练仍待准备和实机验证；Mem0 来源指针不等于事实级溯源。逐篇判断见 `docs/reference/CONTEXT_ENGINEERING_GUIDE_AUDIT.md`。

## 当前待办

### 未来功能规划

- [x] 产研工作流本地多形态产物：Schema 和生成代码的自然语言修改/差异/版本恢复，Vue/React 页面与数字大屏 ZIP 生成、隔离编译预览、JSON/ZIP 下载、多选产物和明确标记的模拟同步。
- [x] Agent 项目开发工作区代码：OpenSandbox 生命周期适配、Agent 命令工具、授权预览、Admin 操作和版本 ZIP 导出已实现并完成 mock 定向验证；ai-infrastructure 与 preview-runner 逐文件参考映射见 `plan/future-features.md`。
- [ ] 真实 OpenSandbox 目标环境验收：确认 Server/SDK 兼容、tenant 身份、受控 egress、磁盘/PID 配额、资源回收和授权预览隔离；当前未连接真实 Server。
- [ ] 真实低代码平台同步：等待平台 Schema、组件 ID、API/鉴权和测试环境；计划见 `plan/future-features.md`。模拟同步不代表平台导入验收。

### 真实业务质量

- [ ] 用脱敏真实业务文档替换模拟 fixture，并重新入库验证。
- [ ] 准备至少 100 条真实问题、标准答案、来源和期望引用，评测召回、排序、忠实度、引用与拒答。
- [ ] 接入真实游戏官网、活动资料和复盘材料，验证游戏营销问题集。
- [ ] 补齐 Recall@K、MRR、nDCG、引用正确率、拒答准确率、任务成功率、P95、成本、用户采纳率和返工率等真实业务结果及证据。
- [ ] 在有真实授权文档的环境完成管理端 A/B 检索权限验收。

### 真实系统与生产验收

- [ ] 联调真实组织主数据、GraphRAG 业务数据以及视觉/视频模型。
- [ ] 在目标机器完成检索服务压测、故障恢复和多实例验收。
- [ ] 完成 Agent Ops 登录态 E2E、Graph Ops 页面截图复验，以及 CLI `ask --stream`、`graph query`、`eval run` 在线 smoke。
- [ ] 确认生产机器、域名、证书、网络、密钥注入、备份、监控、灰度和回滚，再进行生产验收。
- [ ] 确认数据分级、保留周期、脱敏、审计和内审口径。

## 阻塞与红线

- 截至 2026-10-30，本地统一 Docker Compose 项目 `docker` 运行 13 个容器，Langfuse 健康接口返回 200；QA Ops 页面 `localhost:8000` 返回 200。RAG PostgreSQL 使用本机 5433 端口，避免与其他项目占用的 5432 冲突。RAG 三模式回放、外部索引故障演练、多索引对账和生产环境验收仍待完成。
- 数据库 schema/迁移、`.env`/密钥、CI/CD 和生产发布按根目录 `CLAUDE.md` 的审批边界执行。
- 未完成目标环境验证前，不标记生产就绪。

## 文档索引

| 文档 | 说明 |
|------|------|
| `CLAUDE.md` | 项目规则、红线、验证命令 |
| `docs/README.md` | 分层文档入口 |
| `docs/PROJECT_BACKGROUND.md` | 产品定位与边界 |
| `docs/CONTEXT_ENGINEERING.md` | 上下文来源、证据构建和记忆治理 |
| `docs/AGENT_RUNTIME.md` | Agent 运行、评测和任务治理 |
| `docs/architecture/ARCHITECTURE.md` | 服务、模块、数据与核心链路 |
| `docs/OPERATIONS.md` | 运行、安全、集成和交付 |
| `docs/cli-docs/README.md` | RAG CLI 与主项目的职责边界及包内文档入口 |
| `plan/README.md` | 未来功能计划目录约定 |
| `plan/future-features.md` | Schema、Vue/React、数字大屏、预览、Agent 开发工作区、下载和低代码同步计划 |
| `docs/interview/功能步骤流程.md` | 统一问答链路、意图路由、知识入库和工作流步骤 |
| `docs/reference/playway-component-inventory.md` | Playway 项目组件清单 |

## 最近 20 条进展
1. **2026-10-30｜本地真实数据与索引修复**：对 31 份本地文档按生命周期审计；13 份有效文档缺少 PostgreSQL 切片、但本地持久化 BM25 快照各保留 1 条文本，按该真实快照恢复 13 条切片，未重建或删除原始问答日志、解绑资源和历史版本。修复 Milvus v2.4.4 不支持过滤模板造成的查询/删除错判；修复任务复用 Milvus 中正文和 ID 一致的向量，只为缺失或内容不符的切片重算；ES chunk 索引按每批 100 条写入并延长大请求超时。18 个有效文档修复任务全部完成；最终审计中 18/18 的 PostgreSQL、BM25、ES、Milvus、图片索引与检索描述状态通过，BM25 快照已持久化。两条历史非 fixture 查询的只读检索返回 2 条并判 `ok`、4 条并判 `insufficient_context`，均使用 Milvus；这不是完整 Chat/答案生成评测。RAG API build 通过、未跑单测。13 条切片的原上传文件缺失，BM25 文本无法与原件核验；草稿/废弃版本及本地图索引告警保留待处理。
2. **2026-10-30｜Agent 岗位通用可靠性与安全边界补齐**：会话压缩在稀疏已压缩 ID 达 128 个时强制归并最旧连续前缀，近期 PostgreSQL 校验改为分页读取；`LlmProvider` 为 HTTP 请求和主要 BullMQ 文档/图谱、工作流、定时分析、索引修复、产物及记忆任务统一限制调用次数、估算输入与输出预留，预算耗尽的队列任务不重试；Agent Run 扫描超过默认 30 分钟无更新的 `running` 记录，以条件更新标记失败，不重放结果未知的工具副作用；自动批准限定在内部 Artifact 和隔离工作区，并以独立审计事件记录；完整项目产物生成调用补齐前端岗位身份，避免被岗位权限策略误拦。RAG API 与 Admin Web 构建、`git diff --check` 通过；未跑单测。预算使用字符估算而非精确计费，流式输入量不精确；真实业务留存评测、OpenSandbox 目标环境和灰度发布仍待外部准备。
2. **2026-10-30｜产研工作流历史保留与数据恢复核对**：发现 Redis checkpoint 与历史索引均设 30 天 TTL；改为长期保留，RAG API build 通过。旧 Postgres 卷保留了 3 条工作流相关记录、18 个任务和 8 个产物；活动库当前有另一批同 thread 数据。旧 Redis checkpoint 正文已过期，尚未写入任何数据库；恢复迁移待主人批准。
3. **2026-10-30｜本地 Docker 服务合并**：RAG 与 Langfuse 合并到 `docker` Compose 项目，13 个容器运行，Langfuse 健康接口返回 200；RAG PostgreSQL 改用本机 5433。删除重复的基础 Compose 文件、两套旧项目的停止容器和闲置网络；5 个当前 Langfuse 数据卷及旧导入备份卷均保留。
4. **2026-10-30｜本地 AI 问答历史会话恢复**：在确认 RAG 用户 ID `1` 与当前后台管理员对应后，将 `legacy` 租户下 221 条旧会话的 `userId` 更新为当前命名空间映射身份；736 条关联消息内容未改。RAG 健康检查返回 200，管理端列表返回 221 条，详情接口可读取消息；未发起真实模型调用。
5. **2026-10-30｜本地 AI 问答租户配置修复**：在本地 RAG API 配置 `RAG_ADMIN_TENANT_ID=legacy`；通过运行时 PostgreSQL 5433 端口映射启动服务，数据库同步保持关闭。RAG 健康检查返回 200，管理端会话列表接口 `available=true`；当前账号会话 0 条、QA 反馈记录 0 条，未发送真实模型问题。
6. **2026-10-30｜项目代码目录与超长文件拆分**：在原架构和 Nest Provider/Injectable 入口边界内，按职责拆分 RAG、Agentic、Document、Chat/Memory/Obsidian、工作流、ES/Milvus、Admin API/Web 页面与评测脚本。1,222 个手写 TS/JS 源码与脚本均低于 1,000 行；RAG 后端、Admin API、Admin Web 构建通过；fixture dry-check 和改动页面 Biome 检查通过。重点 Jest 197 项中 195 项通过，memory 与 chat 各有一条原有断言不符合当前实现；Admin API 全量 verify 有 9 项失败，集中在两个未改动控制器套件。全量 RAG ESLint 有 1,038 errors / 29 warnings；Admin Web tsc 的 4 个错误位于未改动 `src/app.tsx`。QA Ops/RAG API 本地服务未运行，真实问答 smoke 待环境可用后执行。
7. **2026-10-30｜OpenSandbox Agent 项目工作区代码接入**：完成 RAG Sandbox 适配与限额、Agent 受控命令 Loop、Admin API/预览票据代理和管理端工作区操作；并发创建与 Dev Server 启停加 Redis 锁，预览超时和断开取消贯通两级代理，HTML/SVG/XML 强制 CSP sandbox。RAG 构建及 3 suites / 19 tests、Admin API build / lint / 4 suites / 50 tests / e2e 19 tests / migration check、管理端目标文件 Biome、工具注册表、文档一致性和 Diff 检查通过。Admin API 全量 Jest 有 2 个未改动套件失败；Admin Web 全量 lint/tsc 由既有问题阻断。OpenSandbox 真实 Server 未连接，tenant 身份、磁盘/PID 限制和 Nginx 语法待目标环境验收；文件级参考映射见 plan/future-features.md。
8. **2026-10-30｜Context Engineering 可适用缺项补齐与复核**：摘要结构化保存目标/约束/下一步并限制文字大小；Mem0 保存 user 记忆来源会话/消息和记录时间，显式日期过期与 Cloud latestOnly 按云端/自托管能力区分；多轮评测新增服务端持久历史、压缩事件核验及压缩后追问指标；聊天模型边界增加最终输入预算拦截；产研岗位/产物编辑增加业务输入预算。追加逐篇核对后，更新 #26–28、#31、#34 的 OpenSandbox 适用边界；审批重试绑定原批次，防止旧批准落到新批次；驳回进入 revision_required 后可按原决定补齐收尾，Run 状态事件缺失可查找后补发。当时发现稀疏压缩 ID 不能直接截断；本轮已改为达到 128 个后归并最旧连续前缀，并分页核验 PostgreSQL 历史。RAG 后端构建通过；未跑单元测试。真实评测集与 Redis/Worker 故障演练仍待准备。
9. **2026-10-30｜Langfuse Dataset Experiment 接入**：新增可重复运行的 Langfuse 实验入口；自动同步远端 dataset、以本地 mock ingestion 回放 19 个托管场景，用 item-level `observability_contract` 与 run-level `observability_contract_pass_rate` 评分。构建通过，Experiment `contract-20261030T030008807Z` 在 Experiments API 回读到 19/19 条目及两类分数，全部通过。全量 ESLint 未通过：src/test 共 1,141 errors、29 warnings；新 `.mjs` 不属于当前 TypeScript 项目配置，已用 Node 语法检查和 Prettier 验证。该回归验证 Provider 观测契约，不代表云端 ingestion 传输或真实 RAG 答案质量。
10. **2026-10-30｜Context Engineering 指南缺口实现**：补上本地受信任 Skill 正文的预算注入、从 Run 事件评估期望轨迹，以及历史移除策略三层选择；中间移除 ID 写入摘要 JSON，PostgreSQL 原始消息不删、不改数据库 schema。RAG 后端构建、文档一致性与 Diff 检查通过；不跑单测。8 条合成事件轨迹通过；故意篡改拒答事件后评测器正确失败，合成数据只验证评测器执行，不代表业务质量。真实任务轨迹、压缩质量收益仍需真实留存数据，Redis/Worker 跨进程取消尚未实机联调。逐篇证据见 `docs/reference/CONTEXT_ENGINEERING_GUIDE_AUDIT.md`。
11. **2026-10-30｜上下文、评测、索引与任务恢复逐文件对照**：补齐指定模型调用的完整输入预算预检、工具结果上限和提示词 hash 追踪；AgentEval 不再用关键词重合冒充忠实度/覆盖率，离线质量门禁要求开发/留存集；ES/BM25 主写失败上报并加入索引对账。Agentic 运行与审批恢复能接收运行中取消；审批绑定 Run/Checkpoint，恢复异常收口；Thread 重跑入口改为 fail closed，运行中心按快照参数创建新运行。RAG 后端、管理端构建、提示词注册表和 Diff 检查通过；未跑单测。QA Ops 服务未启动，真实问答回放待运行正确环境后完成。逐文件对照和限制见 `docs/CONTEXT_ENGINEERING.md`、`docs/AGENT_RUNTIME.md`。
12. **2026-10-30｜上下文压缩、工具超时与输出边界**：Simple/Agentic 共用完整 prompt Token 预算；历史利用率超过 90% 时压缩旧消息，保留最新原文并将总量压到约 70%；网页搜索摘要和片段每条最多进入约 2,000 字符，完整 URL 仍保留为来源。Tool Registry 的每工具超时作用于真实执行；完整结构仅供明确标记的程序步骤使用。模型首 token 前失败可切备用；已输出部分答案后不再从头重试，避免把两份答案拼接。此记录当时将指南的压缩策略选择三层列为未实现；随后已按“模型/供应商基线 → Hybrid 特征选择 → 低置信度比较两种结果”补齐，当前状态见本节第 1 条及逐篇审计。指南示例的 0.6/0.4 是打分权重；三类记忆不是三层压缩。RAG 后端构建通过，未跑单测和真实问答回放。
13. **2026-10-30｜知识入库边界补齐**：同步和异步音视频入口统一解析，图片/音频未识别会明确失败；Neo4j 图索引改用 BullMQ 持久重试/恢复，长文完整分批抽取，删除等待图任务并在已配置的 Neo4j 不可用时失败关闭。RAG 后端构建、70 秒合成音频 ASR mock、图片 OCR/描述 mock、25,002 字图抽取 smoke 通过；Redis/Neo4j 未运行，未做真实队列联调。
14. **2026-10-30｜Langfuse 历史数据本地迁移**：本地独立栈启动；迁移 639 traces / 6144 observations，失败 0。逐 ID、trace ID 和父级关系核验通过；修复导入器映射后重新迁移，旧的不完整实例停止并保留数据卷。RAG 新 trace 仍写 Cloud；仪表盘、用户权限、组织/项目设置和历史 dataset runs 未迁移。
15. **2026-10-30｜产研工作流多形态产物**：实现 Schema 和生成代码的自然语言差异编辑与版本、Vue/React/大屏多选生成、ZIP/JSON 下载、隔离预览和模拟低代码同步；本次代码编辑相关 RAG 定向测试 12 项、RAG/admin-api 构建及管理端改动文件 Biome 通过。逐文件对照本地 ai-infrastructure 后，确认 Agent 经常需要项目级依赖安装、测试和开发服务，将 OpenSandbox 项目工作区列为后续核心计划，保留 preview-runner 做固定模板预览。RAG 控制器全文件 ESLint 仍报已有其他方法的类型/格式问题；全量 admin-web tsc 仍被 `src/app.tsx` 隐式 any 阻断，admin-api 全量 Jest 有 2 个未改动模块测试失败。真实平台契约待确认。
16. **2026-10-30｜全仓 Markdown 去重**：合并重复门禁说明，移除重复快照和已完成的过期计划；评测语料、语言版本及子项目规则保留。剩余 345 个 Markdown，精确重复 0 组；59 篇活动文档的链接检查和 `git diff --check` 通过。
17. **2026-10-30｜CLI 文档归位**：CLI 主项目文档收敛为职责说明与入口，产品、架构、使用和实现进度由 `packages/rag-cli/` 维护。
18. **2026-10-30｜项目文档分层**：项目背景、上下文工程、Agent Runtime、架构、运行交付作为主入口，流程和组件清单保留为专题文档。
19. **2026-10-30｜课程目录清理**：按要求删除根目录 `course/` 与 `course-agent/`，代码不依赖这两个目录。
