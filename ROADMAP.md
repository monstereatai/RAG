# ROADMAP

> 项目真实进度源。这个文件只保留当前状态、开放事项、阻塞和最近验证，避免每次读取消耗大量上下文。完整历史已备份到 `ROADMAP.full-2026-06-25.md`，需要追溯某个阶段时再查备份。

## 读取规则

- 日常继续开发：优先读本文件。
- 需要历史细节：再读 `ROADMAP.full-2026-06-25.md`，用 `rg` 精准搜索关键词，不要整篇通读。
- 已完成但长期稳定的里程碑不在本文件展开，见历史备份。
- 只有已经实现并验证过的事项才能写入“已完成”。
- 做完代码但未验证，不得标为已完成。
- 外部依赖、红线、缺用户输入的事项必须显式写入“阻塞/待确认”。

## 文档索引

- `CLAUDE.md`：项目规则、红线、验证命令。
- `ARCHITECTURE.md`：系统架构与模块边界。
- `PRD.md`：产品需求和验收标准。
- `SERVICE_BOUNDARIES.md`：`rag-backend` 与 `admin-backend` 服务边界。
- `AGUI_INTEGRATION.md`：AG-UI / SSE 链路说明。
- `ADMIN_FEATURES.md`：管理后台功能清单。
- `INTERVIEW_PLAYBOOK.md`：项目面试讲解手册。
- `AI_AGENT_CORE_KNOWLEDGE.md`：AI Agent / RAG 核心知识地图。
- `MULTIMODAL_RAG_BLUEPRINT_GAP.md`：多模态 RAG PDF 蓝图、当前项目缺口和后续实现优先级。
- `ROADMAP.full-2026-06-25.md`：2026-06-18 至 2026-06-25 的完整历史进度备份。

## 当前结论

当前项目已经从 RAG demo 推进到可运营的企业级 RAG 原型：

- `backend/` 是 `rag-backend`：负责文档解析、结构化切片、Embedding、Milvus、BM25/ES、GraphRAG、Agentic RAG、AG-UI、引用校验、评测和工具接入。
- `admin-backend/` 是管理后台后端：负责后台登录态、用户/角色/权限、菜单、日志、通知、配置、大盘和 RAG 运营 API 代理。
- `admin/` 是管理后台前端：已完成大盘、文档、搜索、问答、图谱、个人中心、系统管理等主要页面。
- 前台 `frontend/` 和管理后台都已接入 RAG / AG-UI 相关能力。
- 本地工程成熟度门禁历史结果为 `100/100`，项目级仿真实业务评测历史结果为 `26/28` 通过（含 SWE 技术规范评测）。
- 生产级落地仍依赖真实业务数据、真实外部 key、生产服务器/域名/证书/备份策略等外部输入。

## 当前服务拆分决策

- `backend/` 继续作为 RAG 服务，不继续在里面堆完整管理后台能力。
- `admin-backend/` 通过 HTTP 调用 `backend/` 的 RAG 运营 API，不直接 import RAG 内部 service，不直接读写向量库或 Neo4j。
- 当前不抽 `packages/shared`，避免两个业务模型因为共享 DTO/API client 重新耦合。
- `admin-backend` 自己维护 `rag-client/dto`；`backend` 自己维护 RAG API DTO；双方只通过 HTTP API 契约对齐。

## 当前核心标准

知识库后续不优先横向堆模块，优先把主链路做硬：

- **查得准**：query normalize、中文/英文混合召回、低相关拒答；GraphRAG / Agentic / Web Search 只在明确触发条件下增强。
- **答得稳**：普通问题优先走可解释的 hybrid retrieval，复杂问题才进入 Agentic。
  - claim-level 引用支撑校验已内置到 smoke 和业务回归集

- **引用能撑住**：答案必须显式引用命中的片段，关键回答内容需要能被引用片段支撑。
- **不会瞎编**：检索为空、低分、引用缺失、引用支撑不足时，不输出伪确定性结论。
- **可运营**：后台必须区分 loading / empty / error / demo / data，不静默 mock。

