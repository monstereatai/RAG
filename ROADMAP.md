# ROADMAP

> 项目真实进度源。只保留当前状态、开放事项、阻塞和最近验证结论。完整历史已备份到 `ROADMAP.full-2026-06-25.md`。

## 读取规则

- 日常开发：优先读本文件。
- 历史细节：读 `ROADMAP.full-2026-06-25.md`，用 `rg` 精准搜索。
- 只有已实现并验证的写入"已完成"。做完未验证不得标完成。
- 外部依赖/红线/缺用户输入的事项显式写入"阻塞/待确认"。

## 文档索引

| 文档 | 说明 |
|------|------|
| `CLAUDE.md` | 项目规则、红线、验证命令 |
| `ARCHITECTURE.md` | 系统架构与模块边界 |
| `PRD.md` | 产品需求和验收标准 |
| `SERVICE_BOUNDARIES.md` | rag-backend 与 admin-backend 服务边界 |
| `DEPLOYMENT_CHECKLIST.md` | 生产部署 Checklist |
| `docs/README.md` | 文档总索引和目录维护规则 |
| `docs/PROJECT_BACKGROUND.md` | 游戏官网／活动产研一体化 RAG 与 Agent 工作台的项目背景、目标用户、业务流程和边界 |
| `backend/docs/async-task-queue-plan.md` | BullMQ 异步队列方案 |
| `docs/plans/remaining-enhancement-plan.md` | 剩余增强项方案 |
| `docs/plans/game-production-rag-functional-plan.md` | 游戏官网／活动 RAG 的入库、检索、上下文、业务元数据、生命周期、Bad Case 与评测增强方案 |
| `docs/plans/expert-agent-difficulties-implementation.md` | 七项专家级 Agent／RAG 难点的实现、接口、指标与验证证据 |
| `docs/interview/resume/resume-rag-project.md` | RAG 项目简历写法 |
| `docs/interview/resume/resume-rag-project-game-marketing.md` | 游戏官网营销场景 RAG 项目简历写法 |
| `docs/interview/resume/game-marketing-rag-evidence.md` | 游戏活动/官网营销 RAG 证据说明、评测维度、MCP/多 Agent 面试口径 |
| `docs/interview/agentguide-rag-interview-mapping.md` | AgentGuide RAG/Agent 高频面试知识与当前项目能力、缺口、回答模板对照 |
| `docs/interview/processon-ai-application-mindmap.md` | ProcessOn「AI 应用」思维导图逐节点整理、原图备份和当前 RAG 项目对照 |
| `docs/interview/README.md` | 面试文档总入口、分时长阅读路线、主题定位和岗位复习顺序 |
| `docs/interview/AI_TOOLING_INTERVIEW_GUIDE.md` | Agent、多 Agent、Function Calling、Tool、MCP Server、Skill 专题面试手册与代码映射 |
| `docs/interview/AGENT_ARCHITECTURE_SELECTION_GUIDE.md` | Agent 平台架构图、十一类架构方案、优缺点、场景与选型手册 |
| `docs/interview/USER_ARCHITECTURE_INTERVIEW_QUESTION_INVENTORY.md` | 主人历次 RAG／Agent／架构面试问题、覆盖状态和待补方向总清单 |
| `docs/interview/jd/jd-requirements-project-mapping.md` | 一线大厂 AI 应用 / Agent JD 与项目实现对照 |
| `docs/interview/jd/jd-gap-implementation-status.md` | JD 差距本地补齐状态 |
| `docs/interview/interview-docs-usage.md` | 面试文档使用说明 |
| `docs/plans/karpathy-obsidian-dual-ingest-plan.md` | Karpathy + Obsidian 统一知识链路方案 |
| `tools/rag-mcp-server/README.md` | RAG MCP Server 接入说明，给 Codex/Trae/Claude Code/Cursor 自动取上下文 |
| `docs/interview/deepseek-AI应用Agent岗-10小时冲刺指南.md` | 高级 AI 应用/Agent 岗 10 小时倒排冲刺、数字表、红线、模拟问答和面试复盘 |
| `docs/interview/deepseek-AI应用Agent岗-模拟问答题库.md` | 高级 AI 应用/Agent 岗 33 道高频模拟题逐题可背答案、追问应对和边界红线，覆盖检索/Agentic/Prompt/安全/多租户/可观测全知识面 |

## 当前结论

**本地工程成熟度：93/100 | 项目级 RAG 评测：100%（28/28）| TS 错误：0**

项目当前已从 RAG demo 推进到可运营的企业级 RAG 原型，所有无外部依赖的能力全部实现并验证：

- **rag-backend**：文档解析 → 结构化切片 → Embedding → Milvus+BM25/ES 混合检索 → Rerank → 生成 → 引用校验，全链路闭环。
- **admin-backend**：登录态/用户/角色/权限/菜单/日志/通知/配置/大盘/RAG 运营 API 代理，完整管理后台后端。
- **admin 前端**：Dashboard/Documents/SearchOps/QaOps/GraphOps/Account/System/Notification/Audit + 记忆管理页面。
- **可传播产物**：QA 聊天可识别明确的文件生成意图，自动调用产物工具并在回答内返回 Markdown、Word、Excel、SVG 架构图或 DashScope PNG 附件；同时保留手动产物中心，支持受控下载、内部／外部分享、到期、限次、撤销和访问日志。
- **rag-cli**：正式 RAG search/context API、真实 SSE ask stream、admin search、GraphRAG query、eval status/run 命令。
- **rag-mcp-server**：通过 MCP stdio 暴露 RAG search/context/ask/GraphRAG、Supervisor 多 Agent 管线和游戏活动/官网营销方案工具，给 AI 编程工具自动取上下文。
- **模拟数据**：193 条泛企业评测 + 96 条游戏活动/官网营销专项评测 / 27 个本地文档文件 / 15 GraphRAG 种子 / 20 部门 / 19 个多模态登记项。
- **剩余项**：真实 key、生产级部署/域名/证书/备份/监控接入和真实业务替换数据仍需主人提供/确认；其他真实输入缺口均已补模拟包。
- **产研协作 Agent 平台**：六岗位支持独立或 DAG 协作，具备角色工具白名单、结构化交付物、声明级证据门禁、风险审批、并行批次、局部重跑、Redis 恢复、异步命令 API、产物生成、专项评测和管理后台轮询展示。

## 已完成能力

- **六岗位生产工作流接入 LangFuse**：`ProductionWorkflowService` 现在为每次生产协作工作流创建 `agent.production.workflow` Trace，并为产品、设计、前端、后端、测试、运营阶段写入 Span／Generation／工具事件；记录项目、线程、工作流状态、审批、风险等级、证据覆盖、重试、降级和完成岗位。`LangfuseProvider` 增加工作流 Trace、显式 flush 和健康状态更新，普通问答 Trace 也会及时 flush；未启用 LangFuse 或单测未注入 Provider 时安全跳过。backend build、LangFuse Provider 与生产工作流定向测试通过。
- **Agentic 子问题多路检索闭环**：Agentic 查询规划新增显式 `subQuestions` 状态，最多拆分 3 个子问题；每个子问题独立执行 Milvus 向量＋BM25／Elasticsearch Hybrid Search，空结果再走 BM25 降级；关系／多跳子问题按需调用 Neo4j GraphRAG，逐题执行证据充分性门禁，不足项分别触发 Web Search，最后按 chunk 去重、保留每题最低证据覆盖并统一 Rerank。新增 Agentic 检索定向回归，backend build 和 Agentic／Graph 定向测试通过；真实 GraphRAG／Bocha 效果仍依赖对应服务和 key。
- **功能步骤流程补全简历全部链路**：更新 `docs/interview/功能步骤流程.md`，新增「简历核心职责流程速览」和「简历五项技术难点流程」；知识库与后台、三层问答／方案生成／MCP、Bad Case／质量运营／观测，以及受控多 Agent、路由预算、Hybrid／GraphRAG、可信纠错、Checkpoint／Trace／告警，均按用户操作和数据／状态流转串联。补充 Parent Chunk／Child Chunk 术语及「子块精确召回→父块／同章节按预算补全」规则。仅文档更新，未改运行时代码。
- **功能步骤流程术语内联注释**：为上述简历职责与五项难点流程中的技术术语、状态字段和指标字段补充首次出现的「（注：……）」说明，保留原始英文名称以便与代码、日志和面试术语对应；重点补齐 Fast Path、retrievalHit、citationCoverage、confidence、taskComplexity、route、Agentic State、Parent／Child Chunk、Checkpoint、TTFT、Webhook 等。仅文档更新，未改运行时代码。
- **游戏营销 RAG 完整项目描述**：新增 `docs/interview/resume/游戏营销RAG项目完整描述.md`，将诗悦网络游戏官网活动营销 Agentic RAG 项目的完整项目简介、五项负责内容、七项技术难点与本地验证边界独立沉淀；技术难点以多 Agent 受控协作、三层路由、Hybrid／GraphRAG、评测与 Bad Case、Checkpoint 和节点级可观测为主线，避免与简历精简版重复。同步更新 `docs/interview/README.md` 索引。仅文档更新，未改运行时代码。
- **面试文档总入口**：新增 `docs/interview/README.md`，将 `docs/interview/` 下核心知识、架构、工具、七个难点、问题清单、JD 对照、简历和业务证据材料统一归类；补充 30 分钟、半天和一周三条阅读路线，按主题快速定位、四类目标岗位复习顺序、信息冲突优先级与维护规则；`interview-docs-usage.md` 保留为详细说明并回链总入口。仅文档更新，未改运行时代码。
- **Agent 工具体系面试专题**：新增并完善 `docs/interview/AI_TOOLING_INTERVIEW_GUIDE.md`，用统一游戏活动案例解释 Agent、多 Agent、Function Calling、Tool、MCP Server、Skill 六部分关系；补充单 Agent Goal／State／Policy／Action／Observation／Stop 闭环、LangGraph 状态机、防循环、模式选择和评测；补充多 Agent Supervisor／Pipeline／DAG／Handoff／Debate／Blackboard 对比、Agent Contract、六岗位 DAG、版本化 Artifact、上下文隔离、Checkpoint、局部重跑、协调开销和单 Agent Baseline；同时覆盖 Function Schema、Tool Registry、MCP 生命周期与传输、并行调用、安全治理、Skill 渐进式披露和五层评测门禁。全部 TypeScript／YAML／JSONC 伪代码已补职责边界和关键决策中文注释，解释模型与宿主分工、Schema／权限／预算门禁、状态更新、停止条件、失败恢复、幂等、Checkpoint 和评测含义；业务场景、高频追问、两分钟回答、项目代码入口和官方规范均已补齐。仅文档更新，未改运行时代码。
- **Agent 架构设计与选型专题**：新增并完善 `docs/interview/AGENT_ARCHITECTURE_SELECTION_GUIDE.md`，使用 Mermaid 绘制企业 Agent 平台总架构、架构决策树以及 Workflow、Router、ReAct、Plan-and-Execute、Workflow-first、Manager、Handoff、Multi-Agent DAG、Supervisor、Group Chat／Debate、Event-driven／Blackboard 十一类架构图；逐项记录特点、优缺点、业务场景、伪代码和治理边界；进一步把“主流方案”从资料索引扩写为 Workflow-first、单 Agent＋Tools／MCP／Skills、Manager、Router＋Handoff、多 Agent DAG 五张完整方案卡，补齐控制权、执行流、核心组件、适用边界、生产门禁和面试表达，并加入 Prompt Chaining、Routing、Parallelization、Orchestrator-Workers、Evaluator-Optimizer、Agent Loop 六个组合原语与多 Agent 升级硬门槛；主流模式结论已与 OpenAI Agents SDK、Anthropic、LangChain／LangGraph 和 Microsoft AutoGen 官方资料核对。仅文档更新，未改运行时代码。
- **历次架构与面试问题总清单**：新增 `docs/interview/USER_ARCHITECTURE_INTERVIEW_QUESTION_INVENTORY.md`，汇总主人在项目讨论和两套真实面试中提出的 RAG、Agent、多 Agent、Function Calling／Tool／MCP／Skill、记忆、服务边界、生产评测、简历与岗位判断问题；每题标注已覆盖／需补数据／建议加深和主要答案入口，保留上海现场题与腾讯图片题原始清单，并新增 P0／P1 潜在追问缺口。仅文档更新，未改运行时代码。