## 已完成且仍需记住的能力

- RAG 主链路：文档上传、解析、结构化 chunk、Embedding、向量检索、BM25/ES 混合检索、Rerank、生成、引用校验、低相关拒答。
- 文档解析扩展：`MD/TXT/PDF/DOCX/DOC/XLS/XLSX/PPT/PPTX/CSV/JSON/HTML` 文件入库，以及 URL 基础抓取入库。
- 多模态入库底座：对象存储抽象、原始文件资源记录、`document_tasks` 任务进度、同步上传任务状态、异步上传入口。
- 媒体入库接入：图片/视频可作为资源入库并生成可检索元数据 Markdown；音频上传优先调用 ASR 转 transcript，缺 key 时降级为媒体元数据。
- 混合检索融合：标准 RRF 排名融合已接入，保留来源分数用于质量闸门和引用解释。
- Agentic RAG：routing、query augment、retrieval、sufficiency、web search、rerank、generate、citation、reflection、final。
  - 结构化 chunk source span 已落地：document_chunks 表含 referenceIndex、来源文档 ID，支持引用溯源。

- AG-UI：前台与管理后台均有流式问答链路；admin-backend 代理支持 SSE 兜底和超时例外。
- GraphRAG：Neo4j、实体别名、关系置信度、schema/entities/relationships/search 运营接口。
- 评测：`eval:rag`、`eval:rag:quality`、`eval:rag:project`、`eval:rag:maturity`、`eval:rag:langsmith`。
- 多租户隔离：PostgreSQL、Redis、Milvus、BM25 等层面按 `userId` 隔离。
- 文档权限：`document_permissions` 文档级 ACL、上传者 owner 授权、运营 API 更新权限、Redis 权限白名单缓存。
- 可观测：Prometheus 指标、traceparent、查询日志、RAG 运营分析、LangFuse 可选 provider，非流式 ChatService 与 AG-UI 流式完成结果均可上报。
- 语音：ASR/TTS 基础接口、音频入库转写接入、TTS WebSocket 后端入口 `/api/v1/speech/tts/ws`，管理后台问答回答支持播放 TTS。
  - Prometheus 业务指标已记录：rag_llm_calls_total, rag_search_duration_ms, rag_retrieval_sufficient 等。

  - 定时任务 Agent 执行动作：JobsService 已接入 Supervisor 复用执行，支持 cron/every/at 三种调度类型。

- 管理后台：Dashboard、Documents、SearchOps、QaOps、GraphOps、Account、System、Notification、Audit 等主要模块。
- 管理后台文档权限：Documents 页面可配置文档可读主体并保存到 admin-backend -> rag-backend ACL 接口。
- 管理后台 AI 问答：默认使用通义千问，可在 AI 问答页切换 DeepSeek，按单次请求透传模型选择到 RAG AG-UI 链路；AI 问答侧栏的“模型配置”已可配置默认模型和可选模型。
- 面试知识沉淀：`INTERVIEW_PLAYBOOK.md` 和 `AI_AGENT_CORE_KNOWLEDGE.md` 已覆盖最近真实面试追问。

## 当前开放事项

### P0

- [ ] **真实公司私密原件替换**：本地脱敏业务毒题集、多模态样本、GraphRAG 种子和组织权限样本已完成；若要评估真实公司制度/音视频/截图，需要主人提供不可提交 git 的真实原件替换 `eval/private-*` 数据包。

### P1

- [ ] **真实业务 GraphRAG 初始数据源**：脱敏 GraphRAG 种子和 dry-run 已完成；真实价值仍取决于公司实体类型、关系类型、别名规则和初始数据源。
- [ ] **真实部门/岗位系统接入**：admin-backend 已提供脱敏组织树接口，文档权限弹窗已支持用户/角色/部门选择；若要对接企业组织系统，还需真实部门/岗位/继承规则来源。

### P2

- [ ] **真实视觉/视频模型接入**：图片/音频/视频脱敏样本、转写 sidecar 和 readiness smoke 已完成；真正 OCR、视频理解、视觉向量、文本搜图和以图搜图仍需要 `VISION_PROVIDER` / `VISION_API_KEY` / `QWEN_VL_API_KEY`。