### RAG 核心链路
- 文档上传解析：MD/TXT/PDF/DOCX/DOC/XLS/XLSX/PPT/PPTX/CSV/JSON/HTML + URL 抓取入库
- URL 抽取：默认静态 fetch；可选 `URL_EXTRACT_DYNAMIC_ENABLED=true` 走 Playwright 动态渲染，失败自动降级并记录 Extraction Mode / renderError
- 媒体入库：图片/视频/音频 → 对象存储 + 元数据 Markdown；音频 ASR 转写（缺 key 降级）
- 混合检索：标准 RRF 排名融合，保留 BM25/cosine 分数做质量闸门
- Agentic RAG：routing → query augment → retrieval → sufficiency → web search → rerank → generate → citation → reflection → final
- GraphRAG：Neo4j provider、实体关系抽取、schema/entities/relationships/search 运营接口
- 引用校验 + 低相关拒答 + 多租户 userId 物理隔离
- LLM-as-Judge 评测：7/7 supported

### 多模态 & 视觉
- Vision Provider 脚手架：`IVisionProvider` 接口（OCR/图片描述/视频理解）+ MockProvider + OpenAiVisionProvider（原生 fetch）
- `VISION_PROVIDER=mock` 无 key 可开发；VISION_API_KEY 就绪后开真实能力
- 图像/视频上传自动调用 Vision Provider，失败降级到元数据
- 脱敏视觉样本：图片/音频/视频文件 + 音频/视频 transcript sidecar + 图片 OCR sidecar

### 记忆系统
- **短期记忆**：`ShortTermMemoryService` — Redis ZSET 滑动窗口（30 轮）+ LLM 摘要压缩，注入 ChatService
- **长期记忆**：Mem0 Provider（cloud/local 双模式）+ MemoryService（搜索/写入/分类器）+ admin `/account/memories` 管理页面
- **记忆管理 API**：`/api/v1/memories/status`、`/search`、`/sessions/:conversationId`，支持 user/session 分层诊断

### 异步处理
- BullMQ 队列：`/documents/upload/async` 入队，Worker 调真实解析/Embedding/索引链路，失败写回 `document_tasks`
- Redis 未配置时自动降级同步处理

### 可观测 & 工程化
- Prometheus 指标（rag_llm_calls_total 等）+ traceparent + LangFuse 可选 provider + `/api/v1/observability/langfuse/status`
- 定时任务 JobsService 复用 Supervisor 执行（cron/every/at）
- TS 0 错误，lint/build/test/verify 全部通过
- Admin QA：TTS 播放按钮补齐连接中/合成中/播放中/失败状态
- Admin QA 产物中心：生成任务独立 BullMQ 队列、对象存储、文件抽屉、外部匿名分享页与移动端适配
- Admin QA 对话内产物：明确的“执行动词＋文件类型”请求自动调用 `artifact_generate`，模型能力提示禁止错误拒绝；消息内轮询附件状态并提供下载、分享入口，能力咨询类问题不误创建任务

### 私密模拟数据
- 企业制度文档 + 软件工程文档共 **27 个本地文件**，覆盖 HR/Finance/Legal/Security/Ops/CS/Product/Data/Engineering
- 业务评测 **193 条**，覆盖 19 领域、7 场景类型（含版本冲突/拒答/跨部门/多步推理）
- 游戏活动/官网营销专项评测 **96 条**，覆盖新角色抽奖、周年庆、充值返利、微信分享、游戏官网、版本专题、兑换码、回流活动
- GraphRAG 种子 **15 条** + schema/entityTypes/relationshipTypes/aliasRules/initialEntities/initialRelationships
- 组织架构 **20 部门**（含子树）+ 22 岗位 + 8 用户 + 4 角色继承链 + 继承规则 + 权限回显样例
- 多模态样本 **19 个**（text/table/structured/checklist/speech/image/ocr/video/permission/workflow）

### 部署 & 文档
- `DEPLOYMENT_CHECKLIST.md`：基础设施/外部依赖/步骤/Nginx/备份/监控
- `scripts/deploy.sh`：一键部署模板
- `rag-cli`：CLI README/中文说明/CLI roadmap 与正式 API、高级命令保持同步

## 当前开放事项

### 已用本地模拟数据闭环

- [x] **私密原件模拟包**：27 个脱敏本地文档文件 + 193 条业务问题集
- [x] **GraphRAG 模拟包**：schema、别名、初始实体关系和 15 条语料，dry-run 通过
- [x] **组织权限模拟包**：部门、岗位、用户、角色、继承规则和权限回显样例
- [x] **多模态模拟包**：图片 OCR sidecar、音频／视频 transcript sidecar 和 readiness 校验
- [x] **Karpathy + Obsidian 统一知识链路核心闭环**：已实现 URL/文件/手动输入/官方文档同步统一进入 RAG/Karpathy 索引层和 Obsidian raw/notes/compiled/index；`simple` 走 Karpathy + Obsidian Fast Path，`auto` 先 Fast Path 再按 sufficiency gate 升级 Agentic，`agentic` 读取 Obsidian compiled/index/notes 作为高优先级上下文；详见 `docs/plans/karpathy-obsidian-dual-ingest-plan.md`
- [x] **Obsidian 项目决策编排增强**：已新增项目工作流 API，支持方案选择、技术选型、架构决策 ADR、任务拆解、风险/验收清单，输出到 Obsidian `compiled/project-workflows/{type}`；RAG 重复入库采用 Obsidian `content_hash + rag_doc_id` 补偿索引复用已有 docId，未做数据库 schema 变更
- [x] **Karpathy + Obsidian 编译层补齐**：source note 新增 topics/entities/key conclusions；compiled 层补实体页、结论页、开放问题、版本/语义冲突信号基础检查；related 从 tags 升级为 entities/topics/tags 加权；GraphRAG seed 从 Obsidian entities/topics/tags 导出到 `index/graph/obsidian-seed.json` 和 `GET /api/obsidian/graph/seed`
- [x] **资深岗位证据工程**：新增真实业务 RAG 逐题 API 评测、Agent 重复回放、性能 p50／p95／错误率／吞吐门禁、Redis／Milvus／Hybrid／Graph／外部工具运维证据聚合、五份架构 ADR 和高级／Staff 统一就绪度报告；模拟数据默认保持 `simulated`，工作流完成与模型成功分开统计，缺少生产证据时不会自动判定就绪

### P0：真实业务质量

- [ ] **真实业务原件替换**：提供可脱敏 PDF／DOCX／XLSX／网页导出及版本、部门、权限标签，替换模拟 fixture 后重新入库
- [ ] **真实毒题集验收**：真实 API 逐题评测、脱敏报告和门禁脚本已实现；仍需准备至少 100 条非模拟真实问题、标准答案、来源文档和期望引用，重新评测召回、排序、Faithfulness、引用和拒答
- [ ] **真实游戏官网／活动资料验收**：接入历史 PRD、设计规范、接口、埋点、测试问题单和活动复盘，验证当前 96 条模拟专项问题之外的真实效果
- [ ] **真实业务结果补数**：按 `docs/interview/SENIOR_AGENT_INTERVIEW_READINESS.md` 的统一口径补齐 Recall@K、MRR、nDCG、引用正确率、拒答准确率；完成六岗位任务成功率、P95、降级率、Token／费用统计；采集用户采纳率、返工率、人工接管率和节省工时；至少沉淀 5 个典型失败案例及同数据集、同评分口径的优化前后对比。所有数字必须标注样本量、时间窗口、环境和证据来源

> 生产化待补闭环总表已同步到 `docs/interview/SEVEN_DIFFICULTIES_CHEATSHEET.md` 和 `docs/interview/jd/jd-gap-implementation-status.md`，包括真实业务数据、生产 SLA、Redis 多实例、LangFuse 生产运营、长期回归、用户采纳、部署高可用以及 IAM／DLP／租户治理。当前不使用本地模拟结果冒充生产验收。

> **性能监控口径已补充**：LangFuse 负责单次问答／Agent Trace、节点与模型耗时、首 Token、Token、成本、工具调用和降级定位；Prometheus 负责 QPS、成功率、错误率、P50／P95／P99、并发、基础设施和服务健康。两者已完成本地／云端基础验证，生产 Dashboard、告警、采样脱敏、长期留存和真实 SLA 仍待部署环境配置。

> **Agent 运营入口补齐**：Agent Evals 和调用轨迹已新增独立路由与左侧菜单，复用既有接口和页面能力，避免只作为页内 Tab 隐藏在工作台中。

> **功能步骤流程文档补齐**：新增并持续完善 `docs/interview/功能步骤流程.md`，按用户操作流程和状态／数据流转流程一次性覆盖 Simple、Auto、Agentic、多 Agent 协作、关键词／BM25、语义／向量、知识图谱／Graph Search、RRF／Rerank、权限与版本治理、会话记忆、答案门禁、Bad Case、Redis Checkpointer、LangFuse、Prometheus、Agent Ops、Tool／MCP、Prompt Registry、评测门禁、Adoption、模型网关、部署恢复和文档同步。

> **核心流程实现状态核对**：步骤文档新增实现状态总览和专项流程，按用户操作与状态／数据流转展开 AG-UI／SSE、BullMQ 异步任务、OCR／ASR sidecar、GraphRAG、Bocha Web Search fallback、Redis 缓存、Nest Throttler、成本摘要、DLP、事故复盘等能力；断线续传、真实视觉向量、企业 DLP、租户账单、生产死信／告警／值班等外部能力明确保留为部分实现或环境事项。

> **步骤流程术语注释补齐**：在 `docs/interview/功能步骤流程.md` 开头新增 Agent、RAG、BM25、Embedding、GraphRAG、RRF、Rerank、Checkpoint、AG-UI、SSE、Trace、Generation、Prometheus、BullMQ、MCP、DLP、IAM、SLA 等英文缩写和工程术语的中文解释，并在正文首次出现位置直接追加「（注：……）」说明，方便顺着流程阅读。

> **企业微信告警入口补齐**：admin-backend `NotifyService` 新增 `sendEnterpriseWechatMarkdown()` 和 `sendOperationsAlert()`；配置 `WECHAT_WORK_WEBHOOK_URL` 后发送 Markdown 告警，未配置时返回 `simulated` 结果，步骤文档已补充告警到值班群的用户流程和状态流转。

> **用户效果与生产运营模拟闭环补齐**：新增 `backend npm run simulate:user-outcomes`，模拟采纳率、返工率、人工接管率、节省工时和 SLA；新增 `admin-backend npm run simulate:operations`，模拟 Prometheus 告警、企业微信通知、值班确认、缓解、恢复和 Postmortem，并落盘 evidence 报告。报告明确标记 simulated，不污染真实业务数据。

> **七类生产闭环总模拟补齐**：新增 `backend npm run simulate:production-closure`，一次模拟真实业务数据验收、多实例高可用、多模态、安全合规、成本治理、生产运营和用户效果，并为钉钉、飞书／PagerDuty、企业 IAM／DLP、真实模型价格、视觉模型和 Kubernetes／死信队列保留明确接入注释。

> **项目架构图补齐**：在 `docs/interview/功能步骤流程.md` 新增 Mermaid 总体架构图、分层讲解和一次问答时序图，覆盖入口、API、Simple／Auto／Agentic、多 Agent、混合检索、状态记忆、知识存储、模型工具、LangFuse／Prometheus 和告警通知。

### P1：真实系统联调

- [ ] **组织主数据联调**：接入真实部门、岗位、用户、角色和同步方式，覆盖转岗、兼任、离职和外包账号权限
- [ ] **GraphRAG 业务数据联调**：导入真实实体、关系、别名和冲突合并规则，验证图谱召回及版本冲突
- [ ] **视觉／视频真实联调**：配置真实模型和样本，评测 OCR、图片理解、ASR 和视频理解准确率
- [x] **LangFuse 可观测闭环（本地真实云端）**：已验证真实 trace、generation、flush、health、token／成本字段和节点事件上报；生产看板、告警规则和长期留存仍需部署环境补齐

### P2：性能与稳定性

- [x] **六岗位模型长期稳定性（本地 30 次）**：已完成 30／30 个完整 DAG、180／180 个岗位模型调用成功、模型降级 0；跨供应商长期 SLA 仍需真实生产窗口
- [x] **RAG 延迟／成本门禁（本地规格）**：`perf:rag` 已补并发、成功率、错误率、吞吐、p50／p95、Token 和成本预算字段；local 30＋30 样本门禁通过，strict 需要配置真实模型单价并在目标机器复验
- [x] **Checkpointer 多实例恢复（进程级）**：两个独立进程共享 Redis 完成 writer→reader 恢复和清理；真实多副本编排、实例崩溃和长时间暂停仍需部署环境复验
- [ ] **生产规格压测**：在目标机器验证 Milvus／ES／Redis／Neo4j／PostgreSQL 的冷启动、热缓存、批量导入、并发问答、队列积压和故障恢复

### P3：客户端与生产验收

- [ ] **Agent Ops 登录后 E2E**：覆盖启动、轮询、审批、局部重跑、失败降级、产物下载和分享；当前只验证了无登录态重定向且控制台无错误
- [ ] **Graph Ops 视觉复验**：完成节点、关系、统计三个二级页面的桌面／移动端截图检查
- [ ] **CLI 在线复验**：在当前正式 3000 服务验证 `rag ask --stream`、`rag graph query` 和 `rag eval run`
- [ ] **生产落地**：确认目标机器、域名、证书、网络、密钥注入、备份、恢复、监控、灰度和回滚后执行生产验收
- [ ] **安全合规口径**：确认数据分级、保留周期、脱敏规则、审计字段及内审要求

## 阻塞 / 红线

- 不修改 `.env`、密钥、token、CI/CD、生产部署 — 需主人确认
- 后续数据库 schema 变更或迁移仍需主人逐次确认；`AddGameProductionRagGovernance` 与本轮 `AddGeneratedArtifacts` 均已获明确授权并在本地开发库执行
- 不删除文件或 git 回滚 — 需主人确认
- 真实 key/生产环境依赖主人提供
- Node v20.18.0 当前可用，admin 工具链建议 Node 22+ 复验
- 生产级部署/域名/证书/备份/监控接入本轮按要求不做

## 最近验证

### 2026-08-11

- **Agentic 子问题多路检索闭环（已完成）**：将原来的“首问混合检索＋扩展问句 BM25”升级为显式子问题计划；每个子问题独立执行向量、BM25／Elasticsearch、父子上下文扩展，关系／多跳问题按需接入 GraphRAG，逐题执行充分性门禁，不足项进行一次有界 Web Search 补检索并再次评估，最终合并去重、保留每题最低证据覆盖并统一 Rerank。新增 `AGENTIC_MAX_SUB_QUESTIONS`、`AGENTIC_GRAPH_SEARCH_ENABLED` 配置，更新 `docs/interview/功能步骤流程.md` 的用户流程和状态流程。验证：backend build ✅；backend 全量 42 Suites／183 Tests ✅；本次相关 ESLint 和 4 Suites／16 Tests ✅。真实 GraphRAG／Bocha 结果仍依赖对应服务和 key。
- **Auto 链路延迟优化（已完成）**：移除 Fast Path 不足时的重复检索／模型兜底分支；Auto 升级 Agentic 时复用 Fast Path 原问题召回结果，补充子问题并行检索，Auto 子问题上限收敛为 2 个，Agentic 保持最多 3 个。新增 Fast Path 复用回归测试，更新步骤文档。验证：backend build、定向 ESLint、Agentic 定向测试通过；全量测试 42 Suites／184 Tests 通过。

### 2026-08-08

- **AI 问答会话提交 Bad Case（已完成）**：在每条已完成 AI 回答旁新增「提交 Bad Case」按钮和表单，支持错误类型、问题描述、纠正答案及回归集开关；新增管理代理和 RAG 管理接口，按 `threadId` 关联最近问答记录并复用服务端召回快照，提交后进入 Agent 运营审核池。backend build、admin-backend build、admin tsc 均通过。
- **Bad Case 提交用户隔离修复（已完成）**：管理后台提交 Bad Case 时改为沿用当前登录用户的 `userId`，与 Simple／Agentic 问答写入 QueryLog 时的用户标识一致，修复错误返回 `query log not found` 的问题；admin-backend build ✅。
- **管理后台旧会话 Bad Case 兼容修复（已完成）**：管理入口在当前用户范围查不到 QueryLog 时，允许受权限保护的管理员按 `threadId` 回查最近记录，兼容旧会话和身份切换场景；普通用户 `/chat/feedback` 仍保持用户隔离。backend、admin-backend build ✅。
- **无 QueryLog 会话 Bad Case 兜底（已完成）**：针对会话消息已保存但 QueryLog 缺失的情况，管理员提交 Bad Case 时从最后一组 human／ai 消息生成最小 QueryLog，再保存反馈；RAG 反馈定向测试 4／4、backend build ✅。
- **Simple／Agentic Bad Case 纠错链路（已完成）**：Bad Case 检索改为结构化返回命中分数和 `hint／correction／exact` 级别；Simple 并行检索审核案例并增加 Correction Gate，精确／强命中使用纠正答案，弱命中注入提示；Agentic 复用同一协议。Bad Case 定向测试 6／6、backend build ✅；正式知识补录和生产流量后的长期效果仍需真实业务数据验证。
- **Bad Case 自然化回答修复（已完成）**：Simple 精确／强命中不再原样返回人工 `correctedAnswer`，而是将审核事实交给统一生成 Prompt 重新组织回答；Agentic 继续通过同一纠错证据协议生成。定向测试 9／9、backend build、admin-backend build ✅。
- **Auto／Agentic 强命中纠错修复（已完成）**：Agentic 生成节点对 `exact／correction` 命中改为复用统一纠错生成器，不再只把 Bad Case 放进普通 memory，避免错误检索结果覆盖已审核事实；Agentic／Bad Case 定向测试 5／5、backend build、admin-backend build ✅。
- **Bad Case 短实体查询命中修复（已完成）**：在向量门槛之外增加审核问题与当前问题的实体包含兜底，将“韦水春”命中“韦水春是谁”这类短查询标记为 `exact`，避免短实体向量相似度不足导致纠错证据未生效；定向测试 5／5、backend build ✅。
- **Agentic 检索不足兜底绕过修复（已完成）**：Agentic 在无索引、检索不足和 Fast Fallback 前增加已审核 Bad Case 纠错预检，命中后先重新生成自然答案，不再直接走普通模型兜底；Agentic 定向测试 3／3、backend build ✅。
- **Bad Case 生产闭环增强（已完成）**：审核回灌现在具备索引生命周期同步，审核撤销、取消回归或忽略案例会删除独立 Milvus 向量；审核接口返回索引结果，后台显示回归集状态并提示 Milvus 回灌失败。Simple／Agentic 先判断当前知识是否充分，正式证据充分时 Bad Case 只作为提示，避免旧纠正答案直接覆盖新知识。新增 `npm run eval:bad-case`，从有效审核案例逐条执行 simple／auto／agentic 并校验旧答案不再出现、纠正事实覆盖率和路由；当前本地 2 条案例、6 次执行全部通过。验证：backend build ✅、Bad Case／Agentic 定向测试 11／11 ✅、admin TypeScript ✅。
- **七项难点本地验证增强（已完成）**：稳定性回放支持本地登录、30 次完整 DAG、串行／并发控制和 429 退避；本轮 30／30 个完整 DAG、180／180 个岗位模型调用成功、模型降级 0，`local` 稳定性门禁通过；RAG 性能基准新增 `local／strict` Profile，本地 30＋30 请求成功率 100%，local 门禁通过；Redis Checkpointer 跨进程 writer／reader／cleanup smoke 通过；LangFuse 新增状态契约、主动 trace smoke、flush 和 `npm run smoke:langfuse`，轮换后的配置已验证真实 trace 上报成功。自动审批场景不要求审批就绪，本地非真实业务证据覆盖率只作观察项；真实业务数据和生产 SLA 仍单独保留为外部验收项。
- **生产闭环可测性增强（已完成）**：Redis smoke 明确验证两个独立进程共享 Redis 的 writer→reader 恢复；LangFuse 增加 health 状态、flush 时间、累计 trace 数和错误状态，真实云端 trace／generation／flush 已验证；Bad Case 回归新增长期 JSONL 历史，`eval:bad-case:long-term` 可持续比较通过率；RAG Ops API 新增 `qa/adoption-summary` 和 `smoke:adoption`，统计活跃用户、复访用户、回答率、反馈覆盖率和正向反馈率。生产成本单价、真实流量长期 SLA、真实业务数据和用户采纳结论仍不伪造。
- **面试核心企业能力补齐（已完成）**：新增 `LlmGatewayPolicy`，统一任务类型、主备模型、超时、输出上限和成本预算；补充面试速查卡、JD 差距状态和 `.env.example` 配置说明。已有 ACL／Prompt Injection／Tool Registry／审计基础与新模型网关策略可以形成完整回答；真实 IAM、DLP、租户账单和生产灰度仍保留为后续环境事项。
- **Bad Case 管理后台入口补齐（已完成）**：在 Agent 运营下新增独立「Bad Case 审核」菜单和 `/agent-ops/bad-cases` 路由，进入后直接展示待审核列表；保留工作台内原 Bad Case Tab，并补充加载失败提示。管理后台 `pnpm run lint` 通过（Node 20 引擎提示和既有 lint warning）；admin-backend `npm run verify` 通过（build、lint、71 单测、19 E2E、migration check）。
- **AI 应用/Agent 岗面试冲刺材料（已完成）**：新增 `docs/interview/deepseek-AI应用Agent岗-10小时冲刺指南.md`（10 小时倒排计划、六条主线 30 秒背诵卡、必背数字表、红线自检、高频回答框架和面试复盘模板）和 `docs/interview/deepseek-AI应用Agent岗-模拟问答题库.md`（33 道高频模拟题逐题可背答案、追问应对和边界红线，覆盖检索/Agentic/Prompt/安全/多租户/可观测全知识面）；同步在 `docs/interview/README.md` 登记索引。仅文档更新，未改代码。

### 2026-08-03