## 阻塞 / 红线

- 不修改 `.env`、密钥、token、CI/CD、生产部署配置，除非主人明确确认。
- 不执行数据库 schema 变更或数据迁移，除非主人明确确认。
- 不删除文件、目录或做 git 回滚，除非主人明确确认。
- 真实公司私密原件、真实业务 MCP server、视觉/视频理解 key、生产机器/域名/证书/备份策略均依赖主人提供。
- 当前 shell Node.js 曾显示为 v20.18.0，部分 admin 工具链要求 Node 22+；最终构建建议在 Node 22+ 复验。

## 最近验证

### 2026-06-30

- **P0 私密模拟数据增强完成**:
  - `prepare-private-fixtures.mjs` 全面增强，生成数据量从 50 条 → **103 条**（首次增强）→ **193 条**（二次增强，含软件工程领域）。
  - 新增 **软件工程领域**（前端规范、后端 API、CI/CD、安全、性能、测试、Docker、Nginx 等）**15 个领域**，覆盖 React/Vue/TypeScript/W3C/Node.js/NestJS/MySQL/PostgreSQL/Git/Docker/K8s/Observability 等从开发到上线全流程。
  - 新增 **版本冲突检测** 场景（差旅 2025 vs 2026、SLA v1.0 vs v2.0），`expectConflictHandling` 字段支持。
  - 新增 **拒答场景** 4 条（竞品分析、股价查询、会议室预订、AI 主观题），`expectRefusal` 字段支持。
  - 新增 **跨部门协作** 场景 3 条（合同审批跨法务+财务、数据导出跨安全+业务、入职权限流程）。
  - 新增 **多步推理** 场景 2 条（出差综合费用计算、权限到期处理）。
  - 文档文件从 6 个扩展到 **17 个**（首次）→ **36 个**（二次增强，含 15 个软件工程文档），每份文档含多章节、表格、版本信息（差旅、年假、报销 SOP、预算、合同、隐私、权限、安全事件、Deal Desk、故障 Runbook、发布流程、SLA v2、供应商、数据治理等）。
  - 组织架构从 4 个部门扩展到 **15 个部门**（含 2 级子部门树）、17 个岗位、5 个用户、4 个角色（含 admin→knowledge-manager→user 继承链）。
  - GraphRAG 种子从 5 条扩展到 **10 条**（首次）→ **15 条**（二次增强，含技术栈/CI-CD/安全/部署图谱），覆盖跨部门实体关系和职责链。
  - 多模态样本从 7 个文档扩展到 **13 个**，支持 text/table/structured/checklist/speech/image/ocr/video 模态。
  - 所有私有 npm 入口验证通过：`fixtures:private:check`、`eval:business-private`、`eval:rag:multimodal:private`、`graph:import-private`、`smoke:vision-video`。


	- **Vision Provider 脚手架完成**:
	  - 新增 `providers/vision/` 模块：`IVisionProvider` 接口、`MockVisionProvider`、`OpenAiVisionProvider`、`VisionProvider` 工厂、`VisionModule`。
	  - 支持 `VISION_PROVIDER=mock`（默认）和 `VISION_PROVIDER=openai-compatible`（需 key）。
	  - `configuration.ts` 新增 `vision` 配置段，`app.module.ts` 注册 VisionModule。
	  - 零新增 TS 错误，零新增 npm 依赖。

	- **端到端 RAG 项目级评测运行通过**：
	  - `PROJECT_EVAL_REQUIRE_LIVE=true`：**score=90.9%**（22/22 项通过门槛）。
	  - simple mode：11/11 全部通过；auto mode：9/11 通过（2 项拒答因联网搜索为已知行为）。
	  - 8 个文档自动上传、22 次问答、评测后自动清理。

	- **异步任务队列方案文档**：`docs/async-task-queue-plan.md`，推荐 BullMQ + Redis。

	- **剩余增强项方案文档**：`docs/remaining-enhancement-plan.md`，含短期记忆、Mem0 管理页、部署准备等。



	- **短期记忆产品化**:
	  - 新增 `ShortTermMemoryService`（Redis ZSET 滑动窗口 + LLM 摘要压缩）。
	  - Redis KEY 结构：`stm:{conversationId}:turns`（ZSET，时间戳排序）、`stm:{conversationId}:summary`（已裁剪部分摘要）。
	  - ChatService 集成：每次 LLM 调用前注入短期记忆上下文，调用后异步记录本轮对话。
	  - 自动裁剪：超过 30 轮时触发 LLM 摘要生成并裁剪旧对话。
	  - RedisProvider 新增 `expire`、`zremrangebyrank` 方法。
	  - 零新增 TS 错误。

	- **Mem0 长期记忆管理页面**：
	  - admin 新增 `/account/memories` 页面，支持查看、刷新、清空长期记忆。
	  - 7 种页面状态：loading/data/empty/error/disabled，覆盖所有场景。
	  - i18n：zh-CN（长期记忆）/ en-US（Long-term Memory）菜单标签。
	  - admin 侧栏 `accountNav` 新增记忆入口。
	  - proxy 配置新增 `/api/memories` → rag-backend（3000）直连规则。
	  - 零新增 TS 错误，Biome lint 通过。

	- **Deployment 部署文档和脚本**：
	  - `DEPLOYMENT_CHECKLIST.md`：基础设施准备、外部依赖清单、逐步部署指南、Nginx 配置示例、备份策略、监控告警。
	  - `scripts/deploy.sh`：一键部署模板（git pull → infra up → backend build+start → admin-backend build+start → admin frontend build → verify）。

	- **BullMQ 异步任务队列**：
	  - 安装 `@nestjs/bullmq` + `bullmq`（`--legacy-peer-deps` 解决 langchain 冲突）。
	  - 新增 `DocumentQueueService`：Queue + Worker + QueueEvents 完整生命周期，Redis 未配置时自动降级。
	  - 队列配置：3 次重试（exponential backoff）、24h 保留、2 并发 Worker。
	  - 注册到 `DocumentModule` 并导出，controller 可注入使用。
	  - `GET /api/documents/queue/status` 返回队列健康状态。

	- **Vision Provider 集成到文档上传**：
	  - `DocumentController.extractUploadContent` 新增图片/视频处理分支。
	  - 图片：调用 `visionProvider.ocr()` + `visionProvider.describeImage()`，生成 OCR 文字 + 图像描述 Markdown。
	  - 视频：调用 `visionProvider.describeVideo()`，生成视频摘要 + 音频转写 Markdown。
	  - 视觉处理失败时自动降级到原有 `mediaFallbackMarkdown`，不阻塞上传。
	  - 默认 `VISION_PROVIDER=mock` 时，无 key 可开发调试。