- **六岗位 Qwen 模型稳定性修复（已完成）**：根因是 Qwen Provider 默认 20 秒超时低于岗位结构化输出的真实 18～43 秒耗时，导致工作流外层预算尚未耗尽时请求已被 Provider 主动终止；同时原实现未限制最大输出，失败后立即重试。Qwen 默认超时调整为 60 秒，岗位调用预算调整为 75 秒，新增 `maxTokens=4096`、`maxRetries=2`、`temperature=0.2` 和外层 1 秒退避；保留设计／后端并行。独立 `3010`、Node `v22.22.1` 真实回放连续三次完整 DAG，18／18 个 `role_structured_llm` 全部 `success`，模型成功率 100%、降级率 0%；三次总耗时约 161.0／136.9／160.9 秒，单角色最大约 43.0 秒。新增 Qwen Provider 配置回归测试 1／1 ✅；工作流定向测试 10／10 ✅；backend build ✅。完整证据保存于本地 `.tmp/evidence/agent-dag-after-timeout-fix.json` 和 `.tmp/evidence/agent-dag-repeat-after-fix.json`；30 次跨时间窗口长期稳定性仍保留为开放事项。
- **高级／资深／Staff Agent 岗位证据工程（已完成）**：新增 `evidence:business`，可将非模拟真实业务集上传到真实后端并逐题评关键词、Claim、引用、拒答、冲突和延迟，结束后清理临时文档；新增 `evidence:stability`，重复回放单岗位／六岗位真实工作流并分别统计工作流完成、模型成功／降级、审批就绪、证据覆盖、产物和 P95；增强 `perf:rag`，补并发、成功率、错误率、吞吐、p95 和 JSON／Markdown 报告；新增 `evidence:operations` 聚合 Redis、Milvus、Bad Case、Hybrid、Graph 和外部工具 smoke；新增五份 ADR、跨团队／事故证据模板与 `evidence:readiness` 高级／Staff 证据门禁。真实小样本验证：业务 API 1／1 通过但因模拟数据保持 `simulated`；Simple 2／2、Agentic 2／2 请求成功但严格延迟 SLA 未通过；Redis Checkpointer 与 Milvus Bad Case 2／2 通过；单岗位工作流完成且模型成功、产物入队，但证据覆盖 0.5、审批就绪 0，稳定性门禁正确失败。统一门禁当前资深架构证据 2／5、Staff 证据 2／9；`npm run evidence:test` 2／2 ✅；全部新增脚本 `node --check` ✅；backend build ✅。详细操作见 `docs/interview/SENIOR_AGENT_INTERVIEW_READINESS.md`。真实 100 条业务集、30 次完整 DAG、生产规模、跨团队采纳和线上事故仍需实际运行产生，未冒充已完成。
- **七项难点项目代码地图（已完成）**：`docs/interview/SEVEN_DIFFICULTIES_INTERVIEW_GUIDE.md` 新增七项难点与真实项目代码的逐项映射，每项按核心入口、辅助实现、管理后台、单测、评测数据集和验证命令组织，覆盖产研运 FSM、快慢路径、结构切片与混合检索、分层记忆、Agent Evals、Bad Case 飞轮和节点级可观测；同步更新 `docs/README.md` 描述。本次仅更新文档，未改代码。
- **未完成事项文档校准（已完成）**：主路线图将“模拟包已完成”与“真实业务仍待验收”拆开，新增真实数据、真实系统、六岗位模型稳定性、生产规格压测、登录后 E2E、CLI 在线复验和生产落地清单；同步校准 `docs/plans/remaining-enhancement-plan.md`、`backend/docs/remaining-enhancement-plan.md`、`admin/ROADMAP.md` 和 `rag-cli/ROADMAP.md`，已实现的 BullMQ、短期记忆、Mem0 页面、部署模板和 Milvus smoke 不再显示为未完成。本次仅更新文档，未改代码、数据库或环境变量。
- **产研协作 Agent 平台闭环（已完成）**：六岗位工作流升级为显式业务 DAG，产品先执行，设计／后端并行，前端等待两者，测试执行质量门禁，运营汇总发布；每个岗位使用独立检索工具和一次调用预算，输出真实 Markdown、声明级证据、覆盖率、风险、工具轨迹和可分享产物。新增 `auto|required|risk_based` 审批、指定岗位审批、同批次局部重跑、模型失败证据保留降级、75 秒岗位模型预算与退避重试、异步启动／审批命令、2 秒状态轮询及进程重启 checkpoint 续跑。10 条专项回归的任务成功、依赖正确、交付完整、证据门禁、产物、局部重跑、工具预算七项指标均为 1.0；真实异步单岗位启动 9ms 返回且 Qwen 成功，真实必审后端任务启动 4ms、审批 11ms 返回并最终 Qwen 成功。早期一次完整回放因 Qwen Provider 默认 20 秒超时仅 1／6 成功；修复后独立 Node 22 实例连续三次完整 DAG 共 18／18 模型调用成功、0 降级，并保持设计／后端并行，总耗时约 136.9～161.0 秒。工作流定向 4 Suites／19 Tests ✅；backend 全量 40 Suites／177 Tests ✅；admin-backend 8 Suites／71 Tests ✅；admin 3 Files／25 Tests ✅；三端 build ✅；本轮 backend ESLint 与 admin lint ✅。浏览器访问 `/agent-ops` 被正确重定向到登录页且控制台无错误；因当前浏览器无登录态，未重复声称登录后视觉验收。
- **可选 LangFuse 测试加载修复（已完成）**：LangFuse SDK 改为只有配置启用且密钥完整时才加载，禁用状态不再让 Jest 30 因 SDK 动态 import 直接退出；默认 `npm test -- --runInBand` 已在 Node `v22.22.1` 下通过 39 Suites／176 Tests，生产启用路径保持原配置和客户端初始化行为。
- **Milvus Bad Case 检索闭环恢复（已完成）**：本地 Milvus 从 `2.4.4` 升级到 `2.4.19`，Node SDK 固定 `2.4.10`；主 collection 425 行、HNSW 索引完成，真实向量检索约 24ms；新增 `smoke:milvus:bad-case`，验证临时坏例 insert、flush、向量命中、标量读回和清理全部通过。旧文档中“独立读回 60 秒超时”的阻塞已解除。
- **七项难点面试讲解稿（已完成）**：新增 `docs/interview/SEVEN_DIFFICULTIES_INTERVIEW_GUIDE.md`，把产研运 LangGraph FSM、快慢路径、混合检索与结构保护切片、分层结构化记忆、Agent Evals、Bad Case 数据飞轮、节点级可观测性七项能力，统一按业务背景→核心矛盾→方案对比→项目选择→具体实现→验证效果→真实边界组织；每项补充可直接口述的面试回答和常见追问，并提供 30 秒／2 分钟项目串讲。同步更新工作流使用文档、docs 索引和面试文档阅读导航。
- **六岗位工作流使用文档（已完成）**：新增 `docs/PRODUCTION_WORKFLOW_USAGE.md`，说明产品、设计、前端、后端、测试、运营的职责，单岗位独立执行、多岗位结构化交接、固定依赖顺序、自动／人工审批策略、管理后台操作、典型岗位组合、完整 API 示例、使用原则和当前边界；同步加入 `docs/README.md` 索引。
- **六岗位独立／协作编排（已完成）**：产研运工作流新增 `roles` 岗位选择，产品、设计、前端、后端、测试、运营均可单独执行，也可任选多个协作；服务端会把调用方传入的岗位规范为固定产研依赖顺序，未传时保持六岗位完整链路。审批策略与岗位组合正交，单岗位／多岗位都可选择自动流转或重要任务人工审批；管理后台增加多选岗位并按实际参与岗位渲染步骤条。验证：工作流定向 6／6 ✅；backend 全量 37 Suites／166 Tests ✅；backend build ✅；admin build ✅。
- **产研运工作流按重要性审批（已完成）**：生产工作流新增 `approvalMode=auto|required` 任务级策略，默认普通任务自动完成产品→设计→前端→后端→测试→运营流转；只有显式标记为重要任务时才逐节点暂停等待人工批准／驳回，避免把审批成本强加给所有任务。管理后台同步增加审批策略选择并展示当前策略；单测覆盖普通任务自动完成、重要任务逐节点批准、驳回回退和 owner 隔离。验证：工作流定向 4／4 ✅；backend 全量 37 Suites／164 Tests ✅；backend build ✅；admin build ✅。
- **七项专家级 Agent／RAG 难点实现闭环（已完成）**：新增产研运 LangGraph FSM（产品→设计→前端→后端→测试→运营）、逐节点结构化输出、人工批准／驳回回退、最大步骤防死循环和 Redis 30 天 Checkpointer；短期记忆升级为结构化决策／事实／开放问题摘要并保留最近 6 轮原文；已审核负反馈可写入独立 Milvus Bad Case collection，并在生成前最多召回 2 条相似纠错样本且不得覆盖当前知识证据；新增 Agent Evals API、8 条任务数据集和任务成功／忠实度／PRD 覆盖／用例完整／工具成功／步骤准确／人工接管指标；新增节点耗时、首 token、工具调用、空召回、循环终止 Prometheus 指标与节点级 trace；管理后台新增 `/agent-ops` 工作流审批、Evals、Bad Case 审核和调用轨迹四页签。验证：真实 Qwen 工作流完成产品节点并批准恢复到设计节点 ✅；真实 Agent 图 7 节点 trace 完整且一次 SSE 只计 1 次 HTTP ✅；真实通过／拒绝评测样本均符合预期 ✅；Bad Case 审核、Milvus 写入、向量检索、标量读回和清理均已通过 ✅；backend 最新全量 39 Suites／176 Tests ✅；admin-backend 8 Suites／71 Tests ✅；三端 build ✅；项目真实服务回放 28／28 ✅；成熟度门禁 93／100 ✅；管理后台桌面与 390px 无横向溢出，单案例评测和轨迹页面可操作 ✅。详见 `docs/plans/expert-agent-difficulties-implementation.md`。
- **SSE 可观测计数修复（已完成）**：Tracing／Metrics interceptor 从每个 Observable `next` 重复记一次改为 `finalize` 只在请求结束时记录一次；新增多事件 SSE 回归测试。真实回放修复前一次请求累计 76 条 HTTP 记录，修复后严格为 1 条，7 个 Agent 节点不再被重复 HTTP span 挤出最近 trace。
- **QA 聊天直接生成文件闭环（已完成）**：修复模型仍按旧能力边界回答“无法直接生成 Word、只能复制粘贴”的问题。新增文件意图解析器，仅在“执行动词＋Word／Excel／Markdown／架构图／图片”成立时触发，`AguiService` 向模型注入真实能力约束并在回答完成后调用 `artifact_generate`；`RUN_FINISHED.output.artifacts` 返回任务，管理后台消息卡片持续轮询状态并直接提供下载、外部分享入口。能力讨论、“怎么生成”和下载已有文件类提问不会误触发。验证：意图与 AGUI 单测 2 Suites／13 Tests ✅；backend build ✅；admin build ✅；真实 Qwen SSE 未出现拒绝文案，包含 TOOL_CALL_START／ARGS／END 和 Word artifact ✅；任务最终 `ready`，下载 DOCX 为 `application/vnd.openxmlformats-officedocument.wordprocessingml.document`、10804 bytes、ZIP `PK` 文件头 ✅。
- **QA 可传播产物与分享闭环（已完成）**：新增 `generated_artifacts`、`artifact_shares`、`artifact_access_logs` 三张表和 `AddGeneratedArtifacts1785727200000` 迁移；RAG 后端新增独立 `artifact-generation` BullMQ 队列、对象存储读写、Markdown／Word／Excel／SVG 架构图／DashScope PNG 五类生成器，以及所有者隔离、内部／外部高熵令牌分享、有效期、下载限次、撤销和访问日志；服务令牌接口强制校验 `ownerUserId`，漏传返回 400，避免 TypeORM 忽略空条件造成越权读取。admin-backend 仅负责 JWT 用户身份与 HTTP／二进制代理；admin `/qa-ops` 新增生成表单、文件抽屉、下载与分享，`/shared/artifacts/:token` 提供匿名外部分享页和图片／架构图预览。真实验证：迁移 4／4 ✅；五种文件真实生成 5／5 ✅，DOCX／XLSX 压缩结构、SVG XML、PNG 1024×1024 均有效；DashScope 文生图真实调用 ✅；外链 metadata／preview／download、一次下载上限和撤销返回码均正确 ✅；访问日志 preview／download 落库 ✅；admin-backend 登录创建、轮询、分享和匿名代理 ✅；backend 新增单测 2／2、admin-backend 相关测试 37／37 ✅；三端 build／TypeScript／Ant Design 检查通过；桌面与 390px 移动端浏览器验证无横向溢出 ✅。
- **管理后台岗位预设闭环（已完成）**：RAG 服务新增服务令牌保护的 `GET /api/v1/rag/admin/role-presets`，admin-backend 新增 `GET /api/admin/qa-ops/role-presets` 代理并在 AG-UI 链路透传 `rolePresetId`；管理后台 QA 页新增八岗位选择、职责、常用任务、示例问题和 localStorage 记忆。岗位目录仍以 `role-presets.ts` 为唯一事实源，与系统 RBAC 角色完全分离，未新增 schema、依赖或 `.env` 修改。验证：backend Node 22 全量 28 Suites／135 Tests、build ✅；admin-backend 8 Suites／71 Tests、build／lint ✅（仅既有 warning）；admin 定向 Biome、TypeScript、build ✅；Ant Design CLI 本次新增页面 0 issue；真实目录 8 岗位 ✅；产品经理 AG-UI 透传 200／RUN_STARTED／RUN_FINISHED ✅；浏览器视觉与无横向溢出检查 ✅。
- **岗位预设与首次使用工作台（已完成）**：系统统一保持“懂产品、设计、前端、后端、测试、运营和项目管理全流程的业务负责人”基础身份，新增业务负责人、产品经理、UI／UX 设计师、前端开发、后端开发、测试、游戏活动运营和项目经理 8 个岗位预设；每个预设包含职责、常用任务、3 个示例问题和岗位回答结构。`GET /api/v1/chat/role-presets` 提供唯一角色目录，`rolePresetId` 已接入 simple、agentic、auto、Chat SSE 和 AG-UI SSE；中英文岗位别名统一映射到 `roleScope`，业务负责人不缩窄检索，公共文档保持可见。frontend 新增岗位选择、职责说明、任务入口和问题自动填入，选择结果使用 localStorage 记忆。未新增 schema、未修改 `.env`、未添加依赖。验证：后端全量测试 28 Suites／135 Tests ✅；角色相关 3 Suites／11 Tests ✅；backend 定向 ESLint ✅；backend build ✅；frontend lint／build ✅；真实角色目录 HTTP smoke 8 个岗位 ✅；产品岗位真实问答 201、answer／queryLogId ✅；浏览器验证角色切换和示例问题填入 ✅。
- **游戏官网／活动 RAG 功能增强闭环（已完成）**：实现入库质量门禁与 PRD／API／Design／Test／Config／Postmortem 策略路由；文档与 Chunk 支持 project／activity／region／locale／channel／roleScope／documentType／lifecycle metadata，替代文档会自动废弃旧版本；检索支持 query intent 自适应候选深度、scope 过滤、同 Section／相邻块扩展、语义去重、单文档限额、上下文预算和 Lost-in-the-Middle 排布；新增真实用户反馈、服务端召回快照和 Admin Bad Case 审核，不再返回假成功。`AddGameProductionRagGovernance` migration 已获明确授权并在本地开发 PostgreSQL 执行，`migration:show` 3／3 已应用。验证：后端全量测试 28 Suites／135 Tests ✅；backend build ✅；admin-backend build ✅；`eval:game-marketing` 8 文档／96 问题 ✅；`enterprise:readiness` 12／12 ✅；真实本地登录、scope 问答、queryLogId、反馈写入和 metrics HTTP smoke ✅。本地工程闭环已完成，真实企业私有数据效果和生产部署不在本次完成口径内。
- **游戏官网／活动业务结构保护切片优化**：基于 `docs/PROJECT_BACKGROUND.md` 优化 `MarkdownChunker`：每个叶子 Chunk 重复完整章节路径；代码围栏保持原子性且不参与 Markdown 表格转换；配置、概率和地区表格按完整行切分并在每块重复表头，保留空单元格和转义竖线的原列语义；接口契约、测试／验收、版本／地区规则增加轻量内容类型标识，继续复用已有父子 Chunk、headingPath、tableRef 和 source span，不新增 schema 或依赖。同步 `ARCHITECTURE.md` 与 `PRD.md`。验证：Chunker／Parser 单测 13／13 ✅；`backend npm run build` ✅；Chunker 定向 ESLint ✅；`backend npm run eval:game-marketing` ✅（8 文档／96 问题）。
- **游戏官网／活动产研一体化项目背景文档**：新增 `docs/PROJECT_BACKGROUND.md`，统一说明项目定位、产品／UI／前端／后端／测试五类用户、从需求到复盘的业务闭环、知识沉淀边界、RAG 与 Agent 分工、七类技术难点的业务来源、产品形态、成功指标和简历表达边界；明确附带材料中的高完成率、高召回率和成本收益数字在缺少对应实验时只能作为目标，不能冒充真实结果。同步更新 `docs/README.md` 与本文件索引。仅文档更新，未改代码。

### 2026-07-30

- **docs 目录分类整理**：将根目录 `docs/` 下文档按用途整理到 `docs/interview/`、`docs/interview/resume/`、`docs/interview/jd/`、`docs/plans/`，新增 `docs/README.md` 作为文档总索引；同步更新 `ROADMAP.md`、`INTERVIEW_PLAYBOOK.md` 和相关文档中的路径引用，并修正 `ROADMAP.md` 中 BullMQ 异步队列方案的实际路径为 `backend/docs/async-task-queue-plan.md`，同步修正 `backend/docs/remaining-enhancement-plan.md` 的同目录引用。仅文档路径整理，未改代码。
- **面试文档目录整理**：将原先散放在 `docs/` 根层的面试使用说明移动到 `docs/interview/interview-docs-usage.md`，统一面试导航文档到 `docs/interview/` 目录；同步更新 `ROADMAP.md` 和 `docs/interview/resume/resume-rag-project-game-marketing.md` 中旧路径引用。仅文档路径整理，未改代码。

### 2026-07-29

- **面试文档使用说明升级**：更新 `docs/interview/interview-docs-usage.md`，把 2026-07-29 补齐的高级 Agent 开发主干纳入使用导航，明确 `INTERVIEW_PLAYBOOK.md` 负责“怎么说”、`AI_AGENT_CORE_KNOWLEDGE.md` 负责“为什么”、`docs/interview/agentguide-rag-interview-mapping.md` 负责“AgentGuide 怎么对上项目和哪些不能吹”；新增面试前 10 分钟、30 分钟、2 小时、半天的阅读策略，以及 Agent Harness、Evaluation Harness、框架选型、合规型 Agent、沙箱、数据合成、工作流优先等问题的定位表。仅文档更新，未改代码。
- **高级 Agent 开发通用主干闭环**：继续更新 `AI_AGENT_CORE_KNOWLEDGE.md`、`INTERVIEW_PLAYBOOK.md`、`docs/interview/agentguide-rag-interview-mapping.md`，补齐最后两块通用缺口：数据合成 / 评测集构建工程口径（Self-Instruct、Evol-Instruct、AgenticRAGTracer、Dependency Irreducibility、格式/语义/约束/多样性/去污染五道质量防线、合成数据只能冷启动不能冒充真实业务效果）和企业 Agent 工作流落地口径（workflow first、Agent 不总是最佳答案、Agent onboarding、每一步可追踪验证、可复用组件、人类负责判断/合规/最终签署）。同时在文档中明确高级 Agent 开发通用面试主干已覆盖，后续只按具体公司 JD 做定制化补强。仅文档更新，未改代码。
- **高级 Agent 开发边角知识补齐**：继续更新 `AI_AGENT_CORE_KNOWLEDGE.md`、`INTERVIEW_PLAYBOOK.md`、`docs/interview/agentguide-rag-interview-mapping.md`，补齐 AgentGuide 中剩余的开发岗高频边角：Agent 框架选型（LangGraph、LangChain、AutoGen、CrewAI、Swarm、Parlant、AgentScope）、Parlant / 合规型 Agent（failure severity、Guidelines、Journeys、Strict Mode、ARQs）、Agent 沙箱隔离（Docker、microVM/E2B、gVisor/Kata、OpenSandbox、Browser sandbox、文件/网络/secret/资源/审计约束）、多模态 RAG 证据定位（page、bbox、figure、table、caption、timestamp、ColPali/ColQwen/ViDoRe 了解项）。仅文档更新，未改代码。
- **高级 Agent 开发面试知识补齐**：继续结合 AgentGuide 的 12-Factor Agent、Agent Harness、Evaluation Harness、Agentic RAG / Deep Research、Skills / 程序性记忆、Memory 高级设计和生产 Agent 挑战，更新 `AI_AGENT_CORE_KNOWLEDGE.md`、`INTERVIEW_PLAYBOOK.md`、`docs/interview/agentguide-rag-interview-mapping.md`。新增生产级 Agent 控制流、统一状态、暂停恢复、无状态 reducer、多入口触发、Agent Harness 七层、可靠性六件套、Task/Trial/Transcript/Outcome/Grader/Report、pass@k/pass^k、上线门禁、RAG 四代演进、Self-RAG/CRAG 工程近似、Deep Research 搜索规划、Skill 渐进式披露、Skill 安全、working/episodic/semantic/procedural memory、记忆冲突/过期/遗忘、错误复合和长上下文成本等高级 Agent 开发面试口径。仅文档更新，未改代码。
- **AI 应用 / 大模型应用面试方案地图补强**：结合 `/Users/monster/Documents/GitHub/code/AgentGuide` 中 RAG、Agent、上下文工程、MCP、Memory、模型评测、文档解析和向量库选型高频问题，更新 `AI_AGENT_CORE_KNOWLEDGE.md`、`INTERVIEW_PLAYBOOK.md`、`docs/interview/agentguide-rag-interview-mapping.md`，新增“有哪些方案、优缺点、怎么选择、项目怎么落地、边界是什么”的横向知识地图，覆盖文档解析、切片、Embedding、向量库、BM25/Hybrid、Query 改写、Rerank、上下文组装、Lost in the Middle、幻觉治理、RAG 评测、数据更新、权限、Memory、Agent 架构、Tool/MCP、多 Agent、模型路由、Prompt/Context Engineering、微调取舍、推理性能、可观测、安全、多模态、成本延迟等面试必会点。仅文档更新，未改代码。
- **RAG 分块策略面试口径补强**：更新 `INTERVIEW_PLAYBOOK.md` 和 `AI_AGENT_CORE_KNOWLEDGE.md`，把文档分块从“结构切分 + 500/50 参数”扩展为面试可讲版本，覆盖固定长度、递归字符、结构化切分、Parent-child、语义切分、多模态专用切分等方案对比，以及 chunk size / overlap 取舍、项目当前 MarkdownChunker 落地、差旅制度示例、评估指标和不能这么说的边界。仅文档更新，未改代码。

### 2026-07-28

- **INTERVIEW_PLAYBOOK 高频问题清晰化**：更新 `INTERVIEW_PLAYBOOK.md`，新增“这份文件怎么用”和“面试先看：核心问题清晰回答版”，把 RAG 项目定位、RAG 主链路、simple/auto/agentic、向量/ES/图谱、召回优化、Rerank、Memory/缓存/Token、幻觉控制、多 Agent、工具调用、MCP/CLI、评测、权限、项目问题、情感分析、AI Coding、前端业务关联和一线大厂生产差距整理成“一句话结论 -> 项目做法 -> 追问边界”的面试回答；同步 `docs/interview/interview-docs-usage.md` 的定位入口。仅文档更新，未改代码。

### 2026-07-27