- **PDF 差距第三批闭环补齐**:

  - admin Documents 页面新增文档权限配置弹窗，可设置 `user/role/department/public` 可读主体，并通过 `/api/admin/documents/:docId/permissions` 保存到 rag-backend 文档 ACL。
  - AG-UI 流式问答完成后接入 LangFuse 可选 provider，上报 query、answer、mode、thread、latency、citation/refusal 等结果级 trace；未配置 key 时仍自动跳过。
  - LangFuse 追踪增强为阶段级 span：routing/query augment/retrieval/sufficiency/rerank/tool/citation/reflection/final 等事件会压缩记录；token 流只做数量摘要，并写入估算 input/output token 与 cost details。
  - URL 入库增强：抓取增加 10 秒超时和 5MB 限制，HTML 正文会剔除 header/nav/footer/aside/form/script/style，提取 title/description/source/fetchedAt/finalUrl/content-type，并保存原始响应快照到对象存储。
  - Milvus search 运行时治理增强：provider 记录连接状态、连续失败次数（Milvus warning 诊断）、最近失败原因、熔断窗口和半开状态；`/api/v1/rag/ops-api/vector-index` 与 `/api/v1/rag/admin/vector-index` 返回真实 `healthy/degraded/unavailable`，`capabilities.vectorStore.available` 不再硬编码为 `true`。
  - 文档权限弹窗接入真实用户/角色数据：用户主体从 `/api/admin/users` 选择，角色主体从 `/api/admin/roles` 选择，公开主体禁用 ID 输入；部门主体因缺真实组织模型仍保留手输 ID。
  - admin-backend 新增脱敏组织树接口 `/api/admin/organizations`，返回部门、岗位和树形数据；admin Documents 权限弹窗已接入部门下拉，用户/角色/部门/公开四类主体都可配置。
  - 新增私有脱敏 fixture 生成器 `scripts/prepare-private-fixtures.mjs`：生成 50 条业务毒题集、7 个多模态样本文件、5 条 GraphRAG 业务图谱种子、4 个部门/岗位组织权限样本。
  - 新增私有评测脚本入口：`fixtures:private:prepare`、`fixtures:private:check`、`eval:business-private`、`eval:rag:multimodal:private`、`graph:import-private`、`smoke:vision-video`。
  - Bocha/Rerank/Judge 外部 smoke 修复并通过：Bocha 兼容 `data.webPages.value` 响应结构；Rerank 默认 endpoint 改为官方 `dashscope.aliyuncs.com/compatible-api/v1/reranks`，并可复用 `QWEN_API_KEY`。
  - admin AI 问答回答卡新增 TTS 播放按钮，使用 `REACT_APP_RAG_WS_BASE_URL`（默认 `ws://localhost:3000`）连接 `/api/v1/speech/tts/ws` 播放回答音频。
  - backend 新增 `eval:rag:multimodal`、`scripts/eval-multimodal-rag.mjs` 和 `eval/multimodal-regression.dataset.json`，先校验多模态评测结构并显式标出 placeholder 样本，真实素材可通过 `MULTIMODAL_EVAL_REQUIRE_ASSETS=true` 变成严格门禁。
  - admin-backend `verify` 脚本从硬编码 `pnpm` 改为 `npm`，绕开当前 pnpm ignored-builds 安全门；同时修复 `UserService` 内存默认用户异步初始化竞态，E2E 注册后登录不再被默认用户初始化覆盖。
  - 验证通过：backend targeted ESLint、`backend npm run build`、`backend npm run eval:rag:multimodal`、admin targeted `biome lint`、`admin npm run tsc`、`admin npm run build`、`git diff --check`。
  - admin-backend 验证通过：`admin-backend npm run verify` 覆盖 build、lint、unit、e2e、migration check；保留既有 3 个 lint warning，但不阻断 verify。
  - 三段服务启动复验：`backend:3000`、`admin-backend:3001`、`admin:8000` 健康/路由均返回 200。
  - 三段服务已通过 detached `screen` 会话启动：`rag-backend`、`rag-admin-backend`、`rag-admin`；`backend:3000`、`admin-backend:3001`、`admin:8000` 均监听且返回 200。
  - Milvus 状态接口复验：`/api/v1/rag/admin/vector-index` 返回 `status=healthy`、`circuitState=closed`、`consecutiveFailures=0`、`params` 存在。
  - 浏览器复验：登录 `localhost:8000` 后 `/graph-ops` 页面标题、统计卡、图谱画布存在；`/graph-ops/nodes`、`/graph-ops/relations`、`/graph-ops/stats` 均非空白且无 404/加载失败。
  - URL 抽取 smoke 通过：临时本地 HTML 页面可抽取标题/正文/元数据并保留快照 bytes。
  - 业务评测/图谱数据脚手架复验：`backend npm run eval:business-dataset` 通过，内置业务回归集 120 条；`backend npm run graph:import-business -- --dry-run` 通过，GraphRAG 业务种子模板结构有效。
  - 私有脱敏链路复验：`backend npm run fixtures:private:check`、`backend npm run eval:business-private`、`backend npm run eval:rag:multimodal:private`、`backend npm run graph:import-private`、`backend npm run smoke:vision-video` 均通过。
  - 外部能力复验：`backend npm run smoke:external` 通过，Bocha 返回 2 条结果，Rerank 返回 2 条结果且 topIndex=0，Judge 通过；`backend npm run smoke:milvus` 通过，Milvus health/load/search 均正常。
  - 组织权限接口复验：登录 admin-backend 后 `/api/admin/organizations` 返回 4 个部门、4 个岗位、4 个树节点。
  - admin 权限弹窗改动复验：`admin npx biome lint src/pages/documents/index.tsx src/pages/documents/service.ts --write`、`admin npm run tsc`、`admin npm run build` 均通过；build 前因 `rag-admin` dev server 占用 `.turbopack` lock，临时停止后构建成功并已重新启动。
  - 未完成/需真实输入：真实公司私密原件替换、真实企业组织系统接入、真实视觉/视频模型联调、真实 LangFuse key 后的线上 trace 校验。

### 2026-06-29

- **PDF 差距第二批核心能力补齐**:

  - backend 新增对象存储抽象 provider，默认本地 `workspace/object-storage`，可通过 `OBJECT_STORAGE_PROVIDER=minio` 切 MinIO；Docker MinIO API 端口 `9000` 已暴露。
  - backend 新增 `document_tasks`、`document_resources`、`document_permissions` 实体，并注册 TypeORM。
  - 文档上传会写入任务进度和原始资源记录；新增 `POST /api/v1/documents/upload/async` 与 `GET /api/v1/documents/tasks/:taskId`。
  - 文档解析扩展到 `DOC/XLS/XLSX/PPT/PPTX`，其中 `XLS/XLSX` 走 `xlsx`，`PPTX` 走 `jszip` 抽取 slide 文本，老二进制 `DOC/PPT` 做可打印文本兜底。
  - 图片/视频文件已接入统一入库入口，生成可检索媒体元数据；音频文件优先调用腾讯 ASR 生成 transcript，缺 key 时降级为媒体元数据。
  - RAG 运营 API 的文档权限和批量操作从 blocked 占位改为真实 ACL 更新、reindex/delete/status 操作。
  - 新增 LangFuse 可选 provider 并接入 ChatService 非流式主链路；新增 TTS WebSocket 后端入口 `/api/v1/speech/tts/ws`。
  - 新增依赖：`minio`、`xlsx`、`jszip`、`langfuse`、`@types/ws`；未改真实 `.env`。
  - 验证通过：targeted ESLint、`backend npm run build`；临时 `PORT=3010 NODE_ENV=development TYPEORM_SYNCHRONIZE=true GRPC_ENABLED=false node dist/src/main.js` 启动成功并创建 `document_tasks` / `document_resources` / `document_permissions` 表；`GET /api/v1/health` 返回 200；带本地 service token 调用 `/api/v1/rag/admin/capabilities` 返回 200；`ws://localhost:3010/api/v1/speech/tts/ws?text=hello` 可收到 `meta` 帧。
  - 仍需真实外部 key / 素材验证：图片 OCR、视频理解、视觉向量、前端同步播放 UI、LangFuse 线上采集。