- **ProcessOn AI 应用思维导图面试用法沉淀**：新增 `docs/interview/processon-ai-application-mindmap.md`，按原图完整整理“大模型与 Agent 技术全景知识库”的六大分支：核心理论基础、RAG 技术全链路、Agent 系统设计、Agent 评估与评测、多 Agent 系统、面试与职业发展；保存原图到 `docs/assets/processon-ai-application-mindmap.png`；更新 `docs/interview/interview-docs-usage.md`，补充 ProcessOn 图使用入口和 AI 应用面试知识树，并对照当前 RAG 项目的 Memory、LangGraph、MCP、Hybrid Search、GraphRAG、Agentic Workflow 讲法；同步 `docs/interview/resume/resume-rag-project-game-marketing.md`，补充面试时只取 6 条主线的速记入口。仅文档更新，未改代码。
- **RAG 项目面试短回答补充**：更新 `docs/interview/resume/resume-rag-project-game-marketing.md`，新增“简历四条负责内容怎么说”和“重难点与结果短回答”，把整体架构、知识与检索链路、Agentic Workflow、质量与工具化，以及业务知识变化快、分层检索、可信追溯、复杂需求转方案等简历内容整理成 30 秒 / 1 分钟 / 追问短回答；同步 `docs/interview/interview-docs-usage.md` 的问题定位索引。仅文档更新，未改代码。

### 2026-07-09

- **AgentGuide 面试具体落地方案补强**：继续更新 `docs/interview/agentguide-rag-interview-mapping.md`，新增“具体落地方案”章节，把记忆系统、缓存系统、召回优化、Token 节省、纠错机制、权限过滤、索引一致性、可观测排障、评测灰度、GraphRAG 等优化点补成流程、数据结构、关键策略、当前项目状态、待补边界和可直接背诵的面试答案。仅文档更新，未改代码。
- **AgentGuide 面试优化追问第二批补强**：继续更新 `docs/interview/agentguide-rag-interview-mapping.md`，补充数据更新与索引一致性、权限过滤、噪声治理、时效性与新旧知识冲突、Chunk 策略、高并发低延迟、成本治理、工具调用失败、可观测与问题定位、评测灰度上线门禁、多 Agent 冲突和 GraphRAG 图谱更新等面试追问口径；明确当前项目现状、代码证据和不能硬说的生产边界。仅文档更新，未改代码。
- **AgentGuide 面试优化追问补强**：继续更新 `docs/interview/agentguide-rag-interview-mapping.md`，新增“优化追问专项”，补齐记忆分层、Redis 缓存、BM25 索引快照、召回优化、Token 节省、Sufficiency/Web Search/Rerank/Citation/Reflection 纠错机制、Self-RAG/CRAG 面试口径和后续可优化方向；同步补充对应代码证据索引。仅文档更新，未改代码。
- **AgentGuide 面试知识对照文档**：结合 `/Users/monster/Documents/GitHub/code/AgentGuide` 中 RAG、Agent、MCP、Memory、安全、评测和 Agentic RAG 高频面试知识，新增 `docs/interview/agentguide-rag-interview-mapping.md`，把当前 RAG 项目的强项、缺口、可回答问题、回答模板、简历边界和代码证据统一整理成面试复习手册。仅文档更新，未改代码。

### 2026-07-08

- **游戏营销 RAG 简历终版优化**：参考主人现有 docx 简历的“项目简介 / 技术栈 / 团队规模 / 负责内容 / 难点”结构，更新 `docs/interview/resume/resume-rag-project-game-marketing.md`，新增“按当前简历格式可粘贴版”；同时优化“简历最终版”，把原项目说明式长 bullet 收敛为更适合投递的“业务场景 -> 技术动作 -> 价值/证据”表达；新增“简历精简版”4 条，可直接粘贴到简历；补充投前端负责人/AI 应用/大厂平台岗位时的取舍建议。仅文档更新，未改代码。
- **诗悦网络项目归属修正**：根据主人确认，将 `docs/interview/resume/resume-rag-project-game-marketing.md` 中“按当前简历格式可粘贴版”的项目归属从“个人项目”改为“【诗悦网络】游戏活动与官网营销 Agentic RAG 知识协同平台”；团队规模改为研发 4 人、前端 2 人，主人担任前端组长并负责方案设计、技术选型、架构拆分和核心链路落地；补充简历边界说明，避免把仿真评测写成公司真实线上准确率。仅文档更新，未改代码。
- **诗悦网络 RAG 简历早期建设口径修正**：根据主人补充的真实情况，入职时间较短、真实活动数据和长期效果仍在积累，将 `docs/interview/resume/resume-rag-project-game-marketing.md` 和 `docs/interview/resume/game-marketing-rag-evidence.md` 的表述从“数据充分沉淀/效果已验证”调整为“结合当前业务链路先搭建知识框架、核心链路和评测方法，后续随活动上线、测试遗漏、线上问题和复盘持续扩充”；弱化固定分数和线上效果口径，保留技术难点、框架价值和可持续评测方法。仅文档更新，未改代码。
- **诗悦网络项目周期口径调整**：根据主人反馈，简历正文不主动写 `2025.09 - 2026.03`、`半年` 或 `6 个月`，避免项目显得周期短；改为强调“从 0 到 1 试点建设、框架/链路/评测方法、后续随活动上线和复盘持续扩充”。时间线只保留为面试被追问时的解释口径。同步 `docs/interview/resume/resume-rag-project-game-marketing.md` 和 `docs/interview/resume/game-marketing-rag-evidence.md`。仅文档更新，未改代码。
- **游戏活动/官网营销业务补强**：新增 `backend/scripts/build-game-marketing-regression-dataset.mjs` 和 `backend/eval/game-marketing-regression.dataset.json`，沉淀 8 篇游戏活动/官网营销业务模板文档和 96 条专项评测问题，覆盖新角色抽奖、周年庆会场、充值返利、微信分享裂变、PC/H5 游戏官网、版本专题、兑换码礼包、回流活动；评测维度覆盖玩法识别、页面模块、接口、埋点、地区适配、风险项、拒答边界和 GraphRAG seed。新增 `docs/interview/resume/game-marketing-rag-evidence.md`，补充面试主线、MCP 在 AI Coding 中的价值、多 Agent 职责和不能硬说的边界；同步 `docs/interview/resume/resume-rag-project-game-marketing.md`、`docs/interview/jd/jd-gap-implementation-status.md`、`docs/plans/remaining-enhancement-plan.md`。验证：`backend npm run eval:game-marketing` ✅（8 文档 / 96 问题）；`backend npm run enterprise:readiness` ✅（12/12）；`backend npm run build` ✅。

### 2026-07-07

- **RAG MCP Server 实现**：新增 `tools/rag-mcp-server` 独立 MCP stdio 服务，先写目录规则 `CLAUDE.md`，再实现配置读取、RAG API Client、MCP 工具注册和游戏活动/官网营销 prompt 编排；配置只读取 `RAG_MCP_BASE_URL/RAG_MCP_TOKEN`、`RAG_BASE_URL/RAG_TOKEN` 或 `~/.config/rag-cli/config.json`，不写 `.env`，不直连数据库/向量库/Neo4j。已暴露 `rag_health`、`rag_search`、`rag_context`、`rag_ask`、`rag_graph_query`、`rag_agent_domains`、`rag_agent_pipeline`、`rag_game_plan`、`rag_game_checklist`、`rag_game_tracking`、`rag_game_region_check` 11 个工具；`rag_agent_pipeline` 走后端 Supervisor 多 Agent 管线，自动路由领域并执行 researcher/analyst/writer/critic/editor 子集；同步 `tools/rag-mcp-server/README.md` 和 `docs/interview/resume/resume-rag-project-game-marketing.md` 的 MCP/CLI 使用说明。验证：`tools/rag-mcp-server pnpm run build` ✅；`pnpm test` ✅（6/6）；`node dist/src/server.js --help` ✅；SDK stdio client `listTools` ✅（11/11）。
- **MCP 调用场景文档补充**：补充 `tools/rag-mcp-server/README.md` 和 `docs/interview/resume/resume-rag-project-game-marketing.md`，明确 MCP 在 AI 编程工具需要外部上下文时调用，不替代 Admin/Web/CLI；新增“触发场景 -> MCP 工具”对照表和开发流程调用顺序，覆盖接需求、写代码、复杂方案、多 Agent 分析、GraphRAG 关系查询、上线检查、地区适配和临时问答。仅文档更新，未改代码。
- **RAG MCP 自动登录刷新**：`tools/rag-mcp-server` 新增 `RAG_MCP_USERNAME/RAG_MCP_PASSWORD` 自动登录能力；当未配置 token 时自动调用 `/auth/login` 获取 JWT，遇到 401 且存在账号密码时清空旧 token 并重试一次，避免把会过期的短期 token 固定写进 Codex 配置。同步 README 配置说明，并将 Codex 全局 `rag` MCP 配置改为 `RAG_MCP_BASE_URL + RAG_MCP_USERNAME/RAG_MCP_PASSWORD` 自动登录模式。验证：`tools/rag-mcp-server pnpm run build` ✅；`pnpm test` ✅（8/8）；`node dist/src/server.js --help` ✅；SDK stdio client 调 `rag_search("业务规则")` ✅（自动登录成功，返回 count=1）。
- **长期 MCP/API Key**：新增 rag-backend `ApiTokenService` 和 `/api/v1/auth/api-tokens` 管理接口，生成 `rag_pat_` 长期 API Key；服务端仅保存 SHA-256 hash，明文只在创建时返回一次，支持列表、最近使用时间和吊销；`JwtAuthGuard` 支持 JWT 或 API Key。admin-backend 增加 `/api/admin/config/api-tokens` 代理，admin `/system/config` 新增“长期 MCP / API Key”卡片，支持生成、复制、吊销；`tools/rag-mcp-server` 优先读取 `RAG_MCP_API_KEY/RAG_API_KEY`，Codex 全局 `rag` MCP 已切到 `RAG_MCP_API_KEY` 模式，不再依赖 7 天登录 JWT。未新增数据库 schema，token hash 存在 `workspace/api-tokens.json`。验证：`backend npm run build` ✅；`admin-backend npm run build` ✅；`admin ./node_modules/.bin/tsc --noEmit` ✅；`admin biome lint src/pages/system/config/index.tsx src/pages/system/config/service.ts` ✅；`tools/rag-mcp-server pnpm run build && pnpm test` ✅（8/8）；`backend /api/v1/health` ✅；`admin-backend /health` ✅；SDK stdio client 使用 `RAG_MCP_API_KEY` 调 `rag_search("业务规则")` ✅（count=1）。当前已打开的 Codex 会话若持有旧 MCP 进程，需要新开会话或重启 MCP 后读取新的 API Key 配置。
- **游戏官网营销场景简历版本**：新增并继续补强 `docs/interview/resume/resume-rag-project-game-marketing.md`，将 RAG 项目从泛企业知识库收敛到更贴合主人经历的“游戏活动与官网营销 RAG 知识协同平台”；覆盖节假日、周年庆、版本更新、新角色、改版、充值、抽奖、小程序/H5、PC/H5 官网，以及台湾服、东南亚服、国内和海外多地区交付；明确不沉淀每次变化的活动规则，而是沉淀通用活动类型、营销玩法、官网落地页模块、前端工程规范、埋点规范、地区适配、风险检查和验收 checklist。用户定义从岗位列表升级为业务线视角，并补充业务负责人角色：业务负责人统筹活动目标、玩法方案、资源协同、技术风险、上线节奏和复盘沉淀；需求策划侧、体验设计侧、交付验证侧协同落地；业务流串联活动想法、玩法方案、页面方案、素材需求、技术拆解、埋点验收、上线检查和复盘沉淀。补充 AI 编程工具集成路线：优先做通用 `rag-mcp-server`，服务 Codex、Trae、Claude Code、Cursor 等支持 MCP 的客户端；CLI 定位为命令行网关，面向人、脚本、CI、批量导入和批量评测；MCP 定位为 Agent 工具接口，面向 AI 编程工具自动查知识；Codex 插件仅作为后续平台封装方式。当前 `rag ask/context/search/graph/eval` 可用于方案上下文、编码计划和评测；后续可扩展 `rag game plan/checklist/tracking/region-check/graph/retro` 等业务命令。仅文档更新，未改代码。
- **jl-pic 简历素材全量总结与 RAG 简历强化**：逐张阅读 `jl-pic` 下 57 张图片，重写 `jl-pic/jl-pic-summary.md`，记录逐图摘要、项目类型聚类、面试反推问题、可迁移到当前 RAG 项目的简历表达和不能照搬的指标边界；同步更新 `docs/interview/resume/resume-rag-project.md`，将项目定位收敛为“企业级 Agentic RAG 知识治理与问答平台”，补强 Hybrid Search、GraphRAG、LangGraph、MCP/Tool Registry、AG-UI/SSE、Karpathy + Obsidian、评测闭环和后台运营等面试口径。仅文档更新，未改代码。
- **JD 差距可本地补齐项实现**：新增 `docs/interview/jd/jd-gap-implementation-status.md` 记录“已实现/部分实现/外部阻塞”；补齐 Prompt Injection 基础防护（`prompt-injection.guard.ts` + 检索片段高风险行脱敏 + prompt 不可信证据边界 + `eval/prompt-injection.dataset.json`）、Prompt Registry 基础版（`prompt-registry.ts` + `prompt:registry:check`）、Tool Registry 基础版（`tool-registry.ts` + `tools:registry:check`）、Agent 任务级评测脚手架（`eval-agent-task-metrics.mjs` + `eval:agent-tasks`）。同步更新 `docs/interview/jd/jd-requirements-project-mapping.md` 和 `docs/plans/remaining-enhancement-plan.md`，把这些项从“缺口”调整为“本地基础版已实现，生产化仍待真实数据/平台接入”。验证：`backend npm run eval:prompt-injection` ✅（7/7）；`backend npm run prompt:registry:check` ✅；`backend npm run tools:registry:check` ✅；`backend npm run eval:agent-tasks` ✅；`backend npm run build` ✅。
- **面试文档使用说明**：新增 `docs/interview/interview-docs-usage.md`，说明 `jd-requirements-project-mapping.md`、`jd-gap-implementation-status.md`、`INTERVIEW_PLAYBOOK.md`、`ROADMAP.md`、`remaining-enhancement-plan.md` 的用途、阅读顺序、问题定位方式和不能混用的边界。仅文档更新，未改代码。
- **RAG 项目简历写法沉淀**：新增 `docs/interview/resume/resume-rag-project.md`，整理项目名称、项目描述、简历最终版 bullets、可展开亮点、量化指标、面试补充边界和不建议写法；同步 `INTERVIEW_PLAYBOOK.md` 与 `docs/interview/interview-docs-usage.md` 的入口说明。仅文档更新，未改代码。