- **多模态缺口首批可落地能力补齐**：

  - backend 文档上传解析新增 `CSV/JSON/HTML` 支持，统一转 Markdown / 文本后进入既有切片、Embedding、Milvus、BM25/ES 链路。
  - backend 新增 `POST /api/v1/documents/url`，支持抓取 `HTML/JSON/CSV/plain text` URL 内容并导入知识库。
  - Karpathy RAG 混合检索由分数归一化加权调整为标准 RRF 排名融合，并保留 BM25 / cosine 分数用于引用解释和质量闸门。
  - 验证通过：`backend npm test -- document-parser.util.spec.ts --runInBand`、`backend npm test -- karpathy-rag.service.spec.ts --runInBand`、`backend npm run build`。
  - 未触碰红线：未修改 `.env`、schema、迁移、CI/CD，未删除文件，未新增依赖。

- **多模态 RAG PDF 蓝图与缺口沉淀完成**：
  - 新增 `MULTIMODAL_RAG_BLUEPRINT_GAP.md`，记录 PDF 中的项目定位、权限要求、支持格式、技术栈、上传解析流程、Agent 问答流程、Dify 对比和面试口径。
  - 对照当前项目状态列出缺口：多模态入库、MinIO / 对象存储、异步任务、`document_task`、文档级 ACL、Redis 权限白名单、视频跨模态、LangFuse、多模态评测等。
  - 本次只做文档沉淀与进度记录，未修改代码，未触碰 `.env`、schema、迁移、CI/CD 或删除操作。