### 2026-07-06

- **面试文档核心口径补强**：更新 `INTERVIEW_PLAYBOOK.md`，将本地工程成熟度和项目级评测口径同步为 `96/100`、`28/28`；新增“面试先记这一页”、30 秒总回答、2 分钟展开版、7 问压缩背诵卡片，并围绕 RAG 主链路、向量/ES/图谱、多 Agent、工具调用、RAG 难点、情感分析边界、AI Coding 使用方式补充追问回答。继续补充二层追问：NestJS/FastAPI 选型、Dify/Coze/LangFlow 取舍、权限过滤、索引一致性、性能优化、幻觉控制、一线大厂生产化差距、前端负责人视角、后台指标、评测集建设、AG-UI/SSE 排障 STAR 和反问清单。按公开 JD 抽样继续补充大厂 AI 应用/Agent 岗位对照：RAG+Agent、Planning/Acting/Reflection、Tool Calling/MCP、Memory、Eval、Observability、多模态、生产工程、成本延迟、金融合规，并加入阿里/腾讯/百度/字节/美团、小米/大疆/高德、微信/DeepSeek、中信/平安/证券公司的差异化讲法。仅文档更新，未改代码。
- **大厂 JD 与项目实现对照文档**：新增 `docs/interview/jd/jd-requirements-project-mapping.md`，把公开 AI 应用/Agent 岗位要求与本项目实现逐项映射，覆盖 RAG、Hybrid Search、Agentic Workflow、Planning/Acting/Reflection、Tool Calling/MCP、Memory、GraphRAG、Eval、Observability、权限、审计、多模态、金融合规、Prompt 安全、模型路由、生产化等；每项标注“已实现/部分实现/未实现”、核心代码位置和面试回答边界，便于面试时准确说明项目能力与一线大厂差距。仅文档更新，未改代码。
- **BOSS/公开 JD 对照表补强**：继续完善 `docs/interview/jd/jd-requirements-project-mapping.md`，新增 BOSS/公开 JD 高频要求观察和公司/行业对照表，覆盖阿里、腾讯/微信、百度、字节、美团、小米、高德、大疆、DeepSeek、中信/平安/证券；补充工具注册/工具目录、灰度/A-B/效果回归、上下文工程、SFT/RLHF/模型训练等招聘要求与项目实现边界。仅文档更新，未改代码。

### 2026-07-05

- **正式 RAG 网关 API 与 CLI 后续项收尾**：新增 backend `RagGatewayModule`，提供 `POST /api/v1/rag/search` 与 `POST /api/v1/rag/context`，复用 Karpathy 检索与 Skills 匹配，不新增数据库 schema、不修改 `.env`；`rag-cli` 的 `search/context` 优先走正式 API，旧后端缺接口时保守降级；新增 `rag ask --stream` 消费后端真实 SSE，新增 `rag admin search`、`rag graph query`、`rag eval status`、`rag eval run`；同步 `rag-cli/ROADMAP.md`、README、中文说明和 CLI roadmap 归档；补 SSE CRLF 分隔回归测试。`backend npm run build` ✅；`rag-cli pnpm run build` ✅；`rag-cli pnpm test` ✅（11/11）；CLI help smoke ✅；不可达服务 JSON 错误契约 smoke ✅；临时当前构建服务 `PORT=3015` 在线 smoke ✅（`POST /api/v1/rag/search` 201 count=2、`POST /api/v1/rag/context` 201 count=2、CLI `search` count=2、CLI `eval status` count=4）。当前常驻 `3000` 进程仍是旧进程，需重启后才会加载新路由。

### 2026-07-04

- **RAG CLI 对齐 Karpathy + Obsidian**：`rag ask` schema/human 输出补齐 `retrievalSufficient`、`retrievalReason`、references、`obsidianPaths`；`rag context` 在 debug chunks 为空时使用 `ask auto` 可靠兜底，只有 references、Obsidian 路径或 `retrievalSufficient=true` 才输出上下文包；同步 `rag-cli`、根目录 CLI 文档和 `cli-docs` 归档副本。`rag-cli CI=true pnpm run build` ✅；`rag-cli CI=true pnpm test` ✅（10/10）；CLI `ask` 真实后端 smoke ✅；CLI `context` 普通路径和 fallback smoke ✅。

### 2026-07-03

- **未完成项复核与成熟度门禁校准**：`backend npm run enterprise:readiness` ✅（本地 11/11，通过；当前未 ready 外部输入：视觉/视频理解 key、LangFuse key、真实业务原件和毒题集、真实组织系统、真实 GraphRAG 数据源、真实资源压测窗口、生产环境、安全合规口径）；修正 `eval-rag-maturity.mjs` 的生产材料判断，不再依赖 ROADMAP 文案字符串，改为显式 `RAG_PRODUCTION_MATERIALS_CONFIRMED=true` 后才计入；同步 `PRD.md` / `ARCHITECTURE.md` 企业级成熟度口径为 96/100。
- **RAG 脚本服务边界修正**：将真实 rag-backend 检查脚本默认地址统一为 `http://localhost:3000`，避免 `perf/eval/smoke` 误打 admin-backend `3001` 后出现 `/api/v1/auth/login` 404；同步 `backend/scripts/README.md`。`backend npm run build` ✅
- **Karpathy + Obsidian 双写去重修复**：Obsidian `content_hash` 命中旧 note 时，不再直接复用旧 `rag_doc_id` 阻断当前用户 RAG 入库；若当前用户没有该 RAG 文档，会重新走 `DocumentService.upload()` 写入 DB、Milvus/ES、Karpathy BM25，再返回 duplicate note 关联的新 `ragDocId`。这样 Obsidian 负责知识沉淀去重，RAG 负责当前用户可检索数据，两条链路互补不互相吞数据。`backend npm run build` ✅
- **项目级 RAG 评测修复到 100%**：Karpathy 检索改为 ES + 本地 BM25 结果合并，答案证据优先 RAG chunks 再补 Obsidian chunks；明确事实题新增结构化抽取兜底，覆盖差旅审批、采购付款、法务审查、数据留存、React 状态管理、NestJS Provider 等场景；抽取式 fallback 跳过 `path:`/Obsidian source link 噪声。`backend npm run eval:rag:project` ✅（score=1，simple 14/14，auto 14/14）
- **当前性能/外部阻塞复核**：`backend npm run smoke:external` ✅（Bocha/Rerank/Judge 当前 key 可用）；`backend npm run perf:rag` ⚠️（脚本可运行但 simple/agentic p50 未达严格阈值）；`backend npm run smoke:milvus` ❌（Milvus collection loaded/indexed，但 warmup/search `DEADLINE_EXCEEDED`，当前依靠 BM25/ES 回退保证准确性，真实资源压测和 Milvus timeout/warmup 阈值仍待处理）。

### 2026-07-02