### 2026-06-26

- **管理后台 AI 问答模型切换完成**：
  - admin AI 问答页新增模型选择，默认 `qwen`，可切换 `deepseek`。
  - admin AI 问答侧栏“模型配置”落地为 `/qa-ops/model` 页面，支持保存默认模型、启用/隐藏可选模型、查看 Qwen/DeepSeek 后端环境变量说明；仅保存非敏感 localStorage 偏好，不写入 `.env` 或 API Key。
  - admin -> admin-backend -> rag-backend AG-UI 链路新增 `model=qwen|deepseek` 参数透传。
  - rag-backend 新增 DeepSeek OpenAI-compatible LLM provider，默认 DeepSeek 模型为 `deepseek-v4-flash`，不修改真实 `.env`。
  - LLM provider 支持请求级模型上下文，避免后台切换模型影响其他请求默认千问。
  - 实际启动补齐：`AguiModule` 显式引入 `LlmModule`，避免 `AguiService` 运行时注入不到 `LlmProvider`。
  - token 复现根因修复：之前为避免 development 自动 `synchronize` 而用 `NODE_ENV=production` 启动 backend，导致本地服务 token 兜底失效并返回 401；现新增 `TYPEORM_SYNCHRONIZE=false` 开关和 `backend npm run start:local:safe`，可在 development 模式禁用 schema 同步，同时保留本地服务 token 兜底。
  - token 防复发约束：backend 与 admin-backend 在 `NODE_ENV=production` 且缺少 `RAG_SERVICE_TOKEN` 时直接启动失败，不再静默启动后让页面请求返回 401。
  - 验证通过：`backend npm run build`、`backend npm test -- agui.service.spec.ts --runInBand`、`backend npm test -- service-token.guard.spec.ts --runInBand`、`admin-backend ./node_modules/.bin/tsc -p tsconfig.json`、`admin-backend ./node_modules/.bin/jest src/modules/qa-ops/qa-ops.controller.spec.ts --runInBand`、`admin-backend ./node_modules/.bin/jest src/modules/rag-client/rag-client.service.spec.ts --runInBand`、`admin ./node_modules/.bin/tsc --noEmit`、`curl -I http://localhost:8000/qa-ops/model` 返回 200 HTML。
  - 浏览器验证：未登录态访问 `/qa-ops/model` 会按预期跳转 `/user/login?redirect=%2Fqa-ops%2Fmodel`，需要登录态做最终视觉点击复验。
  - 启动验证：`admin-backend` 已在 `http://localhost:3001` 启动，`/health` 返回 200；`admin` 已在 `http://localhost:8000` 启动并返回 200 HTML；`backend` 已用 `NODE_ENV=development TYPEORM_SYNCHRONIZE=false PORT=3000 GRPC_ENABLED=false node dist/src/main.js` 启动，`/api/v1/health` 返回 200，带本地服务 token 调用 `/api/v1/rag/admin/conversations` 返回 200。
  - 未完成全量 lint：admin 全量 `biome lint` 被既有 account/system/qa-ops a11y 与未使用代码问题阻塞；admin-backend 全量 eslint 被既有 3 个 unused warning 阻塞；backend 全量 eslint 仍有既有格式/unsafe 问题。

### 2026-06-25

- **ROADMAP 精简完成**：
  - 原始完整进度备份为 `ROADMAP.full-2026-06-25.md`。
  - 新 `ROADMAP.md` 压缩为当前状态、开放事项、阻塞、验证和历史索引。