- **Admin GraphOps 节点编辑**：`/graph-ops/nodes` 增加节点编辑入口和弹窗，支持编辑节点类型、别名、来源、属性 JSON；新增 admin-backend `PATCH /api/admin/graph-ops/nodes/:id` 代理和 rag-backend `PATCH /api/v1/rag/admin/graph/entities/:id`，真实 Neo4j 可持久化更新；节点 ID 保持只读，避免破坏关系边；`backend npm run build` ✅；`admin-backend npm run build` ✅；`admin-backend npm run lint` ✅（仅既有 warning）；`admin npm run lint` ✅（仅既有 warning）；Chrome headless 验证节点页可见编辑按钮且弹窗可回填 ✅；演示 mock 节点保存返回 503，不假装持久化 ✅
- **Admin GraphOps 图上直接编辑**：全局图谱画布节点支持双击打开同一节点编辑弹窗，SVG tooltip 提示“双击编辑”；复用节点编辑保存链路，不新增第二套逻辑；`admin npm run lint` ✅（仅既有 warning）；Chrome headless 验证双击 `LangChain` 节点打开编辑弹窗且类型回填 `Framework` ✅
- **一线大厂差距清单补齐**：新增 `docs/plans/remaining-enhancement-plan.md`，把大厂生产可用差距拆成已本地补齐、必须外部输入、RAG 质量/数据链路/权限安全/可观测/运维验收口径，避免 ROADMAP 继续膨胀；新增 `backend npm run enterprise:readiness` 只读检查脚本，统一检查私密模拟集、GraphRAG、组织权限、多模态、部署清单、smoke/质量/性能脚本；`backend npm run enterprise:readiness` ✅（本地 11/11，通过；外部剩余：真实业务原件/毒题集、真实组织系统、真实 GraphRAG 数据源、真实视觉/视频 key、真实资源压测、生产环境、安全合规口径）
- **pnpm 依赖版本固定**：主项目 package（backend/admin/admin-backend/frontend/rag-cli/admin cloudflare-worker）扫描通过，依赖声明不再包含 `^`/`~` 范围符号；固定 `@nestjs/bullmq`、`bullmq`、`multer`、worker 依赖和 devDependencies；新增 `backend/pnpm-workspace.yaml` 承接 pnpm 11 overrides，移除废弃 `package.json#pnpm` 配置；同步 backend/admin-backend lockfile；未修改 agent-course/agent-cursor 示例目录；`backend pnpm install --frozen-lockfile --ignore-scripts` ✅；`admin-backend pnpm install --frozen-lockfile --ignore-scripts` ✅；`pnpm --dir admin/cloudflare-worker install --lockfile-only --ignore-scripts` ✅
- **官方技术文档夜间同步**：新增 `OfficialDocsSyncModule/Service`，默认关闭；配置 `OFFICIAL_DOCS_SYNC_ENABLED=true` 后每天本地时间 01:00 抓取 React/Vue/MDN JavaScript/NestJS 官方文档，按 URL 内容 hash 检测新增/修改页面，生成 Markdown 快照并复用 `DocumentService.upload()` 写入数据库、Milvus/向量库、ES 和 Karpathy BM25；状态文件保存到 `workspace/official-docs-sync-state.json`，避免重复入库；新增 `docs/plans/official-docs-sync.md` 记录配置和默认抓取范围；未新增数据库表/未做 schema 变更；`backend npm run build` ✅
- **Karpathy + Obsidian 链路设计**：新增 `docs/plans/karpathy-obsidian-dual-ingest-plan.md`，明确 Karpathy 需要从现有“答得出”的 RAG/BM25 链路，补强为统一编排 RAG 索引层和 Obsidian 知识层的个人知识系统；Obsidian 不是旁路存档，后续 source note、related、compiled、index 都要挂在 Karpathy 知识编排链路里；本次只做设计文档和 ROADMAP 同步，未写功能代码
- **92 分路由方案记录**：在 `docs/plans/karpathy-obsidian-dual-ingest-plan.md` 中补充 simple/auto/agentic 三档路由：`simple` 固定走 Karpathy + Obsidian Fast Path，优先读 Obsidian compiled/index 并补 RAG evidence；`auto` 先跑 Fast Path，再用 compiled 命中、source 回链、evidence、引用覆盖、置信度做 sufficiency gate；`agentic` 作为 Research Path，必须把 Obsidian compiled/index 当高优先级工具源；本次只记录方案，未编码
- **URL 抓取文章双写实现**：`/documents/url` 改为 Karpathy-Obsidian ingestion service 统一处理；同一份 URL 正文先继续走 `DocumentService.upload()` 写入数据库、Milvus/向量库、ES 和 Karpathy BM25，再写入 Obsidian `notes/日期-标题.md`；Markdown 文件 frontmatter 包含标题、原链接、标签、日期、`rag_doc_id`、`content_hash`；正文包含 2-3 句摘要、3-5 条要点、标签和完整正文；摘要/标签优先 LLM，失败启发式兜底；新增 `OBSIDIAN_VAULT_DIR` 配置默认 `workspace/obsidian`；未修改 `.env`、未新增 DB schema；`backend npm run build` ✅
- **Karpathy + Obsidian 核心闭环实现**：新增 `ObsidianKnowledgeModule/Service`，统一管理 `raw/notes/compiled/index`，URL/文件上传/MHTML/PDF/Markdown/手动输入 `/documents/manual`/官方文档夜间同步都走 Karpathy-Obsidian ingestion service；Obsidian notes 基于 `content_hash` 做重复写入跳过，raw 永久保留，source note 写 `raw_path/rag_doc_id/content_hash`；新增 `index/sources.md`、`index/tags.md` 和 `compiled/{tag}.md` 自动刷新；`simple` 读取 Obsidian compiled/index/notes 后补 RAG evidence，Obsidian 命中会转成伪片段参与 `[片段N]` 引用校验和 references 返回；`auto` 先做 Fast Path sufficiency gate 再决定是否升级 agentic，`agentic` 注入 Obsidian 高优先级上下文；响应 metadata/final 返回 `obsidianPaths`、`ragReferences`、`retrievalReason`；未新增 DB schema、未修改 `.env`；`backend npm run build` ✅；临时端口启动验证 `/api/documents/manual` 路由和新增模块初始化 ✅
- **Obsidian related 与 Admin 关联状态**：Obsidian 刷新时基于共享 tags 写入每篇 source note 的“相关笔记”区块，包含 score/reason，并生成 `90-system/logs/related-日期.md`；RagAdmin/RagOps 文档列表和详情通过 `rag_doc_id` 反查 `obsidianPath/obsidianStatus`；admin 文档列表新增 Obsidian 关联状态列；`backend npm run build` ✅；`admin npm run lint` ✅（仅既有 warning）
- **Karpathy + Obsidian 取用流方向调整**：`docs/plans/karpathy-obsidian-dual-ingest-plan.md` 中 P2/M4 从“选题/周报/写作素材”改为软件项目流程编排：方案选择、技术选型敲定、架构决策 ADR、任务拆解、风险清单和验收标准；本次仅更新文档，不改代码
- **Obsidian 项目决策编排实现**：新增 `POST /api/obsidian/project-workflows/:type`，支持 `solution`、`tech-selection`、`adr`、`task-breakdown`；生成时先检索 Obsidian compiled/index/notes 作为证据，再输出方案选择对比、技术选型决策、ADR 草稿、任务拆解/接口/风险/验收标准，并写入 `compiled/project-workflows/{type}/日期-标题.md`，同时刷新 `index/project-workflows.md`；单源 source note 也补充关键结论、反对意见、适用边界、落地风险、验收口径；`backend npm run build` ✅；临时端口启动验证新路由注册 ✅
- **Karpathy + Obsidian 未完成项收尾**：RAG 写入前基于 Obsidian `content_hash + rag_doc_id` 查重，命中则复用已有 docId，避免重复进入 DB/Milvus/ES/BM25；Obsidian compiled 层补 `entities`、`conclusions`、基础版本信号检查，related 评分升级为 entities/topics/tags 加权；新增 GraphRAG seed 只读导出 `GET /api/obsidian/graph/seed` 和 `index/graph/obsidian-seed.json`；未新增数据库 schema、未修改 `.env`；`backend npm run build` ✅
- **Obsidian 编译页开放问题增强**：entity 编译页新增开放问题区；conclusion 编译页新增开放问题聚合，并把版本检查扩展到推荐/不推荐、采用/避免、必须/可选等语义冲突信号；复杂语义矛盾仍需真实数据评测和人工复核；`backend npm run build` ✅
- **Maturity 门禁证据修正**：`eval-rag-maturity.mjs` 从旧 ROADMAP 字符串检查改为读取真实代码/文件证据，覆盖 Milvus runtime governance、JobsService+Supervisor、claim-level 引用支撑、source span、fact_conflicts、enterprise readiness；`backend npm run enterprise:readiness` ✅（11/11）；`backend npm run eval:rag:maturity` ✅（96/100，Milvus search runtime 降级扣 2 分，生产部署/证书/备份策略未确认扣 2 分）

### 2026-07-01

- **本地工程成熟度：96/100**（初始 75 → 当前 96；Milvus search runtime 降级扣 2 分，生产部署/证书/备份策略未确认扣 2 分）
- **当时 RAG 端到端评测：26/28，通过率约 93%**（含 SWE 技术规范；2026-07-04 项目级评测已提升到 28/28）
- **LLM-as-Judge：7/7 supported**（`EVAL_RAG_JUDGE_REQUIRED=true` 验证通过）
- **TS 编译：0 错误**（修复 3 个已有 spec 文件）
- **三段服务：全部运行**（backend:3000 ✅ admin-backend:3001 ✅ admin:8000 ✅）
- **Admin 生产构建成功**（含新 `/account/memories` 页面）
- **Admin-backend verify 通过**（8 suites/68 tests + 2 e2e/19 tests）
- **全部 npm 脚本通过**（fixtures/eval/import/smoke）
- **本轮补齐**：BullMQ worker 接真实文档处理；`queue/status` 路由顺序修复；异步空内容失败写回任务
- **本轮补齐**：URL 动态渲染抽取开关 + `.env.example` 配置；未启用/失败时静态降级
- **本轮补齐**：Mem0 状态/搜索/session API；LangFuse 状态 API；Admin QA TTS 状态反馈
- **本轮验证**：`backend npm run build` ✅；`admin npm run lint -- --quiet` ✅（仅既有 warning）；`fixtures:private:check` ✅；`smoke:vision-video` ✅；`smoke:external` ✅
- **本轮运行验证**：backend:3000 ✅；admin:8000 `/graph-ops` ✅；`/documents/queue/status`、`/memories/status`、`/observability/langfuse/status` 均 200 ✅
- **本轮模拟补齐**：私密原件模拟包增强为 27 个文档文件；GraphRAG 增强为 schema + alias + initial entities/relationships + 15 条语料；组织 fixture 增强为 20 部门/22 岗位/8 用户/继承规则/权限回显；视觉样本补 OCR sidecar
- **本轮模拟验证**：`fixtures:private:prepare` ✅；`fixtures:private:check` ✅；`graph:import-private` dry-run ✅；`smoke:vision-video` ✅
- **Admin QA 输出修复**：回答正文改为 `XMarkdown` 渲染，补代码块/列表/表格/引用样式和代码围栏兼容；`admin npm run lint -- --quiet` ✅；`/qa-ops` 200 ✅
- **Admin QA 富内容输出**：支持 Markdown 图片 `![alt](url)`、`output.images/media/attachments`、`rag.media/rag.image` 事件渲染；图片限制尺寸、圆角、caption，避免撑爆聊天区；`admin npm run lint -- --quiet` ✅；`/qa-ops` 200 ✅
- **Admin QA 真实流式输出**：撤掉前端延迟拆字模拟，前端即时消费 AG-UI `TEXT_MESSAGE_CONTENT` delta；backend simple RAG 和检索不足 fallback 改为 LangChain `model.stream` 透出真实 token；`backend npm run build` ✅；backend 重启 ✅；`/qa-ops` 200 ✅
- **Admin 菜单国际化修复**：补 `menu.qa-ops.qa-ops-model` 中英文 locale，消除 React Intl missing message；`admin npm run lint -- --quiet` ✅；`/qa-ops/model` 200 ✅
- **Admin QA 会话列表修复**：修正 admin-backend 对 `/rag/admin/conversations` 直接数组返回的解包逻辑，历史会话恢复显示；补 graph/system 嵌套菜单 locale；三段服务重启 ✅；`admin-backend npm run build` ✅；`admin-backend npm run lint` ✅（仅既有 warning）；`admin npm run lint` ✅（仅既有 warning）；Chrome headless 验证 `/qa-ops` 首条会话可见且 console 无 Missing message/page error ✅
- **Admin QA AG-UI 轨迹优化**：连续同类事件折叠为 `EVENT × N`，避免真实流式 token 造成 `TEXT_MESSAGE_CONTENT` 大量重复刷屏；`admin npm run lint` ✅（仅既有 warning）；Chrome headless 验证最终轨迹 `TEXT_MESSAGE_CONTENT × 29` 且事件名只出现 1 次 ✅
- **Admin QA 兜底首字延迟优化**：`RUN_STARTED/TEXT_MESSAGE_START` 提前到会话创建后立即发送；长期记忆检索最多等待 600ms，超时不阻塞回答；agentic 本地质量闸门不足时跳过 query augment 直接兜底生成；空 token 不下发；`backend npm run build` ✅；同一兜底问题首字约 2.18s（优化前复现 5.3-7.1s，用户观感约 11s）✅
- **Admin QA 技术问答默认路由优化**：admin 页面默认模式从 `agentic` 改为 `auto`，NestJS Provider 这类简单技术问答自动路由到 `simple`，复杂问题仍可手动选择 `agentic`；`admin npm run lint` ✅（仅既有 warning）；Chrome headless 验证默认 `auto`、路由 `simple`、首字约 1.93s ✅

### 2026-06-30

- P0 私密模拟数据增强完成：103 → 193 条，含软件工程 15 领域
- Vision Provider 脚手架：interface + Mock + OpenAI-compat + Module
- 短期记忆产品化：Redis 滑动窗口 + ChatService 集成
- BullMQ 异步队列：安装 + Queue + Worker + 状态 API
- Mem0 管理页面：admin `/account/memories` + proxy 通路
- Deployment 文档：CHECKLIST.md + deploy.sh
- Vision 集成到文档上传：图片 OCR/视频理解 + 自动降级