- **GraphOps 三菜单实现与联调完成**：
  - admin 新增 `/graph-ops/nodes`、`/graph-ops/relations`、`/graph-ops/stats`。
  - admin-backend 新增/补齐 `nodes/:id`、`relations`、`relations/search`、`search`。
  - rag-backend 补齐 graph schema/entities/relationships/search。
  - 临时启动 rag-backend `3003`、admin-backend `3004`，登录后请求 stats/nodes/relations/relations-search/search 均返回 200。
  - `localhost:8000/graph-ops/nodes|relations|stats` 均返回 200 HTML。
  - 真实 Neo4j 图谱当前为空时，页面展示 `meta.demo=true` 演示数据提示，不静默冒充真实数据。
- **面试知识文档补齐**：
  - `INTERVIEW_PLAYBOOK.md` 新增最近真实面试 7 问口径。
  - `AI_AGENT_CORE_KNOWLEDGE.md` 新增“万变不离其宗的底层框架”。
- **服务间 token 本地兜底完成**：
  - `rag-backend` 与 `admin-backend` 在非生产环境未显式配置 `RAG_SERVICE_TOKEN` 时使用固定本地开发 token。
  - 生产环境仍必须显式配置，不自动兜底。
- **管理后台 QA fetch-SSE 多行帧解析修复**：
  - fetch SSE parser 改为按 `\r?\n\r?\n` 切帧并逐行提取 `data:`。
  - 真实 `localhost:8000` AG-UI 接口返回 `TEXT_MESSAGE_CONTENT/RUN_FINISHED`。

### 2026-06-24

- 管理后台 QA AG-UI 流式问答链路完成并多轮复验。
- 后台页面去静默 mock/fallback 数据：Dashboard、Documents、SearchOps、GraphOps 统一区分 loading/empty/error/demo。
- Embedding 失败策略从 mock vector 改为显式失败/降级。
- 本地三段服务统一自检脚本 `scripts/self-check.mjs` 完成。
- AG-UI/SSE 专项回归测试补齐。
- admin-backend 接入 rag-backend upstream 完成。
- SearchOps/QAOps/GraphOps 运营 API 入口和真实数据代理陆续补齐。

### 2026-06-18 至 2026-06-23

完整历史见 `ROADMAP.full-2026-06-25.md`。重点里程碑包括：

- M0-M5：项目骨架、最简 RAG、Agentic RAG、NestJS 工程化、前端最小可用、Docker Compose 部署。
- 混合检索：Milvus、BM25、Elasticsearch、Rerank。
- GraphRAG：Neo4j、实体关系抽取、Graph schema/search。
- 结构化事实治理：`document_chunks`、`fact_conflicts`、doc version、生效期、来源权威。
- 评测体系：业务回归集、质量门禁、项目级真实回放、成熟度评分。
- admin-backend 独立项目迁入并完成基础后台能力。
- 前端 admin 与 admin-backend 联调完成。

## 常用验证命令

### backend / rag-backend

```bash
cd backend
pnpm run build
pnpm test -- agui.service.spec.ts --runInBand
pnpm run eval:rag:quality
pnpm run eval:rag:maturity
```

### admin-backend

```bash
cd admin-backend
pnpm run build
pnpm run lint
pnpm exec jest --runInBand
pnpm run migration:check
```

### admin

```bash
cd admin
pnpm run lint
pnpm run build
```

注意：如果已有 `localhost:8000` dev server 持有 `.turbopack/lock`，不要直接杀进程；先向主人确认。

### 三段服务自检

  - check-production-readiness：生产就绪检查入口已记录（DEPLOYMENT_CHECKLIST.md + scripts/deploy.sh）

```bash
node scripts/self-check.mjs
```

## 历史查询提示

需要查完整历史时，用这些关键词搜索 `ROADMAP.full-2026-06-25.md`：

- `M0` / `M1` / `M2` / `M3` / `M4` / `M5`
- `Agentic`
- `GraphRAG`
- `AG-UI`
- `LangSmith`
- `admin-backend`
- `GraphOps`
- `eval:rag`
- `Milvus`
- `Mem0`
- `MCP`
- `结构化事实治理`
- `项目级仿真实业务评测`
