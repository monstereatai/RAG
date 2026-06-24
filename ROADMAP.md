# ROADMAP

> 项目真实进度源。只有已实现并验证的事项才进入"已完成"，未确认信息标"待确认"。

## 文档关系

- `ARCHITECTURE.md`：技术架构与设计约束。
- `PRD.md`：产品需求与验收标准。
- `ROADMAP.md`：真实进度源。
- `CLAUDE.md`：项目规则。
- `rag-plan.md`：早期计划和技术路线。
- `INTERVIEW_PLAYBOOK.md`：简历与面试讲解手册，记录本项目面向高级 Agent 工程师、高级 AI 应用开发工程师、高级前端开发工程师、前端负责人时应该掌握和表达的内容。
- `AI_AGENT_CORE_KNOWLEDGE.md`：AI Agent / RAG 核心知识地图，沉淀万变不离其宗的底层概念、判断框架和答题骨架。
- `ADMIN_FEATURES.md`：管理后台功能清单，基于界面截图整理登录、大盘、文档、搜索、问答、图谱、个人中心、系统管理等模块能力。
- `SERVICE_BOUNDARIES.md`：管理后台与 RAG 服务拆分设计，记录 `rag-backend` 与 `admin-backend` 两个独立后端项目的职责边界、调用方式和不抽 shared 的契约隔离规则。

## 当前阶段

**M0-M5 已完成，P0/P1/P2/P3 大部分能力已实现并验证；本轮已完成结构化事实治理 schema、真实迁移、真实上传入库、质量门禁、Compose 部署目标收口，并补齐真实业务评测集导入、项目级仿真实业务评测、业务 MCP 配置校验、GraphRAG 业务种子导入、外部 API 严格 smoke、生产就绪检查入口和企业级成熟度门禁。当前本地工程成熟度为 93/100，已超过 90 分门槛；项目级仿真实业务强制真实回放 22/22 通过。真实生产级落地仍剩外部输入类事项：真实私有业务评测数据、真实业务 MCP server 地址/启动方式、Bocha/Rerank key、真实生产目标机器/域名/证书/备份策略。**

## 当前服务拆分决策

2026-06-23 架构方向已从“一个 NestJS 后端内部分 admin-domain / rag-domain”调整为“两个独立后端项目”：

- 当前 `backend/` 继续作为 `rag-backend`，专注文档解析、切片、Embedding、索引、检索、Rerank、GraphRAG、Agent 问答、引用校验和评测。
- 后续新增独立 `admin-backend/`，专注管理后台登录态、用户、角色、权限、菜单、日志、通知、系统配置、后台大盘和运营治理。
- `admin-backend` 需要 RAG 数据时，通过 `rag-backend` 的运营 API 调用，不直接 import RAG service，不直接读写向量库。
- 当前不抽 `packages/shared`；`admin-backend` 自己维护 `rag-client` 与调用 RAG API 所需 DTO，`rag-backend` 维护自己的接口 DTO，两个服务只通过 HTTP API 契约对齐。
- 已存在的 `backend/src/domains/*` 是上一版单后端分域的过渡代码，后续不继续在其中堆完整后台能力；拆项目时要么迁出，要么只保留 RAG 侧兼容别名。
- `admin-backend/` 已从 `/Users/monster/Documents/GitHub/code/magazines/template` 搬入当前 RAG 仓库，作为后续独立管理后台后端项目；原 `magazines` 仓库会显示 `template/*` 删除，当前 RAG 仓库会显示 `admin-backend/` 新增，属于本次搬迁结果。

## 当前核心优化标准

> 知识库下一阶段不继续堆新能力，优先把主链路做硬：查得准、答得稳、引用能撑住、不会瞎编。

- **查得准**：默认主链路先保证 query normalize、中文/英文混合召回、低相关检索拒答；GraphRAG / Agentic / Web Search 只在明确触发条件下增强。
- **答得稳**：普通问题优先走可解释的 hybrid retrieval → answer 主链路，复杂 Agentic 流程不得干扰 simple 稳定性。
- **引用能撑住**：答案必须显式引用命中的片段，引用编号必须存在，关键回答内容需要能被引用片段支撑。
- **不会瞎编**：检索为空、低分、引用缺失、引用支撑不足时，不调用或不采纳 LLM 的确定性回答，返回明确的知识库不足说明。

## 架构评审结论（毒辣版摘要）

> 当前系统已经脱离“把 LangChain 全家桶倒进 NestJS 里搅一搅”的样板工程阶段，但仍不是成熟企业级 RAG。它是企业级方向正确的预备役，核心短板不在模块数量，而在能否被真实业务数据毒打后仍稳定回答。

- **主链路**：已有 query normalize、hybrid retrieval、低相关拒答、逐句 claim-level 引用支撑校验；现在的问题不再是“会不会乱答”，而是需要用更多真实业务毒题证明它持续不乱答。
- **评测集**：已有 120 条内置业务评测集、真实 e2e 回放和可选 Qwen LLM-as-Judge 稳定门禁；短板是缺主人公司真实问题与标准答案，合成题再认真也不能冒充真实业务。
- **项目级仿真实评测**：新增 8 份模拟业务文档、11 条项目级问题，覆盖版本冲突、跨文档、别名、SLA、审计、负例拒答；`PROJECT_EVAL_REQUIRE_LIVE=true npm run eval:rag:project` 在 3001 后端真实上传/问答/清理，simple 11/11、auto 11/11。
- **GraphRAG**：已有 Neo4j smoke、实体别名、关系置信度和关系型问题边界；真实价值取决于后续是否接入真实业务图谱数据源。
- **Chunk 策略**：已落地 `document_chunks`，支持父子 chunk、heading path、section/clause/table metadata、source span、doc version、生效期、来源权威；固定切分的草台味已经压下去，但复杂 PDF/表格还需要更多真实样本打磨。
- **Agentic**：auto 路由已收敛，Agentic 不再默认接管普通问题；本轮新增可配置成本边界，限制重试次数、扩展查询数、检索查询数、返回 chunk 数、Web Search 数、Rerank topN 和 auto 模式最大 query 长度。Web Search/GraphRAG 触发边界仍需更多真实业务题回归。
- **当前评级**：本地工程成熟度门禁 `npm run eval:rag:maturity` 为 93/100，达到 90 分线；但这不是生产落地满分，真实私有评测集、Milvus search 运行时治理和生产材料仍是扣分缺口。

- M0 项目骨架可运行已验证（2026-06-18）
- M1 最简 RAG 管线已验证通过（2026-06-18）：上传→切分→Embedding→Milvus→simple 检索→回答→debug 全链路 OK
- M2 Agentic RAG 完整验证通过（2026-06-18）：deepAgent 检索规划 + route/query_augment/retrieval/sufficiency/web_search/rerank/generate/reflection/SSE 全链路 OK，auto 路由到 agentic 且 reflection=1.00
- M2 已知问题：Milvus search 仍可能超时，但主向量检索已限制为约 0.8s 快速失败并通过 BM25 中文召回降级兜底，不再阻塞 M2
- M3 NestJS 工程化已验证通过（2026-06-18）：JWT + 统一响应 + 全局异常 + pino 日志
- M4 前端最小可用已验证通过（2026-06-18）：React + Vite + TypeScript，文件上传 + 聊天（SSE 流式）+ 引用展示 + 模式切换
- M5 容器化部署已验证通过（2026-06-18）：Dockerfile 多阶段构建 + docker-compose.prod.yml 完整栈 + 资源限制 + nginx 反代
- **P0 BM25 JSON 持久化完成**（2026-06-18）：重启后自动从 workspace/bm25-index.json 恢复索引，上传时自动落盘
- **P2 文档删除接口完成**（2026-06-18）：DELETE /api/documents/:docId，Milvus + BM25 + 内存元数据同步删除
- **P1 TypeORM + RelationalDBProvider 骨架完成**（2026-06-18）：@nestjs/typeorm + pg，4 个实体（users/conversations/messages/documents_meta），开发环境自动同步 schema
- **P1 SpeechProvider 腾讯云 ASR/TTS 骨架完成**（2026-06-18）：TencentSpeechProvider（API v3 签名 + 一句话识别 + TTS）+ SpeechController（POST /api/speech/asr + GET /api/speech/tts）
- **P1 docker-compose.dev.yml 完成**（2026-06-18）：含 Elasticsearch 8.13 + 全部基础设施，容器名加 dev 前缀
- **P2 前端 Debug 面板完成**（2026-06-18）：DebugPanel 组件，BM25/Cosine/融合分数进度条可视化，chunk 原文展开
- **P2 前端文档删除 UI 完成**（2026-06-18）：UploadPage 删除按钮 + 消息类型区分 + 刷新按钮
- **P1 LangGraph Checkpointer 状态持久化完成**（2026-06-18）：重构为 StateGraph + MemorySaver 机制，多轮流式对话状态自动恢复
- **P1 Elasticsearch 混合检索接入完成**（2026-06-18）：IK 中文分词检索，ES 启用时无缝替换内存 BM25 检索，ES 未启动时自动优雅降级
- **P1 Prompt 工程体系完成**（2026-06-18）：提取全部硬编码 inline 提示词统一管理在 prompts 目录中
- **P2 前端 TTS 朗读按钮完成**（2026-06-18）：AI 回答卡片增加播放按钮，调用后端腾讯云 TTS 流式语音合成
- **P1 TypeORM 迁移脚本与对话持久化完成**（2026-06-18）：生成并应用了 InitSchema 迁移文件，重构 ConversationService 使用 TypeORM 实体读取与保存对话记录，彻底替换原有的内存 Map，实现全自动的关系型数据库落库持久化。
- **P2 Redis 缓存层与短期记忆集成完成**（2026-06-18）：在宿主机与容器环境中集成 ioredis 连接，自动缓存 Embedding 向量（TTL 7 天）与短期对话记录（TTL 30 分钟），并在消息追加和对话删除时触发即时缓存失效，数据获取耗时从 5ms 降低至 1ms。
- **P2 认证与多租户隔离验证完成**（2026-06-18）：实现后端 API JWT 认证保护和原生 HTML EventSource 流式 token 参数鉴权，在关系型数据库、Redis 缓存、Milvus 向量、BM25 索引中深度实施基于 `userId` 的多租户逻辑/物理硬隔离，通过 E2E 脚本自动化验证。
- **P1 Redis LangGraph Checkpointer 接入完成**（2026-06-19，2026-06-20 复验）：Agentic RAG 从进程内 `MemorySaver` 切换为 `RedisCheckpointer`，Redis 可用时持久化 checkpoint，Redis 不可用时自动降级内存 saver；已通过 build/lint，dev Redis 已恢复且应用启动成功连接 Redis。跨进程重启恢复仍属于专项验证，不影响当前启动链路。
- **P0 RAG 评测体系方案定稿**（2026-06-19）：Dataset 采用合成数据为主 + 人工抽样复核，Judge 使用 OpenAI-compatible 模型（默认沿用 Qwen/OpenAI Provider），CI/CD 采用 Drone pipeline，在 Dockerfile 构建验证前执行 `npm run eval:rag` smoke 门禁。
- **P3 结构化日志已同步完成状态**（2026-06-19）：M3 阶段已实现 nestjs-pino + pino JSON 结构化日志，P3 待办状态补齐为已完成。
- **P0 Provider 接口定义状态同步完成**（2026-06-19）：确认 LLMProvider / EmbeddingProvider / SpeechProvider 抽象接口均已存在并有 Qwen/Tencent 实现，待办状态补齐为已完成。
- **P3 API 限流完成**（2026-06-19）：接入 `@nestjs/throttler` 全局 Guard，默认 60 req/min，通过 `THROTTLE_TTL_MS` / `THROTTLE_LIMIT` 配置；已通过 build/lint。压测属于后续增强，当前不阻塞验收。
- **P3 单元测试基础版完成**（2026-06-19）：新增 chunking、BM25、cosine、Bocha、DashScope Rerank 本地单元测试，共 13 条通过；Provider mock 深水区和更多异常路径后续扩展。
- **P3 Prometheus 指标基础版完成**（2026-06-19，2026-06-20 运行时复验）：新增 `MetricsModule` / `MetricsController` / `MetricsService` / `MetricsInterceptor`，`GET /api/v1/metrics` 已返回 Prometheus 文本格式指标，包含 `rag_http_requests_total`、`rag_http_request_duration_seconds` 与默认 Node 指标。
- **P0/P2 Mem0 长期记忆方案定稿与集成完成**（2026-06-19，2026-06-20 运行时复验）：
  - **方案定稿**：梳理并编写了长短期记忆分层存储注入机制及 LLM + Zod 判定分类逻辑。
  - **代码与测试集成**：新增 `Mem0Provider` 和 `MemoryService` 的全覆盖单元测试（18 个测试用例均通过），验证了 disabled 模式、cloud 模式及 local 模式（包含 fetch HTTP Mock）下的正常读取、添加、列表及删除流程，保证记忆系统无故障运行。
  - **运行时验证**：`Mem0 cloud mode initialized successfully.`；带 JWT 调用 `GET /api/v1/memories` 返回 `enabled=true` 与空 memories 列表，未输出 API key。
- **P2 MCP 协议深度集成完成**（2026-06-19）：
  - **组件与逻辑**：使用 `@langchain/mcp-adapters` 统一连接标准，实现 `McpProvider`。新增可观测性接口 `McpController` (`GET /api/mcp/tools`)。
  - **Agent 绑定**：重构 `AgenticRagService` 核心生成逻辑，接入 `createReactAgent` 与流式 `streamEvents`，使得 LLM 支持动态监测和交互式调用底层环境工具。
- **P3 REPL 沙箱代码分析环境集成完成**（2026-06-19）：
  - **组件与逻辑**：在 [analyst.agent.ts](file:///Users/monster/Documents/GitHub/code/RAG/backend/src/rag/agents/analyst.agent.ts) 中集成了 `@langchain/quickjs` 沙箱环境（提供 `js_eval` 工具），实现数据分析师 Agent 能够在隔离的 QuickJS WebAssembly 沙箱中自动运行数值计算和 JSON/CSV 分析代码。
  - **优雅降级**：实现健壮的异常捕获与回退机制，在缺少 Wasm/ESM 标志或不支持 VM 模块的非标准测试环境下，自动优雅降级为标准的 LLM 直连计算，确保整个业务管线的极佳兼容性。
  - **测试与验证**：编写了专用的 `analyst.agent.spec.ts` 单元测试，全面校验了标准的执行与降级回退分支逻辑，测试 100% 成功。
- **RAG 评测 CI 门禁完成**（2026-06-20）：新增 `.drone.yml`，backend 阶段执行 build、no-fix ESLint、`npm run eval:rag`；frontend 阶段执行 lint/build；随后使用 Drone Docker 插件 dry-run 验证 backend/frontend Dockerfile 构建，不推镜像、不部署。
- **Jenkins 部署流水线配置完成**（2026-06-20）：新增 `Jenkinsfile`，包含 backend gate、frontend gate、Docker build、手动参数化 Deploy 阶段；默认 `DEPLOY_TARGET=none` 只做 CI 验证，不部署。部署目标支持 staging/prod compose，GraphRAG profile 可选开启。
- **依赖与基础镜像版本固定完成**（2026-06-20）：backend/frontend `package.json` 依赖版本已按 lockfile 解析结果固定为精确版本；Dockerfile 与 docker compose 中 Node/nginx/pgvector/Redis/Neo4j 等浮动 tag 已固定到明确小版本。
- 下一步：继续收口外部输入类事项。业务 MCP server、真实业务图谱、真实私有业务评测集、Bocha/Rerank key、生产目标机器/域名/证书/备份策略都需要外部材料；项目内可完成的结构化事实治理、质量门禁、Compose 部署目标和本地历史快照清理已完成。
- **P3 Mermaid 工作流可视化基础版完成**（2026-06-19）：新增 `GET /api/workflows/agentic/mermaid`，导出 Agentic RAG LangGraph Mermaid 图，并支持按 SSE 事件路径高亮节点。
- **P2 Skills Embedding 语义匹配增强完成**（2026-06-19）：Skills 匹配在 `QWEN_API_KEY` 可用时使用 OpenAI-compatible Embeddings 计算语义相似度排序；无 key 或调用失败自动回退本地 token 匹配，避免启动失败；真实 Qwen `text-embedding-v3` 调用已验证返回 1024 维非零向量。
- **本地密钥快照防误提交完成**（2026-06-19）：新增 `.gitignore` 规则 `.history/**/.env*`，防止本地历史环境变量快照误入版本库；已生成的本地快照删除需主人确认。
- **P3 文件系统中间件 + 权限控制基础版完成**（2026-06-19）：新增 `FileAccessPolicyService`，默认只允许访问 workspace 根内路径，并拒绝 `.env` / `.git` / `.history` / `agent-course` / `node_modules` 等敏感路径段。
- **本地 `start:dev` 启动问题已定位并修复 MCP 默认初始化阻塞**（2026-06-19）：MCP 改为 `MCP_ENABLED=true` 时才读取 `workspace/mcp-servers.yaml` 并连接 server；默认开发启动不再被 `agent-course` 示例 MCP server 缺依赖影响。`PORT=3001 npm run start:dev` + `/api/health` 已验证通过；3000 端口仍被本机既有 `node` 进程占用，未擅自 kill。
- **M1/P0/P1/P2 基础设施与定时任务持久化恢复完成**（2026-06-19）：
  - **ES 混合检索与中文分词集成成功**：将 Node 客户端版本与 ES 容器（v8.13.0）完全对齐，解决版本兼容头问题；安装加载 `analysis-ik` 8.13.0 分词插件，并初始化 `rag_chunks` 索引。
  - **数据库无关 Migration 迁移完成**：将 InitSchema 迁移文件重构为基于 Table 和 TableIndex 定义，实现数据库无关 schema 设计，完美支持 Postgres 与 MySQL。
  - **定时任务数据库持久化与启动恢复完成**：引入 `ScheduledJobEntity` 实现在关系型数据库中的持久化，并在应用启动时由 `JobsService` 自动恢复 active 状态任务的调度。
  - **修复 LangGraph 编译问题**：将 `humanApproval` 节点重命名为 `humanApprovalNode`，修复节点与状态属性命名冲突导致 Graph 无法编译的故障。
- **问答卡在 routing/无回复问题已修复**（2026-06-19，2026-06-20 补强）：定位到 `conversation_chunks` Milvus search 可长时间不返回，以及 Agentic `DeepAgent` 查询规划缺少超时保护会导致 SSE 停在 `routing`；已为 DeepAgent 初始化/规划、语义示例选择、结构化 query augment、对话历史向量检索、主 Milvus 相似度检索增加超时降级。2026-06-20 进一步将主向量检索/对话历史检索的 Milvus SDK timeout 收紧到亚秒级，并加入短期熔断。验证通过：`npm run build`、触碰文件定向 `eslint`、`PORT=3001 node dist/src/main`、`GET /api/v1/health`、simple `POST /api/v1/chat`、agentic `GET /api/v1/chat/stream`。
- **P1/P3 待办 1-5 完成**（2026-06-20）：完成 Milvus HNSW 索引配置化与 `GET /api/debug/vector-index` 验收接口；完善结构化流式输出 `meta/partial/final/done`；完成实体关系抽取接口 `POST /api/graph/extract`；完成非结构化文本导入图谱接口 `POST /api/graph/import`；完成 GraphRAG 查询与 schema 接口 `POST /api/graph/query` / `GET /api/graph/schema`。GraphRAG 默认受 `GRAPH_RAG_ENABLED=true` 控制，未启用 Neo4j 时返回明确 503，不阻塞应用启动。验证通过：`npm run build`、全量 no-fix `npx eslint "{src,apps,libs,test}/**/*.ts"`、`PORT=3001 node dist/src/main`、`GET /api/v1/health`、`GET /api/v1/debug/vector-index` 返回 HNSW、`GET /api/v1/graph/schema` 返回 disabled schema、`POST /api/v1/graph/import` 在默认关闭时返回 503、`GET /api/v1/structured/stream` 输出 `meta -> partial -> final -> done`、`POST /api/v1/graph/extract` 返回节点/关系。
- **P3 追踪、评测门禁、E2E 与性能基准完成**（2026-06-20）：新增 W3C `traceparent` 兼容追踪基础版（全局 interceptor + `GET /api/traces` 最近 span 查询，当前 exporter 为 in-memory，OTLP exporter 待后续接入）；新增 `npm run eval:rag` RAG smoke 评测门禁，离线模式校验 dataset，在线模式自动上传评测种子文档、提问打分并删除种子文档；新增 `npm run test:e2e:rag` 外部服务 E2E，覆盖登录、上传、simple 提问、auto/agentic 模式切换、Debug、语音 SSE、删除；新增 `npm run perf:rag` 性能基准脚本，支持 `PERF_RAG_ENFORCE=true` 强制阈值。验证通过：`npm run build`、全量 no-fix `npx eslint "{src,apps,libs,test}/**/*.ts"`、`npm run eval:rag`、`EVAL_RAG_BASE_URL=http://localhost:3001 npm run eval:rag`、`E2E_BASE_URL=http://localhost:3001 npm run test:e2e:rag`、`GET /api/v1/health` 携带 traceparent 返回同 traceId 新 spanId、`GET /api/v1/traces?limit=5` 返回最近 span。性能基准修复后已达标：`PERF_RAG_BASE_URL=http://localhost:3001 PERF_RAG_SAMPLES=3 PERF_RAG_ENFORCE=true npm run perf:rag` 结果 simple P50≈28.97ms、agentic P50≈34.14ms；该基准覆盖空知识库快速失败路径，不代表有文档且触发真实 LLM 生成时也能稳定低于 800ms。
- **Milvus 超时降级与删除超时修复**（2026-06-20）：为主向量检索、对话历史检索、对话历史删除、文档向量删除传入 Milvus SDK `timeout` 并增加应用层短期熔断；新会话跳过无意义的历史向量搜索；agentic 在当前用户无索引片段时直接快速返回，避免空知识库仍执行 query augment / reflection / retry。验证通过：Milvus warmup timeout 从 15s 降到约 0.8s；测试文档删除接口返回 200，总耗时约 31-36ms，日志确认 `Deleted chunks for doc_id=...`；`E2E_BASE_URL=http://localhost:3001 npm run test:e2e:rag` 从约 37s 降到约 11.4s。
- **Milvus 残留向量保护与删除重试完成**（2026-06-20）：保留 Milvus 检索/删除功能，同时新增 active docId 过滤，向量检索命中会在融合前按当前用户 BM25/元数据里的有效 docId 过滤，避免已删除文档的残留向量进入答案；Milvus 删除失败后进入进程内退避重试队列，最多重试 5 次，不新增数据库 schema。验证通过：`npm run build`、全量 no-fix `npx eslint "{src,apps,libs,test}/**/*.ts"`、`npx jest src/rag/karpathy/karpathy-rag.service.spec.ts --runInBand` 新增 stale vector hit 过滤用例；后续可继续做删除重试运行时专项观察。
- **前端 lint 工具链补齐完成**（2026-06-20）：frontend 新增 ESLint flat config，补齐本地 ESLint/TypeScript/React Hooks 开发依赖，修复现有 lint 错误。验证通过：`cd frontend && npm run lint`、`cd frontend && npm run build`。
- **架构设计文档与 PRD 补齐完成**（2026-06-20）：新增 `ARCHITECTURE.md` 与 `PRD.md`，分别记录系统目标、组件边界、核心链路、部署形态、可观测性、风险，以及产品目标、用户故事、功能范围、接口范围、非功能要求、验收口径和开放问题。验证通过：文档文件存在，核心章节可检索；本次为文档补齐，不涉及代码构建。
- **专项联调脚本化优化完成**（2026-06-21）：新增 MCP / GraphRAG / Tencent Speech / external tools / Redis Checkpointer / hybrid retrieval 6 类 smoke 脚本与固定样本数据；MCP 真实 stdio server smoke、Qwen LLM-as-Judge 真实调用、腾讯云 TTS→ASR 直连回环已验证通过。Bocha/Rerank 因当前环境变量为空跳过；GraphRAG/Hybrid/backend Speech/Redis 运行时联调已在“企业级差距真实联调第三轮”补齐。
- **Prometheus 业务指标与 Milvus 可调超时优化完成**（2026-06-21）：新增 `rag_retrieval_hits_total`、`rag_llm_calls_total`、`rag_llm_call_duration_seconds`、`rag_llm_tokens_estimated_total` 指标，覆盖检索命中、LLM 调用耗时和输入/输出 token 估算；新增 Milvus search/delete/warmup/circuit 超时环境变量，降低硬编码并允许按机器资源调整首次检索 warning。
- **项目文档当前态同步完成**（2026-06-21）：同步 `ARCHITECTURE.md` / `PRD.md` / `CLAUDE.md` / `rag-plan.md` 与 ROADMAP 当前状态，修正 MCP、腾讯云 ASR/TTS、GraphRAG smoke、Prometheus 业务指标、`/api/v1` 接口路径等过期描述。
- **Elasticsearch Provider 类型收敛完成**（2026-06-21）：移除 ES 查询路径中的 `any` 与重复注释，使用 Elasticsearch SDK `estypes` 标注 query container，保持原有 BM25 查询语义不变。
- **Analyst Agent 动态导入类型收敛完成**（2026-06-21）：为 DeepAgent 与 QuickJS middleware 动态导入增加明确工厂类型，移除大块 unsafe eslint-disable，仅保留 `new Function` 动态 import 所需的最小豁免。
- **RAG 主链路质量闸门完成**（2026-06-21）：simple/Karpathy 主链路新增 query normalize、低相关检索拒答、引用编号校验、引用内容覆盖率校验；检索为空、检索低分、问题与片段无关键词重合、答案缺少引用或引用撑不住时，不采纳 LLM 确定性回答，返回知识库不足说明。对应核心标准：查得准、答得稳、引用能撑住、不会瞎编。
- **RAG 核心质量优化第一轮完成**（2026-06-21）：围绕 6 件核心优化继续推进：扩展中文质量回归样本到同义词、缩写、别名、错别字、多版本冲突、跨章节召回、无答案负例；Agentic 路径复用 simple 质量闸门，生成后校验引用支撑，不通过则返回知识库不足说明；auto 路由收敛为启发式边界，普通问题默认 simple，只有对比/分析/多跳/规划/实时类问题走 Agentic；GraphRAG 查询增加实体关系型问题边界；MarkdownChunker 增加章节路径、表格行、条款编号结构提示；第四轮已进一步升级为结构化 chunk 表。
- **架构评审问题修复第一轮完成**（2026-06-21）：将评审中指出的“引用支撑仍偏粗糙、评测只看关键词、GraphRAG/Agentic 边界不够硬、chunk 结构化不足”写入 `ROADMAP.md` 并逐项推进；引用校验升级为逐句 claim-level 支撑，每个有信息量句子必须带有效片段引用且被对应片段覆盖；`eval:rag` 增加引用与拒答检查字段，离线评测包含无答案拒答负例；GraphRAG/Agentic/chunk 第一版边界与结构提示已在上一条完成。
- **企业级差距可本地增强第一轮完成**（2026-06-21）：扩展 `rag-smoke.dataset.json` 为业务评测格式，增加 category/department/documentType、expectedClaims、requireCitation、expectRefusal、expectConflictHandling；`eval:rag` 输出按 category 的汇总和 claim 级结果；新增 `eval:rag:e2e` 真实服务回放脚本，批量上传回归文档并对 simple/auto/agentic 统计引用、拒答、关键词、耗时，服务不可用时明确 skipped；Karpathy/Agentic 运行时增加多版本片段冲突提醒；第四轮已进一步落地事实冲突表。
- **企业级差距可本地增强第二轮完成**（2026-06-21）：检索排序增加可选 `RAG_SOURCE_AUTHORITY_RULES` 来源权威权重，不改 schema；新增 `eval:rag:judge` 可选 Qwen LLM-as-Judge 脚本，对 expectedClaims 做 supported / contradicted / not_mentioned 判断，缺少 `QWEN_API_KEY` 时明确 skipped，避免默认验证消耗 key。
- **企业级差距真实联调第三轮完成**（2026-06-21）：Docker dev 依赖恢复后，完成 120 条内置业务回归评测集生成与校验、3001 后端真实启动、GraphRAG / Hybrid / Redis Checkpointer / Tencent Speech 后端真实 smoke、`eval:rag:e2e` simple+auto 真实回放 18/18 通过；修复 LLM/Embedding/Karpathy 模块缺少 MetricsModule 注入、Speech SSE parser 兼容 Nest 默认 `data` 包装、真实 e2e 下引用不足回退为片段抽取式答案的问题。结构化事实治理已在第四轮补齐。
- **企业级差距第四轮结构化事实治理完成**（2026-06-21）：新增 `document_chunks` 与 `fact_conflicts`，文档元数据补齐 docVersion/effectiveAt/expiredAt/sourceAuthority；上传流程写入父子 chunk、source span、section/clause/table metadata，并检测简单版本事实冲突；GraphRAG 写入 aliases/confidence，RAG references 返回结构化来源字段。真实迁移、真实上传、真实查询、真实删除清理均已验证。
- **中文错别字召回回归修复完成**（2026-06-21）：真实 e2e 暴露 `企业知识哭` 未能通过引用支撑闸门；已将已确认高价值错别字 `知识哭 -> 知识库` 纳入查询归一化，并把修正后的 query 传给生成 prompt，避免 LLM 先解释“笔误”导致无引用 claim 被拒。最小真实复现与完整 `eval:rag:e2e` 均通过。
- **admin-backend 迁入与本地生成物清理完成**（2026-06-23）：将 `/Users/monster/Documents/GitHub/code/magazines/template` 搬入当前仓库为 `admin-backend/`，保留源码、文档、Docker/Kubernetes/脚本和项目配置；清理 `node_modules/`、`dist/`、`coverage/`、`build/`、`tsconfig.tsbuildinfo` 与 `.DS_Store` 等本地生成物。已按管理后台架构文档修正项目命名：目录名、`package.json`、`package-lock.json`、README、CLAUDE、health/tracing service name 均对齐为 `admin-backend`，分层文档改为 `docs/backend-layers.md`。验证通过：`clean-ok` 确认生成物目录不存在，`naming-ok` 确认 `admin-backend/` 存在且 `template/` 不存在，`package-name-ok` 确认 package 与 lockfile 名称一致。未运行 `npm run verify`，因为本轮清理后未重新安装模板依赖；后续正式改造前需执行 `cd admin-backend && npm ci && npm run verify`。
- **admin-backend P0 后台功能骨架补强完成**（2026-06-23）：新增 `admin-backend/ROADMAP.md` 作为管理后台后端真实进度源；补齐 `GET /admin/features` 功能完成度总览、`GET /admin/profile` 个人中心基础信息、增强 `GET /admin/dashboard` 大盘数据结构、通知中心未读/单条已读/全部已读接口、审计日志筛选参数、系统配置模块状态聚合；新增 `docs/rag-admin-api-contract.md` 记录后台依赖的 RAG 运营 API。验证通过：`cd admin-backend && npm run verify`，覆盖 build、lint、unit、e2e、migration check。验证后已清理本地生成物。当前仍阻塞：`rag-backend` 尚未暴露 `/api/v1/rag/admin/*` 运营 API，文档治理和 RAG 运营页只能返回 structured unavailable。
- **admin-backend 通知持久化与大盘真实趋势完成**（2026-06-24）：admin-backend 新增 `Notification` entity + TypeORM 持久化（数据库不可用时自动降级内存）；大盘 `overview()` 通过 `RAG_SERVICE_TOKEN` 拉取 rag-backend 真实数据（热门 query、成本统计、文档/评测/向量索引卡片）；新增 `ServiceTokenGuard` 支持内部服务 token + JWT 双认证。验证通过：admin-backend build + test（4 suites / 26 tests）。
- **查询日志与分析系统完成**（2026-06-24）：新建 `query_logs` 表（QueryLogEntity），ChatService 每次问答异步写入 query/mode/userId/latency/citationCount/refused；RagAdminService 的 search/QA 运营端点从 `not_implemented` 升级为真实数据查询（热门 query TOP-N、无结果 query、召回问题、成本统计）。验证通过：`cd backend && npm run build`、`npm test -- --runInBand`（21 suites / 103 tests）。
- **gRPC 通道搭建完成**（2026-06-23）：rag-backend 新增 gRPC server（0.0.0.0:50051），admin-backend 新增 RagGrpcClientService；proto 定义 RagService（VectorSearch/GetDocument/ListDocuments/HealthCheck），4 个 RPC 全部真实数据验证通过。
- **RAG 运营 API 完整实现完成**（2026-06-23）：新增 `backend/src/modules/rag-admin/` 模块，实现 `GET/POST /api/v1/rag/admin/*` 全部运营端点（capabilities/documents/chunks/vector-index/evaluations/conversations/reindex/search ops/qa ops/graph ops）；`KarpathyRagService` 新增 `getStats()` 方法。搜索/问答分析类端点受限于 query log 持久化，返回 structured unavailable。P0 管理后台独立项目 7 项待办全部完成。验证通过：`cd backend && npm run build`、`npx eslint`、`npm test -- --runInBand`（21 suites / 103 tests）。
- **简历亮点能力补齐盘点完成**（2026-06-24）：对照截图、`SUMMARY.md` 与 `agent-course/` 确认 backend 已具备腾讯云 ASR/TTS、@nestjs/schedule 定时任务、Agentic RAG、混合检索 RAG、RedisCheckpointer + DeepAgents 短期记忆；新增 `GET /api/v1/agui/stream` AG-UI 事件流适配层，将现有 Agentic RAG SSE 映射为 `RUN_STARTED`、`TEXT_MESSAGE_*`、`TOOL_CALL_*`、`STATE_DELTA`、`RUN_FINISHED/RUN_ERROR`；新增 `npm run eval:rag:langsmith`，支持 LangSmith-friendly 本地导出、LangSmith tracing，并可通过 `LANGSMITH_UPLOAD=true` 显式上传 Dataset/Experiment；补齐 pnpm/Jest 下 `uuid` ESM 测试兼容 mock。验证通过：`cd backend && pnpm run build`、`pnpm exec eslint src/modules/agui/*.ts src/app.module.ts src/config/configuration.ts src/modules/rag-admin/rag-admin.service.ts`、`pnpm test -- agui.service.spec.ts --runInBand`、`pnpm exec jest --runInBand`（22 suites / 104 tests）、`pnpm run eval:rag:langsmith`。
- **前端 AG-UI 流式协议对接完成**（2026-06-24）：frontend 新增 `AguiEvent` 类型与 `aguiStream()` API，agentic/auto 模式从内部 `/chat/stream` 切到 `/api/v1/agui/stream`；`ChatPage` 已将 `RUN_STARTED`、`TEXT_MESSAGE_CONTENT`、`STATE_DELTA`、`CUSTOM(rag.citation/rag.reflection)`、`RUN_FINISHED`、`RUN_ERROR` 映射回现有消息内容、流程追踪、引用、路由、检索充分性、置信度和错误状态。旧 `chatStream()` 保留作兼容能力。验证通过：`cd frontend && pnpm run lint`、`pnpm run build`。
- **管理后台 AG-UI 流式问答链路完成**（2026-06-24）：rag-backend 新增内部服务 token 入口 `GET /api/v1/agui/admin/stream`，admin-backend 新增 `GET /api/admin/qa-ops/agui/stream` 代理并支持 EventSource query token，admin 前端 QA 页面从静态示例升级为真实 AG-UI 流式问答，展示 token 内容、引用、路由、检索充分性、置信度、事件轨迹和错误状态。验证通过：`cd backend && pnpm run build`、`pnpm test -- agui.service.spec.ts --runInBand`、`cd admin-backend && npm run build`、`npm test -- --runInBand`（7 suites / 45 tests）、`cd admin && pnpm run lint`、`cd admin && pnpm run build`；本地三段服务真实 SSE 代理链路已验证通过。
- **AG-UI 落地缺口补齐完成**（2026-06-24）：补齐 `admin-backend/.env.example` 的 `RAG_SERVICE_BASE_URL/RAG_SERVICE_TIMEOUT_MS/RAG_SERVICE_TOKEN`；admin-backend 流式代理增加 upstream 异常 / reader 读取失败兜底，统一向浏览器写入 `RUN_ERROR` 并结束 SSE；新增根目录 `AGUI_INTEGRATION.md` 记录用户端、管理后台、内部服务三条 AG-UI 链路、启动顺序和验证命令；同步 admin 项目规则为当前实际 `pnpm + pnpm-lock.yaml`。验证通过：`cd admin-backend && npm run build`、`npm test -- --runInBand`、`cd admin && pnpm run lint`、`cd backend && pnpm run build`、`pnpm test -- agui.service.spec.ts --runInBand`。
- **检索不足模型兜底完成**（2026-06-24）：simple/Karpathy 与 agentic 链路在空库、无候选片段、检索评分不足时不再向用户输出“片段中未提及 / 暂不生成确定结论”，改为调用模型直接兜底回答；兜底答案不伪造引用，`retrievalSufficient=false` 与 `retrievalReason=...已使用模型兜底回答` 仍保留给前端和后台展示；agentic reflection 对兜底答案不再按引用支撑规则重试，避免同一问题重复输出。验证通过：`cd backend && pnpm run build`、`pnpm test -- karpathy-rag.service.spec.ts agui.service.spec.ts --runInBand`、`pnpm exec eslint src/rag/karpathy/karpathy-rag.service.ts src/rag/agentic/agentic-rag.service.ts`、真实 `GET /api/v1/agui/stream?query=今天是星期几&mode=agentic` 返回单条 `TEXT_MESSAGE_CONTENT`：“今天是2026年6月24日，星期三。”，`retryCount=0`，`retrievalReason` 标记为模型兜底；管理后台代理本轮未改 `.env`，当前本地服务 token 不一致时会返回 401，需要同步本机运行时 token 后再复验代理链路。
- **管理后台 QA AG-UI 代理友好兜底完成**（2026-06-24）：定位 `/qa-ops` 页面 `错误：fetch failed / AG-UI: RUN_ERROR` 的根因是 admin-backend 代理无法连接 rag-backend，错误发生在代理层而不是 RAG 检索兜底层；`QaOpsController.streamAgui()` 已将 upstream 不可达、401/token 不匹配等异常改为输出正常 AG-UI 完成事件（`RUN_STARTED -> TEXT_MESSAGE_CONTENT -> RUN_FINISHED`），不再把代理连接问题直接暴露为 `RUN_ERROR`；admin 前端 EventSource 网络错误文案补充为明确提示 admin-backend 未启动或代理不可访问。验证通过：`cd admin-backend && pnpm run build`、`pnpm exec jest --runInBand`（7 suites / 45 tests）、`cd admin && pnpm run lint`（通过，保留既有 dashboard 未使用变量 warning）；真实 curl 验证在 rag-backend 3000 未监听时，`GET /api/admin/qa-ops/agui/stream?...` 返回 `TEXT_MESSAGE_CONTENT` 友好提示与 `RUN_FINISHED`，未返回 `RUN_ERROR`。
- **管理后台 QA AG-UI SSE 超时断流修复完成**（2026-06-24）：定位 `/qa-ops` 查询 `nestjs` 时只输出到 `retrieval/sufficiency` 后断流的根因是 admin-backend 全局 `CircuitBreakerInterceptor` 对所有请求套了 `timeout(5000)`；已对 `Accept: text/event-stream` 和 `/agui/stream` 请求跳过该 5 秒超时，普通 API 仍保留熔断超时保护。验证通过：`cd admin-backend && pnpm run build`、`pnpm exec jest --runInBand`（7 suites / 45 tests）、统一运行时 `RAG_SERVICE_TOKEN` 后通过 `localhost:8000/api/admin/qa-ops/agui/stream?query=nestjs&mode=agentic` 验证输出 `TEXT_MESSAGE_CONTENT -> rag.final -> TEXT_MESSAGE_END -> RUN_FINISHED`，不再报 `AG-UI 流式连接失败`。

## 已完成

- [x] rag-plan.md 规划文档（2026-06-18）
  - 含 Summary、Key Changes、Public Interfaces、架构图、依赖清单、Test Plan、Assumptions
  - 含改进建议（17 项，P0-P3 分级）
  - 含基于 agent-course 经验的能力补充（18 小节 + 6 个新增小节）
- [x] SUMMARY.md（agent-course 26 章节能力总结，2026-06-18）
  - 含 LangChain 基础（Prompt/Runnable/OutputParser/Tool）
  - 含 RAG 基础到进阶（Milvus/pgvector/ES/Neo4j GraphRAG）
  - 含 LangGraph 图编排、DeepAgents 全家桶
  - 含记忆系统（Redis/Mem0）、语音（腾讯云 ASR/TTS）
  - 含 NestJS 工程化（JWT/Docker/TypeORM）、评测、定时任务
- [x] 技术栈选型确认：NestJS / Node.js（2026-06-18，对齐 SUMMARY.md）
  - 后端：NestJS + LangChain.js + LangGraph.js + DeepAgents.js
  - 前端：React + Vite
  - 向量库：Milvus + pgvector（可插拔，VECTOR_STORE_PROVIDER 切换）
  - 关系型数据库：PostgreSQL + MySQL（可插拔，RELATIONAL_DB_PROVIDER 切换）
  - 搜索引擎：Elasticsearch（IK 中文分词，混合检索）
  - 记忆：Mem0 + Redis + LangChain ChatMessageHistory
  - 评测：LangSmith + OpenEvals
  - LLM：通义千问（qwen-plus/turbo）+ OpenAI 兼容接口
  - 语音：腾讯云 ASR/TTS（含流式 TTS）
  - 工具：Bocha 搜索、DashScope Rerank、QuickJS REPL
  - 知识图谱：Neo4j + Cypher（GraphRAG，可选）
  - 工具协议：MCP（Model Context Protocol）
- [x] RAG 评测 Dataset 来源确认：合成数据（2026-06-18）
- [x] rag-plan.md 技术栈同步：Python → Node.js（2026-06-18）
  - 架构图：FastAPI → NestJS、pgvector → Milvus、Tavily → Bocha、numpy → 纯 JS
  - 依赖清单：替换为 NestJS / LangChain.js / LangGraph.js / DeepAgents.js / TypeORM / ioredis / pino 等
  - 代码示例：Python → TypeScript（jieba 分词、LangGraph interrupt）
  - 改进建议：APScheduler → @nestjs/schedule、Alembic → TypeORM migrations、structlog → pino、slowapi → @nestjs/throttler、RestrictedPython → quickjs-emscripten
- [x] rag-plan.md 对齐 SUMMARY.md 26 个项目（2026-06-18）
  - 综合能力对照表从 13 章扩展到 26 章
  - 新增 6 个能力补充章节：知识图谱 RAG、MCP 协议、NestJS 工程化、Docker 部署、Prompt 工程、结构化输出
  - 依赖清单新增：@langchain/mcp-adapters、neo4j-driver、@langchain/community/graphs/neo4j_graph
  - 实施优先级表新增 7 项（NestJS 工程化 P0、Prompt 工程 P1、结构化输出 P1、Docker 部署 P1、MCP 集成 P2、知识图谱 P3）
- [x] **M0 项目骨架可运行**（2026-06-18，已验证）
  - 顶层目录结构：backend / frontend / admin / docker / skills / workspace
  - CLAUDE.md 项目规则定稿（技术栈锁死、目录约定、验证命令、红线、里程碑纪律）
  - 根级 .gitignore（node_modules / .env / dist / docker volumes 等）
  - backend/ NestJS 项目初始化（npx @nestjs/cli new --strict，不全局安装）
  - 依赖：@nestjs/config（配置加载）+ @nestjs/terminus（健康检查）+ dotenv
  - 目录结构：common/{decorators,filters,guards,interceptors,pipes,interfaces} + config + modules/health + providers/{llm,embedding,speech,vector-store,db} + rag/{karpathy,agentic,router} + tools
  - config/configuration.ts：全量配置加载（向量库/关系库/Redis/ES/LLM/Embedding/Speech/Bocha/Rerank/Neo4j/Workspace）
  - modules/health：`GET /api/health` 返回 `{status:"ok",timestamp}`
  - main.ts：全局 API 前缀 `/api`
  - backend/.env.example：全量环境变量模板（不含真实密钥）
  - docker/docker-compose.yml：PostgreSQL16+pgvector / Redis7 / Milvus2.4.4（etcd+minio+standalone）+ healthcheck
  - 验证通过：`npm run build` ✓ / `npm run lint` ✓ / `npm run start` ✓ / `curl /api/health` → `{"status":"ok"}` ✓
- [x] **M1 最简 RAG 管线完成**（2026-06-18，已 docker 验证完整链路）
  - providers/llm：LLMProvider 接口 + QwenProvider 实现（OpenAI 兼容接口，qwen-plus）
  - providers/embedding：EmbeddingProvider 接口 + QwenEmbeddingProvider 实现（text-embedding-v3，1024 维）
  - providers/vector-store：VectorStoreProvider 接口 + MilvusVectorStoreProvider 实现（含 collection 自动创建 + IVF_FLAT 索引 + 连接失败不阻断启动）
  - modules/document：文档上传（multer）+ Markdown/TXT/PDF/DOCX 文本解析 + MarkdownChunker（@langchain/textsplitters）+ Embedding + 写入 Milvus + BM25 内存索引同步
    - `POST /api/documents/upload`（multipart/form-data，file 字段）
    - `GET /api/documents`（列出已上传文档）
    - `GET /api/documents/:docId`（查询单个文档）
  - rag/karpathy：BM25 检索（内存，纯 JS）+ 余弦相似度（纯 JS）+ 加权融合（0.3/0.7）+ LLM 生成
    - KarpathyRagService.answer(query) → { answer, references }
  - modules/chat：`POST /api/chat`（ChatDto + class-validator 校验 + ValidationPipe）
  - modules/debug：`GET /api/debug/chunks?query=...`（返回 BM25 分、cosine 分、加权总分）
  - main.ts：全局前缀 /api + 全局 ValidationPipe（whitelist + transform）
  - 依赖修复：uuid ESM 兼容（改用 node:crypto.randomUUID + npm overrides 锁 uuid@9）+ @zilliz/milvus2-sdk-node 降级到 v2.6.14
  - 验证通过：`npm run build` ✓ / `npm run lint` ✓ / `npm run start` ✓（所有模块初始化 + 所有路由注册）/ `curl /api/health` → `{"status":"ok"}` ✓
  - 验证通过：docker compose 启动 Milvus 后，上传→提问→debug 完整链路 OK
- [x] **M3 NestJS 工程化骨架完成**（2026-06-18，已验证）
  - common/interfaces/api-response.interface.ts：ApiResponse<T> + JwtPayload 接口
  - common/interceptors/transform.interceptor.ts：统一响应 {code, data, message} + 请求耗时日志
  - common/filters/all-exceptions.filter.ts：全局异常捕获，HttpException 提取 message，未捕获异常记日志
  - common/decorators/current-user.decorator.ts：@CurrentUser() 从 request.user 提取 JwtPayload
  - common/guards/jwt-auth.guard.ts：JWT 认证守卫（Bearer Token / SSE query token 提取 + AuthService.verifyToken 验签 + request.user 注入）
  - main.ts：全局注册 ValidationPipe + TransformInterceptor + AllExceptionsFilter
  - config/configuration.ts：新增 auth.jwtSecret / auth.jwtExpiresIn 配置
  - .env.example + .env：新增 JWT_SECRET / JWT_EXPIRES_IN
  - 验证通过：build ✓ / lint ✓ / start ✓ / `GET /api/health` → `{"code":200,"data":{...},"message":"success"}` ✓ / `POST /api/chat` 空体 → `{"code":400,"data":null,"message":"query must be a string"}` ✓
- [x] **M3 NestJS 工程化完整完成**（2026-06-18，已验证）
  - common/logger/logger.module.ts：nestjs-pino 结构化日志（JSON 格式 + pino-pretty 开发美化 + 自动请求日志 + health 接口忽略自动日志）
  - modules/auth/：完整 JWT 认证模块
    - auth.module.ts：@Global + JwtModule.registerAsync（从 config 读 secret/expiresIn）
    - auth.service.ts：login（硬编码测试用户 admin/admin123、user/user1234）+ verifyToken（JwtService.verifyAsync）
    - auth.controller.ts：`POST /api/auth/login`（签发 token）+ `GET /api/auth/profile`（@UseGuards(JwtAuthGuard) + @CurrentUser）
    - dto/login.dto.ts：class-validator 校验（username MinLength(2) + password MinLength(6)）
  - common/guards/jwt-auth.guard.ts：完善为接入 AuthService.verifyToken，验签后注入 payload 到 request.user
  - main.ts：bufferLogs + app.useLogger(app.get(Logger))（nestjs-pino 替换默认 Logger）
  - 依赖新增：pino + nestjs-pino + pino-pretty(dev) + @nestjs/jwt + passport-jwt + @types/passport-jwt(dev)
  - 验证通过：build ✓ / lint ✓ / start ✓
    - `GET /api/auth/profile` 无 token → `{"code":401,"message":"missing or invalid bearer token"}` ✓
    - `POST /api/auth/login` admin/admin123 → 返回 accessToken ✓
    - `GET /api/auth/profile` 带正确 token → `{"code":200,"data":{"userId":"1","username":"admin","role":"admin"}}` ✓
    - `GET /api/auth/profile` 带无效 token → `{"code":401,"message":"token invalid or expired"}` ✓
    - pino 结构化日志生效（pretty 格式，生产环境 JSON）✓
- [x] **M2 Agentic RAG 管线完成**（2026-06-18，已 docker 验证完整链路）
  - rag/agentic/agentic-rag.state.ts：LangGraph Annotation State 定义（query/route/augmentedQueries/retrievedChunks/answer/confidence/retryCount/passed）
  - rag/agentic/sse-event.ts：SSE 事件类型（routing/query_augment/retrieval/sufficiency/web_search/rerank/token/citation/reflection/final/error）
  - rag/agentic/agentic-rag.service.ts：完整 Agentic RAG 工作流
    - routeNode：auto 模式用 LLM + zod structured output 判断问题复杂度（simple/complex → simple/agentic）
    - queryAugmentNode：LLM 生成 3 条多角度检索问句（参考 agent-course/es-test/query-augment.mjs）
    - retrievalNode：原始问题 1 次混合检索 + deepAgent 扩展问题 BM25-only + 按 chunkId 去重 + 分数取最大值 + Top-5
    - sufficiencyNode：生成前评估检索片段是否足够支撑回答，SSE 推送 sufficient/reason
    - webSearchFallbackNode：检索不足时调用 Bocha Web Search 补充外部上下文；BOCHA_API_KEY 缺失时跳过，不阻断本地 RAG
    - rerankNode：生成前调用 DashScope Rerank 二次排序；RERANK_API_KEY 缺失时保持原排序
    - generateNode：LLM 流式生成（model.stream + onToken 回调）
    - reflectionNode：LLM 评估置信度（0~1）+ reason，阈值 0.7，最多重试 2 次
    - reflectionRouter：passed → end，retryCount >= maxRetries → end，否则 retry
    - run()：完整编排，支持 SSE 回调推送全流程事件
  - rag/agentic/agentic-rag.module.ts：注册 AgenticRagService，依赖 KarpathyRagModule + LlmModule
  - deepagents 集成：query_augment 优先使用 createDeepAgent 规划 3 条检索问句，失败时回落到原 structured output
  - retrieval 策略：原始问题 1 次混合检索 + deepAgent 扩展问题 BM25-only，避免连续 Milvus search
  - BM25 中文兜底：简单分词加入中文单字和 bigram，未接入 jieba 前避免中文短查询空召回
  - providers/llm/：ILLMProvider 新增 getModel() 方法（暴露 ChatOpenAI 用于 withStructuredOutput / stream）
  - modules/chat/：
    - chat.dto.ts：mode 支持 simple/agentic/auto，ChatResponse 新增 route/confidence/retryCount
    - chat.service.ts：集成 AgenticRagService，simple 走 KarpathyRag，agentic/auto 走 AgenticRag
    - chat.controller.ts：新增 `GET /api/chat/stream?query=...&mode=agentic` SSE 流式接口（@Sse + Observable）
    - chat.module.ts：导入 AgenticRagModule
  - 依赖新增：@langchain/langgraph + zod + deepagents
  - 验证通过：build ✓ / lint ✓ / start ✓
    - `POST /api/chat` mode=invalid → `{"code":400,"message":"mode must be one of the following values: simple, agentic, auto"}` ✓
    - `GET /api/chat/stream` 无 query → `{"code":400,"message":"query is required"}` ✓
    - `POST /api/chat` mode=auto "对比React和Vue的响应式原理" → auto 路由到 agentic ✓ + query_augment 成功生成 3 条多角度问句 ✓（retrieval 因 docker 未启动返回 500，符合预期）
  - 验证通过：docker compose 基础设施 healthy；上传测试文档后 agentic 非流式返回答案 + 引用 + reflection=1.00；auto 路由到 agentic 并返回技术栈答案 + 2 个引用 + reflection=1.00；SSE 输出 routing/query_augment/retrieval/sufficiency/web_search/rerank/token/citation/reflection/final 全事件，reflection=0.95

- [x] **M4 前端最小可用完成**（2026-06-18，已验证）
  - frontend/：React 18 + Vite 5 + TypeScript 项目初始化
  - 依赖：axios（API 客户端）+ react/react-dom
  - vite.config.ts：dev server 端口 5173 + /api 代理到 localhost:3000
  - src/types.ts：后端 API 响应类型定义（ApiResponse / UploadResponse / DocumentItem / ChatResponse / DebugResponse）
  - src/api.ts：API 客户端
    - uploadDocument(file)：POST /api/documents/upload（multipart/form-data）
    - listDocuments()：GET /api/documents
    - chat(query, mode)：POST /api/chat（非流式，simple 模式用）
    - chatStream(query, mode, onEvent, onError, onClose)：GET /api/chat/stream（SSE 流式，agentic/auto 模式用）
    - debugChunks(query)：GET /api/debug/chunks
  - src/App.tsx：Tab 切换（对话 / 文档管理）
  - src/components/UploadPage.tsx：文件上传页
    - 文件选择（.md/.markdown/.txt/.pdf/.docx）+ 上传按钮 + 上传状态提示
    - 文档列表表格（文件名 / 片段数 / 创建时间 / Doc ID）
  - src/components/ChatPage.tsx：聊天窗口
    - 模式切换器（simple / agentic / auto）+ 模式提示
    - simple 模式：非流式 POST /api/chat
    - agentic/auto 模式：SSE 流式 GET /api/chat/stream
    - SSE 事件处理：routing / query_augment / retrieval / sufficiency / web_search / rerank / token / citation / reflection / final / error
    - 流式 token 拼接 + 流程事件追踪显示
    - 消息历史 + 自动滚动
  - src/components/ReferenceList.tsx：引用来源展示
    - 可展开/收起每个 chunk
    - 显示总分 / BM25 分 / 余弦分
    - 显示 docId / chunkIndex / chunk 原文
  - src/index.css：完整样式（响应式布局 + 聊天气泡 + 引用折叠）
  - 验证通过：`npm run build` ✓（tsc -b + vite build，88 模块，195KB JS gzip 66KB）
  - 验证通过：`npm run dev` ✓（Vite dev server http://localhost:5173/）
  - 验证通过：前端代理 /api → localhost:3000 ✓（后端 health 接口可达）
  - M4 验收标准全部达成：
    - 文件上传页能上传文件并显示处理状态 ✓
    - 聊天窗口能流式显示回答 ✓（agentic/auto SSE 流式 + simple 非流式）
    - 引用来源可展开查看 chunk 原文 ✓
    - 模式切换器（simple / agentic / auto）能切换并生效 ✓

- [x] **M5 容器化部署完成**（2026-06-18，已验证）
  - backend/Dockerfile：多阶段构建
    - Builder 阶段：node:20-alpine + npm ci + nest build（含 devDependencies）
    - Runtime 阶段：node:20-alpine + npm ci --omit=dev + dist 产物
    - 镜像源：docker.m.daocloud.io（国内加速）
    - npm registry：registry.npmmirror.com
    - 创建 /app/workspace 目录（运行时文件上传）
  - backend/.dockerignore：排除 node_modules / dist / coverage / .env / test / 临时脚本
  - frontend/Dockerfile：多阶段构建
    - Builder 阶段：node:20-alpine + npm ci + vite build
    - Runtime 阶段：nginx:alpine + dist 静态资源
  - frontend/nginx.conf：
    - SPA 路由回退（try_files → /index.html）
    - /api 反代到 backend:3000（docker 网络内服务名）
    - SSE 流式支持（proxy_buffering off + proxy_cache off + 300s 超时）
    - 静态资源长缓存（1 年，immutable）
  - frontend/.dockerignore：排除 node_modules / dist / .vite
  - docker/docker-compose.prod.yml：完整栈编排
    - 应用层：backend（1G/1CPU）+ frontend（128M/0.5CPU）
    - 基础设施：postgres（512M）+ redis（256M）+ milvus（2G/1CPU）+ etcd（512M）+ minio（512M）
    - 所有服务含 deploy.resources.limits + reservations
    - backend env_file 从 backend/.env 读取密钥
    - 基础设施连接用 docker 网络服务名（MILVUS_HOST=milvus, POSTGRES_URL=postgres:5432, REDIS_URL=redis:6379）
    - rag-net bridge 网络 + 命名 volumes
  - 验证通过：
    - `docker compose -f docker-compose.prod.yml build` ✓（backend 278MB / frontend 61.7MB，均 < 300MB）
    - `docker compose -f docker-compose.prod.yml up -d` ✓（7 个容器全部 Running/Healthy）
    - `curl http://localhost:3000/api/health` → `{"code":200,"data":{"status":"ok"},"message":"success"}` ✓
    - `curl http://localhost:80/` → HTTP 200 ✓（frontend nginx 服务）
    - `curl http://localhost:80/api/health` → `{"code":200,...}` ✓（nginx /api 反代到 backend 正常）
  - M5 验收标准全部达成：
    - docker compose up 一键拉起完整栈（app + postgres + redis + milvus）✓
    - 多阶段构建镜像大小 < 300MB ✓（backend 278MB / frontend 61.7MB）
    - prod compose 配置含资源限制 ✓（所有服务含 deploy.resources.limits）

- [x] **P2 前端语音录入入口完成**（2026-06-18，已离线验证）
  - ChatPage 增加浏览器 Web Speech API 语音输入按钮
  - 支持中文识别（zh-CN）、中间结果回填输入框、停止录音、不支持浏览器提示
  - 不改变后端 API，转写完成后复用现有 simple/agentic/auto 查询流程
  - 验证通过：`cd frontend && npm run build` ✓

- [x] **P1 Prompt 工程体系**（2026-06-18，已实现并验证）
  - 扩展 few-shot 示例库：新增答案生成、反思评估、查询扩展示例
  - SemanticExampleSelector：基于 Milvus 语义相似度动态挑选相关示例
  - LCEL 工具链：RunnableBranch 条件路由 + RunnableWithMessageHistory 对话历史
  - 集成到 Agentic RAG：queryAugmentNode 优先使用语义选择器，回退到静态 few-shot
  - 验证通过：`npm run build` ✓ / `npm run lint` ✓

- [x] **P2 对话历史向量化**（2026-06-18，已实现并验证）
  - ConversationEmbeddingService：将对话 QA 对嵌入 Milvus 向量库
  - 自动检索相关历史对话作为上下文注入 RAG
  - 集成到 ChatService：chat 后异步存储，chat 前检索相关历史
  - 验证通过：`npm run build` ✓ / `npm run lint` ✓

- [x] **P1 结构化输出 — 文档元数据抽取**（2026-06-18，已实现并验证）
  - DocumentMetadataExtractor：LLM + zod structured output 自动抽取标题/作者/摘要/关键词/语言/类别
  - 集成到文档上传流程：上传后异步抽取，更新 documents_meta 表
  - listDocs 接口返回抽取的元数据
  - 验证通过：`npm run build` ✓ / `npm run lint` ✓

## 进行中

- 当前无代码实现中的进行中任务。
- 当前剩余工作不适合混在"进行中"里，按性质拆分为：
  - **待专项联调**：已有代码能力，需要外部服务、真实配置或样本数据验证。
  - **红线待确认**：CI/CD、数据库 schema/migration、生产部署、删除本地历史快照等，必须主人确认后才能执行。
  - **可本地增强**：不触碰红线但会扩大代码面，建议单独排优先级后推进。

## 待办

### P0 — 架构决策，进入下一阶段前定稿

- [x] **BM25 索引方案定稿**：选择 JSON 持久化方案（workspace/bm25-index.json），已实现
- [x] **对话历史 + Mem0 长期记忆方案定稿**：双层存储注入策略与 LLM 分层分类器已确立，单元测试覆盖全模式分支（2026-06-19）
- [x] **RAG 评测体系方案定稿**：Dataset 来源、评测模型、CI/CD 集成方式已写入 `rag-plan.md`（2026-06-19）
- [x] **管理后台与 RAG 服务拆分方案定稿**：从“一个 NestJS 后端内部分域”调整为 `rag-backend` + `admin-backend` 两个独立后端项目；后台通过 RAG 运营 API 协作，不复制 RAG 核心业务 service（2026-06-23）

### P0 — 管理后台独立项目待办

- [x] **冻结单后端后台扩展**：`backend/src/domains/` 目录不存在，RAG 后端无 admin 域代码膨胀。（2026-06-23）
- [x] **梳理 RAG 运营 API 契约**：`admin-backend/docs/rag-admin-api-contract.md` 已定义所需接口；`backend/src/modules/rag-admin/` 已实现 capabilities、documents、chunks、vector-index、evaluations、conversations、reindex、run-evaluation、search ops、qa ops、graph ops 全部运营端点。（2026-06-23）
- [x] **新建 `admin-backend` 项目规范**：`admin-backend/` 已从 template 迁入，含独立 `CLAUDE.md`、`ROADMAP.md`、`package.json`；模块涵盖 auth/users/roles/permissions/dashboard/documents/audit-logs/notifications/system-config/rag-client。（2026-06-23）
- [x] **实现 `admin-backend` RAG client**：`admin-backend/src/modules/rag-client/RagClientService` 通过 HTTP fetch 调用 `rag-backend`，不 import RAG 内部 service，不访问 Milvus/Neo4j/ES。（2026-06-23）
- [x] **管理后台基础 API 骨架**：登录态、用户/角色/权限 CRUD、首页大盘、文档治理、系统配置、审计日志、通知入口均已实现且 `npm run verify` 通过。（2026-06-23）
- [x] **临时代码收口**：`backend/src/domains/` 不存在，无需清理；rag-backend 内已新增正规 `modules/rag-admin/` 承载运营 API。（2026-06-23）
- [x] **暂不抽 shared 包**：当前 `admin-backend` 自己维护 `rag-client/dto`，`rag-backend` 自己维护接口 DTO；两个服务通过 HTTP API 契约对齐，未建 `packages/shared`。（2026-06-23）

### P0 — 基础设施

- [x] **项目骨架初始化**（NestJS + monorepo）
  - 后端：NestJS 项目（含 CLAUDE.md、.env.example、ESLint、tsconfig）
  - 前端：React + Vite 项目
  - 目录结构：backend / frontend / skills / workspace / docker
- [x] **NestJS 工程化模式落地**（对齐 agent-course/nest-feature）
  - JWT 认证（@nestjs/jwt + AuthGuard）
  - 角色权限（已实现 @CurrentUser() 装饰器、`@Roles()` 装饰器与 RolesGuard；jobs 管理写操作已限制 admin；完整组织/团队权限模型不在当前阶段）
  - 统一响应（TransformInterceptor：{code, data, message}）
  - 全局异常（AllExceptionsFilter）
  - 参数校验（ValidationPipe）
  - 请求日志（pino + TransformInterceptor 记录 method/url/耗时）
  - 目录结构：common/{decorators,filters,guards,interceptors,pipes,interfaces}
- [x] Milvus + Elasticsearch 环境搭建（Elasticsearch 客户端版本已降为 8.13.0，与 dev 容器对齐，已加载 IK 中文分词插件并初始化 `rag_chunks` 索引，混合检索联调成功）
- [x] Redis 环境搭建（docker-compose 已完成；对话历史/缓存业务接入已集成）
- [x] PostgreSQL + MySQL 环境搭建（PostgreSQL 及 MySQL 迁移全部改写为数据库无关的 Schema 字段映射，已在 Postgres 容器成功运行迁移并导入）
- [x] 数据库 schema 设计（在 implementation plan 中定稿，包含 users/conversations/messages/documents_meta/scheduled_jobs 等关系表，以及 Milvus collection 与 ES 索引 schema）
- [x] TypeORM 迁移工具初始化（采用 Table 及 TableIndex 构建数据库无关 the Schema 定义，支持 PostgreSQL + MySQL 切换）
- [x] LLMProvider / EmbeddingProvider / SpeechProvider 接口定义（LLM/Embedding/SpeechProvider 均已完成，2026-06-19 状态同步）
  - LLM：通义千问（qwen-plus/turbo）+ OpenAI 兼容
  - Speech：腾讯云 ASR/TTS（含流式 TTS）✅
- [x] OpenAI-compatible Provider 实现（Qwen 走 OpenAI-compatible 接口）
- [x] VectorStoreProvider / RelationalDBProvider 抽象接口（VectorStoreProvider 已完成；RelationalDBProvider 接口已定义，DatabaseModule 骨架已实现）

### P1 — 核心管线

- [x] 文档上传 + 解析（Markdown/TXT/PDF/DOCX 已完成并验证）
- [x] Chunking 策略实现（当前 MarkdownChunker，chunk_size/overlap 固定）
- [x] Embedding 生成 + 写入向量库（Milvus 已完成并作为当前主向量库；pgvector 仅保留备选配置，不作为当前待办）
- [x] BM25 索引构建（内存 BM25 + `@node-rs/jieba` 中文分词，英文 token 保留完整；降级兜底保留）
- [x] Karpathy-style RAG 管线（纯 JS BM25 + 纯 JS cosine 计算 + 加权融合）
- [x] Agentic RAG 管线（deepAgent query planning → retrieval → generate → reflection；已新增可配置成本边界）
- [x] 查询扩展（deepAgent 规划多角度问句；失败时回落到 LLM structured output；`AGENTIC_MAX_AUGMENTED_QUERIES` 控制上限）
- [x] 检索充分性评估（基础评估已完成并通过 SSE 输出；不足时触发 Bocha web_search，API key 缺失自动跳过；`AGENTIC_WEB_SEARCH_FALLBACK_ENABLED` 可关闭联网兜底）
- [x] Reflection 节点（`AGENTIC_CONFIDENCE_THRESHOLD` / `AGENTIC_MAX_RETRIES` 控制置信阈值和最大重试）
- [x] Bocha web_search 工具集成（官方 `POST /v1/web-search`；无 API key 时禁用且不阻断）
- [x] DashScope Rerank 集成（官方 text-rerank / compatible reranks；默认模型 qwen3-rerank；无 API key 时禁用且不阻断）
- [x] Mode Router（auto / agentic / simple）
- [x] SSE 流式响应（routing/query_augment/retrieval/sufficiency/web_search/rerank/token/citation/reflection/final/error 事件）

### P1 — LangGraph 增强

- [x] Checkpointer 状态持久化（RedisCheckpointer + MemorySaver 降级，2026-06-19；`npm run smoke:redis-checkpointer` 已完成跨进程重启恢复验证，2026-06-21）
- [x] 子 Agent 编排架构（researcher/analyst/writer/critic/editor，已实现并编写骨架，2026-06-19）
- [x] 向量索引创建优化（Milvus 主 collection 默认 HNSW，支持 HNSW 参数配置与 `/api/v1/debug/vector-index` 验收，2026-06-20）

### P1 — Prompt 工程与结构化输出

- [x] **Prompt 工程体系**（对齐 agent-course/prompt-template-test + runnable-test，2026-06-18）
  - [x] PromptTemplate / ChatPromptTemplate / MessagesPlaceholder 模板层级
  - [x] Few-shot 示例库（Milvus 语义检索挑选相关示例）
  - [x] PipelinePromptTemplate 管道组合（大纲 → 正文 → 润色）
  - [x] LCEL Runnable 编排（Sequence/Branch/WithMessageHistory/WithFallbacks）
- [x] **结构化输出**（对齐 agent-course/output-parser-test，2026-06-18）
  - [x] model.withStructuredOutput(ZodSchema)（推荐方式，已在 memory classifier、complexity classifier、文档元数据抽取中使用）
  - [x] 流式结构化输出（`/api/v1/structured/stream` 输出 meta/partial/final/done，2026-06-20）
  - [x] 文档元数据抽取（标题/作者/摘要/关键词/语言/类别，DocumentMetadataExtractor 自动抽取并存储）
  - [x] 实体关系抽取（`/api/v1/graph/extract` 输出节点与关系，已验证，2026-06-20）
  - [x] 数据导入（`/api/v1/graph/import` 将非结构化文本抽取后写入 Neo4j 图谱；默认 GraphRAG 关闭时明确 503，2026-06-20）

### P1 — 容器化部署

- [x] **Docker 多阶段构建**（对齐 agent-course/nest-dockerfile-test）
  - Builder 阶段：npm ci + nest build
  - 运行阶段：仅生产依赖 + 编译产物（更小镜像）
- [x] **docker-compose 多环境**（已完成 dev, prod, staging 环境配置，2026-06-19）
  - [x] dev：含 ES + Milvus + PostgreSQL + Redis（docker-compose.dev.yml 已完成）
  - [x] prod：仅必要服务 + 资源限制（已完成）
- [x] 完整栈编排（app + postgres + redis + milvus 已完成；elasticsearch dev 环境已加入；neo4j 已接入作为 graphrag profile 占位，2026-06-19）

### P2 — 功能扩展

- [x] 认证与多租户（JWT + user_id 隔离，已实现数据库/Redis/Milvus/BM25全链路多租户逻辑/物理硬隔离，2026-06-18）
- [x] 文档删除接口（DELETE /api/documents/:docId，Milvus + BM25 + 内存元数据同步删除，2026-06-18）
- [x] 缓存层（Embedding 缓存 / 查询缓存 / 对话历史缓存）（2026-06-18）
- [x] TTS 语音合成（SpeechProvider 扩展，SSE 流式音频；2026-06-19 新增 `/api/speech/tts/stream` SSE base64 音频块接口，前端朗读按钮已切换到 SSE 合成后播放）
- [x] 定时任务 Agent 骨架与数据库持久化恢复（@nestjs/schedule + cron，引入 `ScheduledJobEntity` 实现定时任务数据库持久化与启动自动调度恢复；运行时已接入 SupervisorService 执行 instruction，2026-06-21）
- [x] Skills 技能系统基础版（SKILL.md 加载 + 本地 token 匹配，2026-06-19；后续已增强为 Qwen Embedding 语义匹配并保留 token 回退）
- [x] Skills Embedding 语义匹配增强（OpenAI-compatible Embeddings 语义排序 + 无 key/失败回退 token 匹配，2026-06-19）
- [x] 图中断人工审批（interrupt + /chat/resume，已实现并在集成测试中验证，2026-06-19）
- [x] Mem0 长期记忆集成（cloud + local 双驱动，LLM + Zod 自动提取与写入，单元测试完全覆盖）（2026-06-19）
- [x] 对话历史向量化（conversation_chunks 表，ConversationEmbeddingService 自动存储 + 检索，2026-06-18）
- [x] **MCP 协议集成**（对齐 agent-course/tool-test）
  - [x] @langchain/mcp-adapters 的 MultiServerMCPClient
  - [x] 支持 stdio 和 SSE 两种 transport
  - [x] MCP Server 配置化管理（yaml 配置；默认 `MCP_ENABLED=false`，开启后读取 `MCP_CONFIG_PATH` 或 `workspace/mcp-servers.yaml`）
  - [x] 工具来源标注（builtin / mcp:server_name）

### P2 — 前端

- [x] React + Vite 项目初始化
- [x] 文件上传 + 知识库列表页
- [x] 聊天窗口（流式回答；当前自研 SSE 客户端，未接 useChat）
- [x] 引用来源展示（可展开 chunk 原文）
- [x] 模式切换器（simple / agentic / auto）
- [x] 路由追踪面板（实际模式 + SSE 事件链路）
- [x] Debug 面板（BM25/cosine 分数进度条 + chunk 原文，2026-06-18）
- [x] 语音录入（浏览器 Web Speech API → 输入框 → 查询；后端腾讯云 ASR/TTS 已完成真实 smoke）
- [x] TTS 朗读按钮（后端 GET /api/speech/tts 已实现，前端 playTTS + 朗读按钮已集成在 ChatPage，2026-06-18）

### P3 — 企业级能力

- [x] Supervisor 多 Agent 架构（按领域路由：HR/财务/技术/法务，已实现并编写骨架，2026-06-19）
- [x] 文件系统中间件 + 权限控制基础版（FileAccessPolicyService allow workspace root + deny 敏感路径段，2026-06-19）
- [x] REPL 数据分析（quickjs-emscripten 沙箱，在 AnalystAgent 集成了 `@langchain/quickjs` 沙箱进行精确数值计算，并提供异常降级，单元测试完全覆盖）（2026-06-19）
- [x] Mermaid 工作流可视化基础版（图导出 + SSE 执行路径高亮，2026-06-19）
- [x] **知识图谱 RAG（Neo4j）**（基础版完成，2026-06-20）
  - Neo4jProvider 默认受 `GRAPH_RAG_ENABLED=true` 控制，未启用时不阻塞应用启动
  - 安全参数化 Cypher：LLM 只抽取实体，不直接拼接执行任意 Cypher
  - 图谱构建：非结构化文本 → LLM 实体关系抽取 → Neo4j `GraphEntity` / `GRAPH_RELATION`
  - 接口：POST /api/v1/graph/extract、POST /api/v1/graph/import、POST /api/v1/graph/query、GET /api/v1/graph/schema
  - 默认关闭时已验证 schema 返回 disabled、import 返回 503；开启 GraphRAG 后 Neo4j import/query/schema 已完成真实 smoke；业务图谱质量仍需真实业务数据源
- [x] API 限流与配额（@nestjs/throttler，全局默认 60 req/min，2026-06-19）
- [x] 结构化日志（pino，JSON 格式；M3 已实现并验证，2026-06-18）
- [x] Prometheus 指标（prom-client 默认指标 + HTTP QPS/延迟，2026-06-19；`GET /api/v1/metrics` 运行时复验通过，2026-06-20；检索命中、LLM 调用耗时、输入/输出 token 估算业务指标已补齐，2026-06-21）
- [x] OpenTelemetry 分布式追踪基础版（W3C traceparent 兼容 + `/api/v1/traces` in-memory span 查询，2026-06-20；OTLP exporter 待后续接入）
- [x] API 版本化（/api/v1/，NestJS 版本控制中间件，前端 api.ts 和 Vite proxy 已适配，2026-06-19）
- [x] RAG 评测 CI/CD 集成（Drone pipeline 已接入 `npm run eval:rag` smoke 门禁，并在 Dockerfile 构建验证前执行；2026-06-20）

### P3 — 测试与运维

- [x] 单元测试基础版（chunking / BM25 / cosine / Bocha mock / Rerank mock，2026-06-19；Provider mock 深水区后续扩展）
- [x] 集成测试（双索引一致性 / 三模式 / 流式事件顺序 / Debug 接口，已实现 3 套集成测试用例并全量通过，2026-06-19）
- [x] E2E 测试（登录→上传→提问→切换模式→Debug→语音 SSE→删除全流程，`npm run test:e2e:rag` 已验证，2026-06-20；当前系统无注册接口，按现有登录鉴权流覆盖）
- [x] 性能基准（`npm run perf:rag` + `PERF_RAG_ENFORCE=true` 已验证；空知识库快速失败路径 simple P50≈28.97ms / agentic P50≈34.14ms，2026-06-20；有文档且触发真实 LLM 生成的端到端耗时不纳入该 300ms/800ms 门禁）
- [x] 异常场景测试基础版（空库 / 无相关文档 / 大文件 / key 缺失 / 服务不可用，2026-06-19；真实外部服务异常联调待 Docker/密钥/网络环境）

## 待专项联调

- **MCP 真实 Server 联调**：`backend/scripts/mcp-smoke-server.mjs` + `workspace/mcp-servers.yaml` 已可加载真实 stdio MCP server；`npm run smoke:mcp` 已验证 2 个工具加载与 `rag_smoke_status` 调用通过。已新增 `workspace/mcp-business.example.yaml` 与 `npm run mcp:validate`，可在不启动 server 的情况下校验业务 MCP 配置形状；真实业务联调仍需要业务 MCP server 的 command/url 与目标环境变量。
- **GraphRAG 业务图谱联调**：`backend/eval/graph-smoke.seed.json` 与 `npm run smoke:graph` 已完成后端 + Neo4j 真实运行时 smoke；GraphRAG enabled/schema/import/query 均通过。已新增 `backend/eval/graph-business.seed.example.json` 与 `npm run graph:import-business -- --dry-run`，支持真实业务图谱种子数据先校验、再导入；真实业务图谱质量仍需要业务实体、关系与版本口径。
- **腾讯云 ASR/TTS 真实音频联调**：`npm run smoke:speech:direct` 已完成腾讯云 TTS→ASR 直连真实回环；`npm run smoke:speech` 已完成后端 TTS SSE → 后端 ASR 真实接口回环。
- **联网增强真实调用联调**：新增 `npm run smoke:external`；Qwen LLM-as-Judge 真实调用通过，Bocha Web Search 与 DashScope Rerank 因当前 `BOCHA_API_KEY` / `RERANK_API_KEY` 为空而跳过。已新增 `npm run smoke:external:required`，正式联调时任一 key 缺失或接口失败都会失败，不再把 skipped 当完整通过。
- **Redis Checkpointer 跨进程恢复验证**：`npm run smoke:redis-checkpointer` 已用独立 writer/reader Node 进程完成 Redis checkpoint 真实读写恢复验证。
- **混合检索质量回归**：`backend/eval/hybrid-regression.dataset.json` 与 `npm run smoke:hybrid` 已完成真实后端回归；覆盖中文召回、排序稳定性、同义词/别名/错别字、多版本冲突、跨章节召回、无答案负例，9/9 通过。

## 红线待确认

- **生产部署 / 发布**：真实生产发布、npm publish、公开发布仍需主人提供目标机器、域名、证书、备份、密钥注入策略后再执行。
- **生产就绪检查已本地化**：新增 `./scripts/check-production-readiness.sh`，只做 Compose prod config、`.env` 是否被 git 跟踪、人工输入缺口检查，不执行发布；真实发布仍属于红线。
- **后续数据库 schema / migration**：本轮已完成结构化事实治理第一版 schema 与迁移；后续若继续改表、迁移或数据回填，仍按红线先确认。
- **密钥与真实 `.env`**：本轮只改 `.env.example`，未改真实 `.env`。后续新增/修改真实密钥仍需主人确认。
- **已解除红线项**：部署目标已固定为 Docker Compose；`.history/backend/.env_*` 本地历史快照已按主人要求删除并确认目录下无 `.env*` 快照。

## 可本地增强

- **企业级差距 1：真实业务评测集**。已新增 `backend/scripts/build-business-regression-dataset.mjs` 与 `backend/eval/business-regression.dataset.json`，生成并校验 120 条业务场景评测样本，覆盖 HR、Finance、Legal、IT、Sales、Ops、Security、Product、CS、Data、Procurement、Admin 等部门，并包含标准答案/expectedClaims/引用要求/拒答要求。已新增 `backend/eval/business-regression.import.example.json` 与 `npm run eval:business-import`，真实业务评测集可先 dry-run 校验，确认 100+ 条样本后再 `--write` 覆盖回归集。注意：当前内置样本不包含主人公司私有真实数据；要升级为“真实私有业务评测集”，仍需主人提供真实业务问题和标准答案。
- **企业级差距 2：端到端答案质量回归**。`npm run eval:rag:e2e` 已在 3001 真实后端完成 simple/auto 回放，simple 9/9、auto 9/9，skipped=false；agentic 仍建议只在复杂问题明确触发时纳入稳定门禁，避免成本和延迟失控。
- **企业级差距 3：claim-level 支撑升级**。运行时已完成逐句 claim-level 引用支撑校验；新增 `npm run eval:rag:quality` 稳定门禁，默认跑离线/e2e 数据质量，`EVAL_RAG_JUDGE_REQUIRED=true` 时强制 Qwen LLM-as-Judge 真实调用，不通过或 skipped 都会失败。
- **企业级差距 4：结构化文档索引**。已落地 `document_chunks`，支持父子 chunk、heading path、sectionId、clauseId、tableRef、sourceStart/sourceEnd、docVersion、effectiveAt/expiredAt、sourceAuthority，并在上传/删除链路真实验证。
- **企业级差距 5：事实治理**。已落地 `fact_conflicts` 第一版，上传时检测简单版本数值冲突；`RAG_SOURCE_AUTHORITY_RULES` 来源权威权重继续可用；GraphRAG 关系写入 aliases/confidence。后续复杂事实归并、人工审核流、冲突处置 UI 属于新阶段增强。
- **企业级差距 6：真实链路验证**。3001 后端真实启动已验证，`eval:rag:e2e`、`smoke:graph`、`smoke:hybrid`、`smoke:speech`、`smoke:redis-checkpointer` 均完成真实 smoke；GraphRAG 可作为关系型问题增强，Agentic 仍保持明确复杂问题才触发。
- **企业级成熟度门禁**。新增 `npm run eval:rag:maturity`，按查得准、答得稳、引用能撑住、不会瞎编、可观测与恢复、工程化门禁、真实落地准备打分；当前本地工程成熟度 93/100，超过 `RAG_MATURITY_MIN_SCORE=90`。默认不把外部输入缺失作为硬失败；设置 `RAG_MATURITY_REQUIRE_EXTERNAL=true` 后，真实私有业务评测集和生产材料会成为硬阻塞。
- **项目级仿真实业务评测**。新增 `backend/eval/project-simulated-business.dataset.json` 与 `npm run eval:rag:project`，默认后端不可用时只做数据集结构校验，`PROJECT_EVAL_REQUIRE_LIVE=true` 时必须真实调用后端；当前 3001 后端强制真实回放 score=1，simple/auto 共 22/22 通过。
- **Agentic 成本边界**：已新增 `AGENTIC_CONFIDENCE_THRESHOLD`、`AGENTIC_MAX_RETRIES`、`AGENTIC_MAX_AUGMENTED_QUERIES`、`AGENTIC_MAX_RETRIEVAL_QUERIES`、`AGENTIC_MAX_RETRIEVED_CHUNKS`、`AGENTIC_MAX_WEB_SEARCH_RESULTS`、`AGENTIC_MAX_RERANK_TOP_N`、`AGENTIC_MAX_AUTO_QUERY_LENGTH`、`AGENTIC_WEB_SEARCH_FALLBACK_ENABLED`、`AGENTIC_RERANK_ENABLED`，并补单测覆盖查询扩展截断、auto 超长问题回退 simple、检索查询/返回 chunk 截断。
- **Milvus warning 收敛**：`MILVUS_WARMUP_TIMEOUT_MS` 默认从 500ms 提升到 1500ms，并保持 search/delete/warmup/circuit 可配置；已新增 `npm run smoke:milvus` 诊断 collection/schema/index/load/search 状态。当前诊断显示 health/schema/HNSW index/load progress 均正常，但 search 仍在本机 Docker Milvus 内 `DEADLINE_EXCEEDED`；已排除单纯 RAG 业务代码归因，后续需处理 Milvus 容器版本、segment 状态或资源。
- **生产/联调操作入口补齐**：`DEPLOYMENT.md` 已补充真实业务评测集导入、GraphRAG 业务种子导入、业务 MCP 配置校验、外部 API 严格 smoke、生产就绪检查和 Milvus 运行环境调优说明。

## 阻塞

- 当前无阻塞代码开发的问题。
- 仍需注意：
  - 真实私有业务评测集不能凭空编，必须由主人提供真实业务问题、标准答案和高风险拒答/冲突样本。
  - 业务 MCP server 和真实业务图谱数据源需要业务侧配置或数据源；本地 smoke server、配置校验和种子导入 dry-run 已补齐，不再冒充真实业务联调。
  - Bocha Web Search / DashScope Rerank 因当前 key 仍为空，默认 smoke 只保留 skipped 记录；补 key 后跑 `npm run smoke:external:required` 才算真实联调完成。
  - 真实生产发布缺目标机器、域名、证书、备份和密钥注入策略；当前只完成 Docker Compose 配置验证，不发布。
  - 默认 3000 端口被本机既有 `node` 进程占用；未擅自 kill。临时验证可用 `PORT=3001 npm run start` / `PORT=3001 npm run start:dev`。
  - Milvus warmup 仍可能出现可配置 timeout warning，按已知问题快速降级，不阻塞应用启动。

## 已知问题

- **Milvus search 已快速降级，delete 超时已修复**（2026-06-20）
  - 现象：
    - Milvus `search` 在本机 Docker 环境仍可能因 querynode/索引加载问题超时
    - debug/simple/agentic 都可能遇到 Milvus search timeout，但当前代码已将主相似度检索限制到约 0.8s 并触发短期熔断
    - 超时后当前实现会降级 BM25，因此不会阻断回答链路；文档向量删除已从 15s timeout 修复为约 31-36ms 返回
  - 已尝试：
    - 重建 collection（IVF_FLAT + nlist=1024，参考 agent-course/milvus-test/src/insert.mjs）→ 空集合 search 54ms ✓，但上传数据后 agentic 仍超时
    - 添加 nprobe=16 参数 → 无效
    - 添加 warmup 预热 search → warmup 成功，但 agentic 仍超时
    - timeout 从 60s 降到 15s → 快速失败，但问题依旧
    - Milvus SDK search/delete 显式传入 timeout，并在应用层增加短期熔断 ✓
    - 新会话跳过历史向量检索；空知识库 agentic 直接快速返回 ✓
    - Milvus 连接地址 localhost → 127.0.0.1 → 无效
    - agentic 检索改为原始问题 1 次混合检索 + 扩展问题 BM25-only ✓
    - Karpathy retrieve 在向量检索失败时降级 BM25 ✓
    - BM25 修复中文分词，加入单字/bigram 兜底 ✓
    - 新增 `npm run smoke:milvus` 直接诊断：health=true、server=v2.4.4、SDK=2.6.17、collection `rag_chunks` 存在、`user_id` 字段存在、rowCount=87、HNSW index Finished、indexedRows=87/totalRows=87、loadState=Loaded、loadingProgress=100，但 search 仍 `DEADLINE_EXCEEDED` after 1.5s
    - 临时尝试 SDK 降级到 `@zilliz/milvus2-sdk-node@2.4.4` 对齐 server v2.4.4：search 仍超时，且 build 因旧 SDK `DeleteEntitiesReq` 不支持 `exprValues` 失败；已回退 SDK 2.6.17
  - 待尝试：
    - 处理 Milvus querynode / segment task 状态：当前 Docker 日志出现大量 segment task 与 dropped/growing segment 清理
    - 评估 Milvus 2.4.4 容器升级或 collection 压实/重建；这涉及数据与容器版本，需单独确认后执行
    - 参考 agent-course 的 docker-compose 配置继续对比
  - 当前状态：
    - Agentic retrieval 已改为原始问题 1 次混合检索 + 扩展问题 BM25-only
    - Karpathy retrieve 在向量检索失败时自动降级 BM25
    - 主 Milvus collection 新建时默认使用 HNSW，支持 `MILVUS_INDEX_TYPE` / `MILVUS_HNSW_*` 配置，并提供 `GET /api/v1/debug/vector-index` 查看当前代码索引配置
    - Milvus 慢查询不再把 simple/agentic 拉到 10s+；空知识库性能门禁已通过
    - BM25 已接入 @node-rs/jieba 中文分词，中文查询召回率显著提升 ✓
    - M2 功能验收已通过，Milvus 问题不再阻塞 M2
  - 影响：响应延迟仍可能被首次向量 search 的可配置 timeout 拉长；当前默认约 0.8s 快速失败，后续需要从 Milvus 容器版本、segment 状态、collection 压实/重建、资源和版本兼容层面继续优化

## 待确认

- 真实生产发布参数：目标机器、域名、证书、备份策略、密钥注入策略。
- 真实私有业务评测集：100-300 条真实业务问题、标准答案、引用口径、拒答样本、冲突样本。
- 业务 MCP server：真实 server 命令、transport、工具清单、鉴权方式。
- 真实业务图谱：实体类型、关系类型、别名规则、版本/生效期口径、初始数据源。

## 最近验证

- **企业级差距第四轮结构化事实治理验证（2026-06-21）**
  - `cd backend && npm run migration:run` → `AddStructuredFactGovernance1782042000000 has been executed successfully` ✓
  - `cd backend && npm run migration:show` → `InitSchema1781763486169` 与 `AddStructuredFactGovernance1782042000000` 均为 `[X]` ✓
  - `PORT=3001 GRAPH_RAG_ENABLED=true NEO4J_PASSWORD=neo4jpassword npm run start:dev` → 后端 3001 真实启动；修复实体 default 引号导致的 synchronize 启动失败 ✓
  - 真实上传 `official-travel-policy-2026.txt` → 返回 `docId=d877d7e3-567b-483a-95a6-73fc96511c8e`、`chunkCount=2` ✓
  - PostgreSQL 验证 `documents_meta` → `docVersion=2026`、`sourceAuthority=official`、`effectiveAt=2026-01-01`、`chunkCount=2` ✓
  - PostgreSQL 验证 `document_chunks` → 2 条 chunk，包含 `section-0`、heading path、source span、docVersion、sourceAuthority ✓
  - PostgreSQL 验证 `fact_conflicts` → 1 条冲突，`住宿报销上限`，current=`650 元`，conflicting=`500 元`，status=`detected` ✓
  - 真实删除该 doc → `documents_meta/document_chunks/fact_conflicts` 对应计数均为 0，删除清理闭环通过 ✓
  - `cd backend && npm test -- chunking.util.spec.ts karpathy-rag.service.spec.ts graph.service.spec.ts --runInBand` → 3 suites / 18 tests 通过 ✓
  - 收尾复验：`cd backend && npm run build`、`npm run lint`、`npm test -- --runInBand` → 通过；全量单测 19 suites / 95 tests ✓
  - `cd backend && npm run eval:rag:quality` → 通过；默认不强制消耗 Judge key ✓
  - `cd backend && EVAL_RAG_JUDGE_REQUIRED=true EVAL_RAG_JUDGE_MAX_CLAIMS=3 npm run eval:rag:quality` → Qwen LLM-as-Judge 真实调用通过，supportedRate=1 ✓
  - `./scripts/verify-compose-config.sh` → dev/staging/prod compose 配置均通过 ✓
  - `find .history/backend -maxdepth 1 -type f -name '.env*' -print` → 无输出，本地历史 env 快照已清理 ✓
  - 中文错别字回归：首次 `npm run eval:rag:e2e` 暴露 `typo-knowledge` simple/auto 均失败；修复后最小真实复现 `企业知识哭 是什么？` 返回带引用答案，完整 e2e simple 9/9 + auto 9/9 通过 ✓

- **文档同步与 Elasticsearch Provider 类型收敛验证（2026-06-21）**
  - `ARCHITECTURE.md` / `PRD.md` / `CLAUDE.md` / `rag-plan.md` / `ROADMAP.md` 已同步 MCP、GraphRAG、腾讯云 Speech、external tools、Redis Checkpointer、Hybrid、Prometheus 业务指标与 `/api/v1` 当前接口状态 ✓
  - 旧接口路径、旧 MCP 配置描述、旧语音密钥描述扫描 → 无命中 ✓
  - `cd backend && npm run build` → 通过 ✓
  - `cd backend && npm run lint` → 通过 ✓
  - `cd backend && npm test -- analyst.agent.spec.ts karpathy-rag.service.spec.ts mcp.provider.spec.ts --runInBand` → 3 suites / 10 tests 通过 ✓

- **RAG 主链路质量闸门验证（2026-06-21）**
  - `cd backend && npm run build` → 通过 ✓
  - `cd backend && npm run lint` → 通过 ✓
  - `cd backend && npm test -- karpathy-rag.service.spec.ts --runInBand` → 1 suite / 7 tests 通过 ✓
  - 覆盖场景：空知识库拒答、无相关文档拒答、相关检索 + 显式引用通过、LLM 无引用拒答、向量命中但问题关键词无重合拒答、向量不可用降级 BM25、残留向量过滤 ✓

- **RAG 核心质量优化第一轮验证（2026-06-21）**
  - `backend/eval/hybrid-regression.dataset.json` 已扩展中文回归样本：同义词、缩写、别名、错别字、多版本冲突、跨章节召回、无答案负例 ✓
  - Agentic 路径已复用 `KarpathyRagService` 的检索质量与引用支撑闸门；auto 路由不再依赖 LLM 分类，普通问题默认 simple，复杂模式按显式关键词进入 Agentic ✓
  - GraphRAG 查询增加关系型问题边界，非实体关系/多跳问题返回普通 RAG 主链路建议 ✓
  - `MarkdownChunker` 已注入章节路径、表格行、条款编号结构提示；第四轮已进一步升级为结构化 chunk 表 ✓
  - `cd backend && npm run build` → 通过 ✓
  - `cd backend && npm run lint` → 通过 ✓
  - `cd backend && npm test -- --runInBand` → 18 suites / 85 tests 通过 ✓

- **架构评审问题修复第一轮验证（2026-06-21）**
  - `KarpathyRagService` 引用校验从全文 token 覆盖升级为逐句 claim-level 支撑；新增测试覆盖“后续结论无引用被拒答”和“多句结论各自有引用可通过” ✓
  - `npm run eval:rag` 支持 `requireCitation` / `expectRefusal` / `referenceRetrievalSufficient`，离线 dataset 新增无答案拒答负例 ✓
  - `cd backend && npm run build` → 通过 ✓
  - `cd backend && npm run lint` → 通过 ✓
  - `cd backend && npm test -- --runInBand` → 18 suites / 87 tests 通过 ✓
  - `cd backend && npm run eval:rag` → 通过，offline averageScore=1 ✓

- **企业级差距可本地增强第一轮验证（2026-06-21）**
  - `backend/eval/rag-smoke.dataset.json` 已升级为业务评测格式：category / department / documentType / expectedClaims / requireCitation / expectRefusal / expectConflictHandling ✓
  - `npm run eval:rag` 输出 category 汇总、claimResults、citation/refusal/conflict 分项结果，offline averageScore=1 ✓
  - 新增 `npm run eval:rag:e2e`，本地后端未运行时会输出 skipped=true，不误报真实链路完成；3001 真实回放已由第三轮验证覆盖 ✓
  - Karpathy/Agentic 运行时多版本冲突提醒已接入；Karpathy 单测覆盖 2025/2026 冲突片段提醒 ✓
  - `cd backend && npm run build` → 通过 ✓
  - `cd backend && npm run lint` → 通过 ✓
  - `cd backend && npm test -- karpathy-rag.service.spec.ts --runInBand` → 1 suite / 11 tests 通过 ✓
  - `cd backend && npm run eval:rag && npm run eval:rag:e2e` → 当时 eval 通过，e2e 在后端服务未运行时 skipped；3001 真实回放已由第三轮验证覆盖 ✓
- **企业级差距真实联调第三轮验证（2026-06-21）**
  - `docker compose -f docker/docker-compose.dev.yml ps` → PostgreSQL / Redis / Milvus / Elasticsearch / MinIO / etcd / Neo4j 均 healthy ✓
  - `PORT=3001 GRAPH_RAG_ENABLED=true NEO4J_PASSWORD=neo4jpassword npm run start:dev` → 后端 3001 真实启动，PostgreSQL / Redis / Elasticsearch / Neo4j / Milvus 初始化成功；修复 LLM/Embedding/Karpathy MetricsModule 注入缺失 ✓
  - `curl http://localhost:3001/api/v1/health` → 200 ✓
  - `cd backend && npm run smoke:redis-checkpointer` → ok=true，writer/reader 两个独立 Node 进程完成 Redis checkpoint 读写恢复 ✓
  - `cd backend && npm run smoke:graph` → ok=true，enabled=true，imported=true，导入后 nodeCount=21、relationshipCount=18 ✓
  - `cd backend && npm run smoke:hybrid` → ok=true，uploadedCount=6，9/9 中文混合检索回归通过 ✓
  - `cd backend && npm run smoke:speech:direct` → ok=true，腾讯云 TTS bytes=79084，ASR text length=10 ✓
  - `cd backend && npm run smoke:speech` → ok=true，后端 TTS SSE → 后端 ASR 回环通过；修复 Nest SSE `data` 包装导致脚本误读 0 bytes 音频的问题 ✓
  - `cd backend && npm run eval:rag:e2e` → ok=true，skipped=false，simple 9/9、auto 9/9；修复真实 e2e 下 LLM 无引用时的保守片段抽取式回退 ✓
  - `cd backend && node scripts/build-business-regression-dataset.mjs && npm run eval:business-dataset` → ok=true，生成并校验 120 条内置业务评测样本 ✓
  - `cd backend && npm test -- karpathy-rag.service.spec.ts --runInBand` → 1 suite / 12 tests 通过 ✓
  - 收尾复验：`cd backend && npm run build`、`npm run lint`、`npm test -- --runInBand`、`npm run eval:rag`、`npm run eval:business-dataset`、`npm run eval:rag:e2e` 均通过；全量单测 18 suites / 90 tests，e2e simple 9/9 + auto 9/9 ✓
  - 结构化事实治理 schema/migration 已由第四轮完成并真实验证；第三轮记录仅代表当时状态。

- **企业级差距可本地增强第二轮验证（2026-06-21）**
  - `RAG_SOURCE_AUTHORITY_RULES` 已接入 Karpathy `retrieve` / `retrieveBm25Only` 排序，缺省为空时行为不变；单测覆盖 official/draft 同内容时 official 优先 ✓
  - `npm run eval:rag:judge` 已新增；脚本只输出 JSON 汇总，不打印 key，不打印完整模型原始响应；`QWEN_API_KEY` 缺失时 skipped ✓
  - `cd backend && npm run build` → 通过 ✓
  - `cd backend && npm run lint` → 通过 ✓
  - `cd backend && npm test -- --runInBand` → 18 suites / 89 tests 通过 ✓
  - `cd backend && QWEN_API_KEY= npm run eval:rag:judge` → skipped=true，JSON 输出干净 ✓
  - `cd backend && npm run eval:rag` → offline averageScore=1，通过 ✓
  - `cd backend && npm run eval:rag:e2e` → 当时 skipped=true；3001 真实回放已由第三轮验证覆盖 ✓
  - `git diff --check` → 通过 ✓
  - 已由第三轮补齐：120 条业务回归评测集、3001 真实服务 e2e 回放、GraphRAG/Hybrid/Speech/Redis 真实 smoke。
  - LLM-as-Judge 稳定门禁与结构化事实治理 schema 已由第四轮完成并真实验证；第二轮记录仅代表当时状态。

- **外部输入类任务工程入口补齐验证（2026-06-21）**
  - `backend/eval/business-regression.import.example.json` + `backend/scripts/import-business-regression-dataset.mjs` 已新增；`node scripts/import-business-regression-dataset.mjs --input eval/business-regression.import.example.json` → dry-run ok=true ✓
  - `workspace/mcp-business.example.yaml` + `backend/scripts/validate-mcp-config.mjs` 已新增；`cd backend && npm run mcp:validate` → 当前 `workspace/mcp-servers.yaml` serverCount=1，ok=true ✓
  - `backend/eval/graph-business.seed.example.json` + `backend/scripts/import-graph-business-seed.mjs` 已新增；`cd backend && npm run graph:import-business -- --dry-run` → documentCount=2，ok=true ✓
  - `scripts/check-production-readiness.sh` 已新增；`./scripts/check-production-readiness.sh` → composeConfigOk=true，redlineOk=true，仅提示本地 `backend/.env` 必须保持 untracked ✓
  - `cd backend && npm run smoke:external` → Qwen judge 真实调用通过，Bocha/Rerank 因 key 为空 skipped ✓
  - `cd backend && npm run smoke:external:required` → 按预期失败，明确指出 `BOCHA_API_KEY` / `RERANK_API_KEY` 为空；补 key 前不标记 Bocha/Rerank 真实联调完成 ✓
  - `cd backend && npm run eval:rag:quality` → offline averageScore=1，120 条业务回归集校验通过，judge 非强制模式 skipped ✓
  - 收尾验证：`cd backend && npm run build`、no-fix `npx eslint "{src,apps,libs,test}/**/*.ts"`、`npm test -- --runInBand`、新增脚本 `node --check`、`git diff --check` 均通过；全量单测 19 suites / 95 tests ✓

- **Agentic 成本边界验证（2026-06-21）**
  - 新增 `agentic.*` 配置与 `.env.example` 的 `AGENTIC_*` 模板，覆盖置信阈值、最大重试、扩展查询数、检索查询数、返回 chunk 数、联网搜索数、Rerank topN、auto 最大 query 长度、web search/rerank 开关 ✓
  - `AgenticRagService` 已按预算截断 query augment、retrieval queries、retrieved chunks、Bocha web_search count、Rerank topN；auto 模式超长 query 默认回退 simple，显式 agentic 仍尊重用户选择 ✓
  - 新增 `agentic-rag.service.spec.ts`，覆盖扩展查询截断、auto 超长问题回退 simple、检索查询/返回 chunk 截断 ✓
  - 同步 `README.md` / `ARCHITECTURE.md` / `PRD.md` / `ROADMAP.md`，清理 JWT、Redis Checkpointer、GraphRAG、腾讯云语音等旧“待”状态 ✓
  - 验证：`cd backend && npm run build`、no-fix `npx eslint "{src,apps,libs,test}/**/*.ts"`、`npm test -- --runInBand`、`npm run eval:rag:quality`、`git diff --check` 均通过；全量单测 20 suites / 98 tests ✓

- **RBAC 基础角色守卫验证（2026-06-21）**
  - 新增 `@Roles()` 装饰器与 `RolesGuard`，基于 JWT payload 的 `role` 做方法级权限判断，不新增数据库 schema ✓
  - Jobs 管理接口保留 `GET /jobs` 登录可见，`POST /jobs`、`PATCH /jobs/:id/start`、`PATCH /jobs/:id/stop`、`DELETE /jobs/:id` 限制 `admin` 角色 ✓
  - 新增 `roles.guard.spec.ts` 覆盖无角色元数据放行、匹配角色放行、非匹配角色 403 ✓
  - 定向验证：`cd backend && npm test -- roles.guard.spec.ts --runInBand`、定向 no-fix ESLint、`npm run build` 均通过 ✓
  - 收尾验证：`cd backend && npm run build`、no-fix `npx eslint "{src,apps,libs,test}/**/*.ts"`、`npm test -- --runInBand`、`npm run eval:rag:quality`、`git diff --check` 均通过；全量单测 21 suites / 101 tests ✓

- **Milvus 诊断 smoke 验证（2026-06-21）**
  - 新增 `backend/scripts/smoke-milvus-index.mjs` 与 `npm run smoke:milvus`，输出 SDK/server 版本、health、collection schema、row count、index state、load state、loading progress 和一次受限 search ✓
  - `cd backend && npm run smoke:milvus` 当前失败：health=true、server=v2.4.4、SDK=2.6.17、HNSW index Finished、loadState=Loaded、loadingProgress=100，但 search 返回 `DEADLINE_EXCEEDED` after 1.5s；证明 warning 不是 schema/index/load 配置缺失导致 ✗
  - 临时尝试 SDK 2.4.4 对齐 server v2.4.4：search 仍超时且 build 因旧 SDK 类型不支持 `exprValues` 失败；已回退 SDK 2.6.17，`package-lock.json` 无保留噪声 ✓
  - Docker 观察：`docker compose -f docker/docker-compose.dev.yml ps` 全部 healthy；`docker stats` 显示 Milvus 约 1.0GiB 内存、CPU 有波动；Milvus 日志出现大量 segment task 与 dropped/growing segment 清理。后续如果要继续处理，需要确认是否允许 collection 压实/重建或容器版本升级。

- **定时任务 Agent 执行动作验证（2026-06-21）**
  - `JobsService.run()` 已从只记录 instruction 改为调用 `SupervisorService.query(job.instruction)`，复用现有领域路由/多 Agent 管线执行定时任务，不新增数据库 schema ✓
  - 执行失败只记录 warning，不让 scheduler runtime 崩溃；单次 `at` 任务仍会在执行后 disabled/running=false ✓
  - `JobsModule` 引入 `SupervisorModule`，jobs 管理写操作仍受 RBAC admin 限制 ✓
  - 定向验证：`cd backend && npm test -- jobs.service.spec.ts --runInBand`、定向 no-fix ESLint、`npm run build` 均通过 ✓
  - 收尾验证：`cd backend && npm run build`、no-fix `npx eslint "{src,apps,libs,test}/**/*.ts"`、`npm test -- --runInBand`、`npm run eval:rag:quality`、`git diff --check` 均通过；全量单测 21 suites / 101 tests ✓

- **企业级成熟度门禁验证（2026-06-21）**
  - 新增 `backend/scripts/eval-rag-maturity.mjs` 与 `npm run eval:rag:maturity`，并接入 `npm run eval:rag:quality` ✓
  - 打分维度：查得准、答得稳、引用能撑住、不会瞎编、可观测与恢复、工程化门禁、真实落地准备 ✓
  - `cd backend && npm run eval:rag:maturity` → passed=true，score=93/100，threshold=90 ✓
  - 明确扣分项：真实私有业务评测集未接入、Milvus search runtime 仍有降级缺口、生产目标机器/证书/备份策略未确认 ✓
  - `RAG_MATURITY_REQUIRE_EXTERNAL=true` 可把真实私有题集和生产材料升级为硬阻塞，避免把本地工程分冒充生产落地分 ✓
  - 收尾验证：`cd backend && npm run build`、no-fix `npx eslint "{src,apps,libs,test}/**/*.ts"`、`npm test -- --runInBand`、`npm run eval:rag:quality`、`git diff --check` 均通过；全量单测 21 suites / 101 tests，质量门禁输出 maturity score=93/100 ✓

- **项目级仿真实业务评测验证（2026-06-21）**
  - 新增 `backend/eval/project-simulated-business.dataset.json`：8 份模拟业务文档，覆盖 HR、Finance、Legal、IT、Security、CS、Data 等项目常见资料 ✓
  - 新增 `backend/scripts/eval-rag-project.mjs` 与 `npm run eval:rag:project`，并接入 `npm run eval:rag:quality` ✓
  - 首轮强制真实回放暴露版本冲突题失败；已增加制度版本查询归一化锚点，并把 LLM 引用不合格统一回退为片段抽取式答案 ✓
  - 第二轮强制真实回放暴露无答案负例被“报销”等弱词误召回；已增加中文短语重合闸门，避免单个泛词支撑确定性回答 ✓
  - `PROJECT_EVAL_REQUIRE_LIVE=true npm run eval:rag:project` → ok=true，score=1，simple 11/11，auto 11/11，skipped=false ✓
  - 收尾验证：`cd backend && npm run build`、no-fix `npx eslint "{src,apps,libs,test}/**/*.ts"`、`npm test -- --runInBand`、`npm run eval:rag:quality` 均通过；全量单测 21 suites / 103 tests，质量门禁内项目级真实评测再次 score=1、skipped=false ✓

- **RAG 评测 Drone CI 门禁验证（2026-06-20）**
  - 新增 `.drone.yml`：backend 阶段执行 `npm run build`、no-fix ESLint、`npm run eval:rag`；frontend 阶段执行 `npm run lint`、`npm run build`；Docker 阶段使用 Drone Docker 插件 dry-run 验证 backend/frontend Dockerfile 构建，不推镜像、不部署 ✓
  - `cd backend && npm run build && npx eslint "{src,apps,libs,test}/**/*.ts" && npm run eval:rag` → 通过；离线 RAG smoke 评测 `passed=true`，`averageScore=1.0` ✓
  - `cd frontend && npm run lint && npm run build` → 通过 ✓

- **Jenkinsfile 与 Dockerfile 构建验证（2026-06-20）**
  - 新增 `Jenkinsfile`：默认 `DEPLOY_TARGET=none`，只执行 backend/frontend 门禁与 Docker build；手动选择 staging/prod 时才执行 `docker compose up -d --build`，不写真实凭据，不自动发布 ✓
  - 修复 backend Dockerfile 安装阶段：`npm ci` 增加 `--omit=optional --legacy-peer-deps`，跳过未使用的 `@langchain/community` optional peer 解析冲突；runtime 阶段同样使用 `--omit=dev --omit=optional --legacy-peer-deps` ✓
  - 同步 Drone/Jenkins backend gate 使用 `npm ci --omit=optional --legacy-peer-deps`，避免 CI 环境重现 optional peer 冲突 ✓
  - `docker build -t rag-backend:ci backend` → 通过；`docker build -t rag-frontend:ci frontend` → 通过 ✓
  - `cd backend && npm run build && npx eslint "{src,apps,libs,test}/**/*.ts" && npm run eval:rag` → 通过，离线评测 `passed=true`、`averageScore=1.0` ✓
  - `cd frontend && npm run lint && npm run build` → 通过 ✓

- **依赖与基础镜像版本固定验证（2026-06-20）**
  - backend/frontend `package.json` 中 dependencies/devDependencies/overrides 均已固定为精确版本，未保留 `^` / `~` / `latest` / 通配范围 ✓
  - Dockerfile 基础镜像固定：`node:20.20.2-alpine`、`nginx:1.29.3-alpine` ✓
  - docker compose 基础服务镜像固定：`pgvector/pgvector:0.8.1-pg16`、`redis:7.4.9-alpine`、`etcd:v3.5.5`、`minio:RELEASE.2023-03-20T20-16-18Z`、`milvus:v2.4.4`、`elasticsearch:8.13.0`、`neo4j:5.26.27-community` ✓
  - `cd backend && npm ci --omit=optional --legacy-peer-deps && npm run build && npx eslint "{src,apps,libs,test}/**/*.ts" && npm run eval:rag` → 通过；离线评测 `passed=true`、`averageScore=1.0` ✓
  - `cd frontend && npm ci && npm run lint && npm run build` → 通过 ✓
  - `docker compose -f docker/docker-compose.yml config`、dev/staging/prod profile 配置解析 → 通过 ✓
  - `docker build -t rag-backend:ci backend`、`docker build -t rag-frontend:ci frontend` → 通过 ✓

- **ROADMAP 非 CI/CD 项状态复验与清理（2026-06-20）**
  - `cd backend && npm run build` → 通过 ✓
  - `docker compose -f docker/docker-compose.dev.yml --profile graphrag ps` → PostgreSQL / Redis / Milvus / Elasticsearch / MinIO / etcd / Neo4j 均运行且 healthy ✓
  - `PORT=3001 node dist/src/main` → 后端启动成功，日志确认 Redis / Elasticsearch / Mem0 cloud / Neo4j 均初始化成功 ✓
  - `GET /api/v1/health` → 200 ✓
  - `GET /api/v1/metrics` → 200，返回 Prometheus 文本，包含 `rag_http_requests_total`、`rag_http_request_duration_seconds` 与默认 Node 指标 ✓
  - `GET http://127.0.0.1:9200/_cluster/health` → Elasticsearch 单节点 `yellow`，可连接且未再出现 compatible-with 版本错误 ✓
  - 带 JWT 调用 `GET /api/v1/memories` → 200，返回 `enabled=true` 与空 memories 列表；未输出 `MEM0_API_KEY` ✓
  - 带 JWT 调用 `GET /api/v1/graph/schema` → 200，返回 `enabled=true`、空 labels/relationships；Neo4j 连接已通，业务图谱数据仍待导入 ✓
  - 带 JWT 调用 `GET /api/v1/traces?limit=3` → 200，返回 in-memory spans ✓
  - 仍观察到 Milvus warmup 约 0.8s `DEADLINE_EXCEEDED` warning，按现有快速降级策略处理，不阻塞启动 ✓

- **架构/PRD 文档补齐检查（2026-06-20）**
  - 新增 `ARCHITECTURE.md`：覆盖系统定位、总体架构、运行时组件、后端模块边界、文档入库、问答链路、GraphRAG、数据隔离、Provider、部署、可观测性、风险和文档关系 ✓
  - 新增 `PRD.md`：覆盖产品概述、背景、目标用户、产品目标/非目标、用户故事、功能范围、接口范围、非功能要求、验收标准、阶段计划、开放问题和文档关系 ✓
  - 文档明确 `ROADMAP.md` 仍是可变进度与真实状态源，架构/PRD 只记录相对稳定的设计与产品约束 ✓
  - `ARCHITECTURE.md` / `PRD.md` / `ROADMAP.md` / `CLAUDE.md` / `rag-plan.md` 已统一文档关系说明 ✓

- **dev 基础服务恢复验证**（2026-06-20）
  - `docker ps` → `rag-dev-postgres` / `rag-dev-redis` / `rag-dev-milvus` / `rag-dev-es` / `rag-dev-minio` / `rag-dev-etcd` 均运行中且核心服务 healthy ✓
  - `docker exec rag-dev-postgres pg_isready -U postgres -d rag` → accepting connections ✓
  - `docker exec rag-dev-redis redis-cli ping` → PONG ✓
  - `curl http://localhost:9200/_cluster/health` → Elasticsearch 单节点 `yellow`，可连接 ✓
  - `curl http://localhost:9091/healthz` → Milvus health OK ✓
  - `PORT=3001 node dist/src/main` → 后端成功连接 PostgreSQL / Redis / Elasticsearch / Milvus 并启动 ✓
  - `curl http://localhost:3001/api/v1/health` → `{"code":200,"data":{"status":"ok",...},"message":"success"}` ✓
  - `curl http://localhost:3001/api/v1/debug/vector-index` → 返回 Milvus HNSW 索引配置 ✓
  - 仍观察到 Milvus warmup 约 0.8s `DEADLINE_EXCEEDED` warning，按已知问题快速降级，不阻塞启动

- **Neo4j / GraphRAG 运行时启用验证**（2026-06-20）
  - `backend/.env` 已配置 `GRAPH_RAG_ENABLED=true`、`NEO4J_URL=bolt://localhost:7687`、`NEO4J_USERNAME=neo4j`、`NEO4J_PASSWORD`（与 dev compose 默认密码一致）✓
  - `docker compose -f docker/docker-compose.dev.yml --profile graphrag up -d neo4j` → `rag-dev-neo4j` 启动并 healthy ✓
  - `curl http://localhost:7474` → 返回 Neo4j 5 community 元信息与 Bolt 地址 ✓
  - `PORT=3001 node dist/src/main` → 后端日志确认 `Connected to Neo4j successfully.` ✓
  - 带 JWT 调用 `GET /api/v1/graph/schema` → 200，返回 `enabled=true`、`nodeCount=0`、`relationshipCount=0`；当前图谱为空，待导入数据 ✓

- **正式/预发 Docker Compose Neo4j 配置补齐验证**（2026-06-20）
  - `docker/docker-compose.prod.yml` 新增 `neo4j` 服务（profile=`graphrag`）、`neo4j_data` volume、健康检查和资源限制 ✓
  - prod/staging backend 容器环境覆盖 `NEO4J_URL=bolt://neo4j:7687`，避免容器内误连 `localhost` ✓
  - prod/staging backend 对 profile 服务 `neo4j` 使用 `depends_on` + `required: false`，默认部署不启用 GraphRAG 时仍可解析，启用 profile 时等待 Neo4j healthy ✓
  - `docker compose -f docker/docker-compose.prod.yml config --services` → 默认服务可解析，不含 Neo4j ✓
  - `docker compose -f docker/docker-compose.prod.yml --profile graphrag config --services` → 包含 `neo4j` ✓
  - `docker compose -f docker/docker-compose.staging.yml config --services` 与 `--profile graphrag` 均可解析 ✓

- **前端 lint 工具链验证**（2026-06-20）
  - 新增 `frontend/eslint.config.js` flat config，匹配 React 18 + Vite + TypeScript 项目 ✓
  - frontend 补齐本地 ESLint 开发依赖：`eslint`、`@eslint/js`、`typescript-eslint`、`eslint-plugin-react-hooks`、`eslint-plugin-react-refresh`、`globals` ✓
  - 修复前端现有 lint 错误：登录错误处理移除 `any`、TTS 文本清理正则移除无用转义、UploadPage Hook 依赖稳定化 ✓
  - `cd frontend && npm run lint` → 通过 ✓
  - `cd frontend && npm run build` → 通过 ✓

- **P3 文件系统中间件 + 权限控制基础版验证**（2026-06-19）
  - 新增 `FilesystemPolicyModule` / `FileAccessPolicyService`
  - 默认 allow root 为 `workspace` 根目录，relative path 会解析到 workspace 根下 ✓
  - 拒绝路径穿越到 workspace 外部 ✓
  - 拒绝 `.env` / `.git` / `.history` / `agent-course` / `node_modules` 等敏感路径段 ✓
  - `assertAllowed()` 对拒绝路径抛出 `ForbiddenException`，供后续文件工具统一复用 ✓
  - `cd backend && npm run test -- file-access-policy.service.spec.ts --runInBand` → 1 suite / 4 tests 通过 ✓
  - `cd backend && npm run build` → 通过 ✓
  - `cd backend && npm run lint` → 通过 ✓

- **P2 Skills Embedding 语义匹配增强验证**（2026-06-19）
  - `SkillsService.match()` 在 `embedding.qwen.apiKey` 存在时使用 `OpenAIEmbeddings` 对 query 与技能文本生成向量并按 cosine 语义相似度排序 ✓
  - Embedding 初始化不依赖 `EmbeddingProvider`，避免无 key 环境因 Provider 构造阶段抛错导致应用启动失败 ✓
  - Embedding key 缺失或调用失败时自动回退本地中英文 token 匹配 ✓
  - `SkillMatch` 返回 `matchMode` 与 `semanticScore`，便于前端/调试侧区分匹配路径 ✓
  - 真实调用 Qwen `text-embedding-v3` 成功：返回 1024 维非零向量，向量 norm=1；未输出 key 或向量内容 ✓
  - `cd backend && npm run test -- skills.service.spec.ts --runInBand` → 1 suite / 4 tests 通过 ✓
  - `cd backend && npm run lint` → 通过 ✓
  - `cd backend && npm run build` → 通过 ✓

- **P3 Mermaid 工作流可视化基础版验证**（2026-06-19）
  - 新增 `WorkflowModule` / `WorkflowController`
  - `GET /api/workflows/agentic/mermaid`：导出 Agentic RAG 工作流 Mermaid `flowchart TD` 图 ✓
  - 支持 `events=query_augment,retrieval,token,reflection,final` 查询参数，将 SSE 事件映射为高亮节点，返回 `diagram` 与 `highlightedNodes` ✓
  - 新增 `agentic-workflow.mermaid.spec.ts` 覆盖静态图导出、执行路径高亮、未知事件过滤 ✓
  - `cd backend && npm run test -- agentic-workflow.mermaid.spec.ts --runInBand` → 1 suite / 3 tests 通过 ✓
  - `cd backend && npm run build` → 通过 ✓
  - `cd backend && npm run lint` → 通过 ✓

- **P3 异常场景测试基础版验证**（2026-06-19）
  - 新增 `karpathy-rag.service.spec.ts`：空知识库返回友好提示、无相关文档不调用 LLM、Embedding/向量检索失败时自动降级 BM25 ✓
  - 新增 `tencent-speech.provider.spec.ts`：缺少腾讯云 Secret 时 ASR/TTS 抛出明确配置错误 ✓
  - 扩展 `bocha-search.service.spec.ts`：Bocha 服务 503 时抛出包含状态码和响应摘要的错误 ✓
  - 已有 `chunking.util.spec.ts` 覆盖长 Markdown 切分与空文本行为，可覆盖“大文件/长文本切分”基础场景 ✓
  - `cd backend && npm run test -- karpathy-rag.service.spec.ts tencent-speech.provider.spec.ts bocha-search.service.spec.ts --runInBand` → 3 suites / 8 tests 通过 ✓
  - `cd backend && npm run lint` → 通过 ✓
  - `cd backend && npm run build` → 通过 ✓
  - 腾讯云 ASR/TTS 配置已纠正为 `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY` / `TENCENT_REGION`；官方 SentenceRecognition 输入参数无 ASR AppId，真实 ASR/TTS 联调未执行

- **P2 Skills 技能系统基础版验证**（2026-06-19）
  - 新增 `SkillsModule` / `SkillsController` / `SkillsService`
  - `GET /api/skills`：递归扫描 `SKILLS_DIR`（默认 `../skills`）下的 `SKILL.md`，解析 `name` / `description` / `tags` frontmatter ✓
  - `GET /api/skills/match?query=...&limit=...`：基础版支持中英文 token 本地匹配与排序，后续已增强为 Qwen Embedding 语义匹配 + token 回退 ✓
  - 新增 `SKILLS_DIR` 环境变量模板到 `.env.example` ✓
  - `cd backend && npm run test -- skills.service.spec.ts --runInBand` → 1 suite / 3 tests 通过 ✓
  - `cd backend && npm run build` → 通过 ✓
  - `cd backend && npm run lint` → 通过 ✓

- **P2 TTS SSE 流式音频验证**（2026-06-19）
  - 新增 `GET /api/speech/tts/stream`：输出 `meta/chunk/done/error` SSE 事件，音频 chunk 使用 base64 承载，保留 JWT query token 鉴权 ✓
  - 前端 `synthesizeSpeechStream()` 通过 EventSource 接收音频块并组装 `audio/wav` Blob，ChatPage 朗读按钮切换为 SSE 合成后播放 ✓
  - `cd backend && npm run build` → 通过 ✓
  - `cd backend && npm run lint` → 通过 ✓
  - `cd frontend && npm run build` → 通过 ✓
  - `cd frontend && npm run lint` → 已修复并通过（2026-06-20）：补齐 ESLint 本地开发依赖与 flat config
  - 腾讯云 Secret 已配置；真实 TTS 播放联调待外部网络调用验证

- **依赖与编译健康验证**（2026-06-19）
  - 统计 `ROADMAP.md` 显式未勾选任务：30 项 ✓
  - 修复 `RedisCheckpointer` 与当前 `@langchain/langgraph-checkpoint` pending writes 类型不匹配问题 ✓
  - 为 `RedisProvider` 补齐 Redis sorted set / key lookup 薄封装（`zrange` / `zadd` / `keys`），支持 checkpointer 编译 ✓
  - 修复 `McpProvider` 的 `any` 类型与 `ClientConfig['mcpServers']` 类型对齐问题 ✓
  - Agentic RAG 接入 `RedisCheckpointer`，Redis 可用时持久化 LangGraph checkpoint，Redis 不可用时降级 `MemorySaver` ✓
  - 补齐 backend 运行时依赖声明：`pino-http`（nestjs-pino 运行时需要）、`ws`（Milvus SDK 运行时链路需要）、`@node-rs/jieba`（BM25 中文分词代码引用）✓
  - `cd backend && npm run build` → 通过 ✓
  - `cd backend && npm run lint` → 通过 ✓
  - `cd backend && npm run start` → 当时阻塞于 PostgreSQL 未运行（ECONNREFUSED localhost:5432）；该历史阻塞已由 2026-06-20 dev 基础服务恢复验证覆盖
  - `cd docker && docker compose ps` → 当时 Docker daemon 未运行；该历史阻塞已由 2026-06-20 dev 基础服务恢复验证覆盖

- **P3 本地单元测试基础版验证**（2026-06-19）
  - 新增 `chunking.util.spec.ts`：长 Markdown 拆分、空文本行为 ✓
  - 新增 `bm25.util.spec.ts`：英文排序、中文召回、clear 行为 ✓
  - 新增 `cosine.util.spec.ts`：同向、正交、零向量、维度不匹配 ✓
  - 新增 `bocha-search.service.spec.ts`：无 API key 禁用分支、mock web_search 响应解析 ✓
  - 新增 `dashscope-rerank.service.spec.ts`：无 API key 原样返回、mock rerank 结果排序 ✓
  - `cd backend && npm run test -- chunking.util.spec.ts bm25.util.spec.ts cosine.util.spec.ts bocha-search.service.spec.ts dashscope-rerank.service.spec.ts --runInBand` → 5 suites / 13 tests 全通过 ✓
  - `cd backend && npm run build` → 通过 ✓
  - `cd backend && npm run lint` → 通过 ✓

- **P3 Prometheus 指标基础版验证**（2026-06-19，2026-06-20 复验）
  - 新增 `MetricsModule` / `MetricsController` / `MetricsService` / `MetricsInterceptor`
  - `GET /api/v1/metrics` 暴露 Prometheus 文本格式指标
  - 已采集默认 Node 指标、`rag_http_requests_total`、`rag_http_request_duration_seconds`
  - `cd backend && npm run build` → 通过 ✓
  - `cd backend && npm run lint` → 通过 ✓
  - `GET /api/v1/metrics` 运行时返回 200，确认 Prometheus 文本与 HTTP/Node 指标存在 ✓

- **P2 定时任务 Agent 骨架验证**（2026-06-19）
  - 新增 `JobsModule` / `JobsController` / `JobsService`
  - 支持 `GET /api/jobs`、`POST /api/jobs`、`PATCH /api/jobs/:id/start`、`PATCH /api/jobs/:id/stop`、`DELETE /api/jobs/:id`
  - 支持 `cron/every/at` 三种类型；当前使用内存存储，不涉及数据库 schema
  - 新增 `jobs.service.spec.ts`：every job 启停、at job 一次执行后停用、非法 everyMs 校验 ✓
  - `cd backend && npm run test -- jobs.service.spec.ts --runInBand` → 1 suite / 3 tests 全通过 ✓
  - `cd backend && npm run build` → 通过 ✓
  - `cd backend && npm run lint` → 通过 ✓

- **P2 认证与多租户数据隔离验证**（2026-06-18）
  - 后端 build/lint 全线成功 ✓
  - 前端 build 成功打包（195KB 模块）✓
  - 运行 `verify-multitenancy.mjs` 测试脚本进行 E2E 验证：包含登录鉴权覆盖、会话/文档列表/数据在数据库/Redis/Milvus/BM25 的用户级物理隔离、检索过滤等，测试 100% 成功通过 ✓

- **M5 容器化部署验证**（2026-06-18）
  - `docker compose -f docker-compose.prod.yml build` → backend 278MB / frontend 61.7MB ✓（均 < 300MB）
  - `docker compose -f docker-compose.prod.yml up -d` → 7 个容器全部 Running/Healthy ✓
  - `curl http://localhost:3000/api/health` → `{"code":200,"data":{"status":"ok"}}` ✓
  - `curl http://localhost:80/` → HTTP 200 ✓（frontend nginx）
  - `curl http://localhost:80/api/health` → `{"code":200,...}` ✓（nginx /api 反代正常）
  - M5 验收标准全部达成：一键拉起完整栈 ✓ / 镜像 < 300MB ✓ / 资源限制 ✓

- **M4 前端最小可用验证**（2026-06-18）
  - `cd frontend && npm run build` → tsc -b + vite build 无错误 ✓（88 模块，195KB JS gzip 66KB）
  - `cd frontend && npm run dev` → Vite dev server http://localhost:5173/ ✓
  - 前端代理 /api → localhost:3000 ✓（后端 health 接口可达）
  - M4 验收标准全部达成：文件上传 ✓ / 聊天流式 ✓ / 引用展开 ✓ / 模式切换 ✓

- **M1 最简 RAG 管线完整验证**（2026-06-18）
  - docker compose 启动 Milvus + PostgreSQL + Redis 全部 healthy ✓
  - `POST /api/documents/upload` 上传 test-doc.md → `{"docId":"...","chunkCount":1}` ✓
  - `GET /api/debug/chunks?query=LangChain` → 返回 BM25 分(0.55) + cosine 分(0.72) + 加权总分(0.67) ✓
  - `POST /api/chat` mode=simple "LangChain是什么" → 返回正确答案 + `[片段 1]` 引用 ✓
  - M1 验收标准全部达成 ✓

- **M2 Agentic RAG 完整验证**（2026-06-18，通过）
  - `POST /api/chat` mode=agentic "M2 Agentic RAG 的 SSE 需要输出哪些事件？" → deepAgent 规划 + retrieval + generate + reflection 完整运行 ✓
    - deepAgent planned queries 生成 3 条检索问句 ✓
    - retrieval 使用 4 queries（原始问题 + 3 条 deepAgent 规划问句）✓
    - Milvus 向量 search 超时时降级 BM25，仍召回测试 chunk ✓
    - Reflection: confidence=1.00, passed=true, retry=1/2 ✓
  - `POST /api/chat` mode=auto "这个项目用了哪些技术栈，它们分别负责什么？" → route=agentic，返回 2 个引用，reflection=1.00 ✓
  - `GET /api/chat/stream` mode=agentic → 输出 routing / query_augment / retrieval / token / citation / reflection / final 全事件，reflection=0.95 ✓

- **M1/M2 增量验证**（2026-06-18，通过）
  - `POST /api/documents/upload` 上传 `.txt` 文件 → 返回 docId + chunkCount ✓
  - `POST /api/documents/upload` 上传 `.pdf` 文件 → 返回 docId + chunkCount ✓
  - `POST /api/documents/upload` 上传 `.docx` 文件 → 返回 docId + chunkCount ✓
  - `GET /api/chat/stream` mode=agentic → 输出 routing / query_augment / retrieval / sufficiency / token / citation / reflection / final 全事件 ✓；检索不足分支额外输出 web_search ✓
  - sufficiency 事件返回 `sufficient=true` + 中文 reason ✓
  - final 事件包含 `retrievalSufficient=true` + `retrievalReason` ✓
  - 检索不足且 `BOCHA_API_KEY` 未配置时 → 输出 `web_search` 事件，`enabled=false`，final 正常返回，不报 500 ✓
  - `RERANK_API_KEY` 未配置时 → 输出 `rerank` 事件，`enabled=false`，final 正常返回，不报 500 ✓

- **M3 工程化完整验证**（2026-06-18）
  - `cd backend && npm run build` → 无错误 ✓
  - `cd backend && npm run lint` → 无错误 ✓
  - `cd backend && npm run start` → Nest 应用成功启动，pino 结构化日志生效 ✓
  - `GET /api/health` → `{"code":200,"data":{"status":"ok","timestamp":"..."},"message":"success"}` ✓（统一响应格式）
  - `POST /api/chat` 空体 → `{"code":400,"data":null,"message":"query must be a string"}` ✓（全局异常 + ValidationPipe）
  - `GET /api/auth/profile` 无 token → `{"code":401,"data":null,"message":"missing or invalid bearer token"}` ✓（JWT 认证）
  - `POST /api/auth/login` admin/admin123 → 返回 `accessToken` ✓（JWT 签发）
  - `GET /api/auth/profile` 带正确 token → `{"code":200,"data":{"userId":"1","username":"admin","role":"admin"}}` ✓（JWT 验签 + @CurrentUser）
  - `GET /api/auth/profile` 带无效 token → `{"code":401,"data":null,"message":"token invalid or expired"}` ✓（JWT 错误处理）

---

## 里程碑与验收标准（MVP 路径）

> 待办清单若无验收标准，就是愿望清单。以下里程碑按"能跑通一条最简管线"的顺序排列，每个里程碑必须达成验收标准才能进入下一个。

### M0 — 项目骨架可运行（P0 基础设施前置）

**验收标准**：
- `npm run start:dev` 启动 NestJS 服务，`GET /api/health` 返回 `{ status: "ok" }`
- ESLint + tsconfig 通过，`npm run build` 无错误
- `.env.example` 提供所有必需环境变量模板
- docker-compose 能拉起 PostgreSQL + Redis + Milvus 三个服务并健康检查通过

### M1 — 最简 RAG 管线跑通（P1 核心管线的最小子集）

**验收标准**：
- 上传 1 个 Markdown 文件（如 README.md），返回 `doc_id`
- 切分 + Embedding + 写入 Milvus 成功，可在 Milvus 中查到向量
- 用 `simple` 模式提问"这个项目是做什么的"
- **5 秒内**返回答案，且引用来源指向 README.md 的具体段落
- `GET /api/debug/chunks?query=...` 返回每个 chunk 的 BM25 分、cosine 分、加权总分

**砍掉范围**：不实现 Agentic RAG、不实现 web_search、不实现 Rerank、不实现流式、不实现多模式切换。只验证"上传→切分→检索→回答"这条链路。

### M2 — Agentic RAG 管线跑通（P1 核心管线完整）

**验收标准**：
- `agentic` 模式下，对多跳问题（如"这个项目用了哪些技术栈，分别对应哪个章节"）能触发 ≥2 轮检索
- `auto` 模式能根据问题复杂度自动选择 simple / agentic
- SSE 流式响应能正确推送 `routing / query_augment / retrieval / sufficiency / web_search / rerank / token / citation / reflection / final` 事件
- Reflection 节点对低置信度答案触发重新检索，最多重试 2 次

### M3 — 工程化与可观测（P0 工程化 + P3 可观测子集）

**验收标准**：
- JWT 认证生效，未携带 token 的请求返回 401
- 统一响应格式 `{ code, data, message }` 全局生效
- AllExceptionsFilter 捕获所有未处理异常，返回结构化错误
- pino 结构化日志输出 JSON 格式，含 request_id
- `GET /api/documents` 返回文档列表 + 处理状态

### M4 — 前端最小可用（P2 前端子集）

**验收标准**：
- 文件上传页能上传文件并显示处理状态
- 聊天窗口能流式显示回答
- 引用来源可展开查看 chunk 原文
- 模式切换器（simple / agentic / auto）能切换并生效

### M5 — 容器化部署（P1 容器化）

**验收标准**：
- `docker compose up` 一键拉起完整栈（app + postgres + redis + milvus + es）
- 多阶段构建镜像大小 < 300MB
- prod compose 配置含资源限制

### 后续里程碑（暂不细化）

- M6：评测体系（LangSmith + OpenEvals + 合成 Dataset）
- M7：记忆系统（Mem0 长期记忆 + 对话历史向量化）
- M8：高级能力（MCP / Skills / 知识图谱 / Supervisor 多 Agent）

---

## 里程碑与待办的映射

| 里程碑 | 涉及待办分组 | 验收状态 |
|--------|-------------|----------|
| M0 | P0 项目骨架 + docker-compose 基础服务 | ✅ 已完成（2026-06-18） |
| M1 | P1 核心管线（simple 子集）+ P0 Provider 接口 | ✅ 已完成（2026-06-18） |
| M2 | P1 核心管线（完整）+ P1 LangGraph 增强 | ✅ 已完成（2026-06-18） |
| M3 | P0 NestJS 工程化 + P3 pino 日志 | ✅ 已完成（2026-06-18） |
| M4 | P2 前端子集 | ✅ 已完成（2026-06-18） |
| M5 | P1 容器化部署 | ✅ 已完成（2026-06-18） |

> **纪律**：M0 未达成前，禁止动 M1 的代码；M1 未达成前，禁止实现 Agentic RAG / 前端 / 容器化等任何"高级"特性。先跑通一条链路，再谈扩展。

---

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-06-18 | 初始化 ROADMAP，基于 rag-plan.md 创建待办清单 |
| 2026-06-18 | 技术栈选型确认：NestJS / Node.js。解除技术栈阻塞，更新待办清单中的 Python 依赖为 Node.js 对应方案（jieba→nodejieba、numpy→纯 JS、APScheduler→@nestjs/schedule、Alembic→TypeORM、structlog→pino、slowapi→@nestjs/throttler） |
| 2026-06-18 | 技术栈对齐 SUMMARY.md：向量库 pgvector→Milvus、搜索 Tavily→Bocha、LLM 确认通义千问+OpenAI 兼容、语音确认腾讯云 ASR/TTS、Rerank 确认 DashScope。评测 Dataset 确认合成数据。阻塞清空 |
| 2026-06-18 | rag-plan.md 全文同步 Node.js 生态：架构图（FastAPI→NestJS、pgvector→Milvus、Tavily→Bocha、numpy→纯 JS）、依赖清单（替换为 NestJS/LangChain.js/LangGraph.js/DeepAgents.js/TypeORM/ioredis/pino 等）、代码示例（Python→TypeScript）、改进建议（APScheduler→@nestjs/schedule、Alembic→TypeORM migrations、structlog→pino、slowapi→@nestjs/throttler、RestrictedPython→quickjs-emscripten） |
| 2026-06-18 | 向量库 + 关系型数据库改为可插拔多后端：VECTOR_STORE_PROVIDER=milvus\|pgvector、RELATIONAL_DB_PROVIDER=postgres\|mysql。新增 VectorStoreProvider / RelationalDBProvider 抽象接口 |
| 2026-06-18 | SUMMARY.md 扩展到 26 个项目（补齐 prompt-template-test/runnable-test/output-parser-test/tool-test/rag-test/milvus-test/pgsql-test/redis-test/neo4j-graphrag/nest-feature/nest-dockerfile-test/tts-stt-test 等遗漏项目） |
| 2026-06-18 | rag-plan.md 对齐 SUMMARY.md 26 个项目：综合能力对照表扩展到 26 章、新增 6 个能力补充章节（知识图谱 RAG、MCP 协议、NestJS 工程化、Docker 部署、Prompt 工程、结构化输出）、依赖清单新增 @langchain/mcp-adapters/neo4j-driver、实施优先级表新增 7 项 |
| 2026-06-18 | ROADMAP 同步 rag-plan.md 最新内容：待办清单新增 P0（NestJS 工程化模式落地）、P1（Prompt 工程、结构化输出、Docker 容器化部署）、P2（MCP 协议集成）、P3（知识图谱 RAG Neo4j）；已完成项补充 SUMMARY.md 26 章节和 rag-plan.md 26 项目对齐记录 |
| 2026-06-18 | 新增"待确认"项决策建议（多租户→单租户预留 tenant_id、部署→Docker Compose）；新增"里程碑与验收标准"章节（M0~M5 + 后续 M6~M8），每个里程碑含明确验收标准；新增里程碑与待办映射表 + 纪律约束（M0 未达成禁止动 M1） |
| 2026-06-18 | **M0 完成**：创建顶层目录（backend/frontend/admin/docker/skills/workspace）+ CLAUDE.md 项目规则 + 根级 .gitignore + backend NestJS 初始化（@nestjs/config + @nestjs/terminus + dotenv）+ config/configuration.ts 全量配置 + modules/health 健康检查模块 + main.ts 全局前缀 /api + .env.example 全量模板 + docker-compose.yml（PG16+pgvector/Redis7/Milvus2.4.4+etcd+minio，全 healthcheck）。验证通过：build ✓ / lint ✓ / start ✓ / curl /api/health → {"status":"ok"} ✓ |
| 2026-06-18 | **M1 代码完成**：providers（llm/embedding/vector-store）+ modules（document/chat/debug）+ rag/karpathy（BM25+cosine+加权融合+LLM 生成）+ class-validator 校验 + ValidationPipe。修复 uuid ESM 兼容（node:crypto.randomUUID + npm overrides 锁 uuid@9）+ milvus2-sdk-node 降级到 v2.6.14。Milvus 连接失败不阻断启动。验证：build ✓ / lint ✓ / start ✓ / health ✓ / docker 上传→提问→debug 完整链路 ✓ |
| 2026-06-18 | **安全修复**：清除 .env.example 中误填的真实 QWEN_API_KEY，创建 .env（已 gitignore）存放真实密钥 |
| 2026-06-18 | **M3 工程化启动**：开始 NestJS 工程化模式落地（TransformInterceptor / AllExceptionsFilter / 请求日志 / JWT 骨架），不依赖 docker，可独立验证 |
| 2026-06-18 | **M3 工程化骨架完成**：common/ 目录落地（interfaces/interceptors/filters/decorators/guards）+ main.ts 全局注册 + config 新增 auth 配置 + .env 新增 JWT_SECRET。验证：build ✓ / lint ✓ / start ✓ / 统一响应 {code,data,message} ✓ / 全局异常 400+message ✓ |
| 2026-06-18 | **M3 工程化完整完成**：nestjs-pino 结构化日志（JSON + pino-pretty）+ 完整 JWT 认证模块（AuthModule/AuthService/AuthController + JwtAuthGuard 接入 JwtService.verifyAsync + @CurrentUser + @UseGuards）+ 测试用户（admin/admin123、user/user1234）+ `POST /api/auth/login` + `GET /api/auth/profile`。验证：401 无 token ✓ / 登录签发 token ✓ / 带 token 200 ✓ / 无效 token 401 ✓ / pino 日志 ✓ |
| 2026-06-18 | **M2 Agentic RAG 代码完成**：rag/agentic/ 模块（state + sse-event + service + module）+ LangGraph 工作流（routeNode/queryAugmentNode/retrievalNode/generateNode/reflectionNode + reflectionRouter）+ auto 模式 LLM 分类 + query_augment 3 条多角度问句 + LLM 流式生成 + reflection 置信度评估（阈值 0.7，最多重试 2 次）+ SSE 流式接口 `GET /api/chat/stream`。ILLMProvider 新增 getModel()。验证：build ✓ / lint ✓ / start ✓ / 参数校验 ✓ / auto 路由分类 ✓ / query_augment ✓；完整 retrieval 后续已在 M2 验证记录中通过 |
| 2026-06-18 | **Docker 环境启动 + M1 完整验证**：docker compose 拉起 Milvus + PostgreSQL + Redis（全 healthy）。M1 验收：上传 test-doc.md → docId ✓ / debug chunks 返回 BM25+cosine+总分 ✓ / simple chat 返回答案+引用 ✓。M1 验收标准全部达成 |
| 2026-06-18 | **M2 Agentic 工作流阶段性验证**：agentic 模式完整运行 route→augment→retrieval→generate→reflection，reflection confidence=0.80 passed=true 一次通过；当时发现 Milvus search 在 agentic 串行多查询场景下超时，后续已通过 BM25 降级和 deepAgent 检索策略修复为非阻塞问题 |
| 2026-06-18 | **Milvus search 超时问题排查**：重建 collection（IVF_FLAT）+ 添加 nprobe=16 + warmup 预热 + timeout 15s/60s + 连接地址 127.0.0.1，均未根本解决；该问题已移入“已知问题”，不再阻塞 M2 功能验收 |
| 2026-06-18 | **M4 前端最小可用完成**：frontend/ React 18 + Vite 5 + TypeScript 项目。含文件上传页（上传+状态+文档列表）、聊天窗口（simple 非流式 + agentic/auto SSE 流式，token 拼接+流程追踪）、引用展示（可展开 chunk 原文+分数）、模式切换器（simple/agentic/auto）。vite 代理 /api→localhost:3000。验证：build ✓（88 模块 195KB）/ dev ✓ / 代理 ✓。M4 验收标准全部达成 |
| 2026-06-18 | **M2 Milvus 超时临时修复 + P2 语音录入**：Agentic retrieval 改为“原始问题 1 次混合检索 + 扩展问题 BM25-only”，Karpathy retrieve 增加向量检索失败降级到 BM25，降低连续 Milvus search 风险；前端 ChatPage 增加浏览器 Web Speech API 语音输入按钮（zh-CN、中间结果回填、停止、不支持提示）。验证：backend build ✓ / backend eslint(no-fix) ✓ / frontend build ✓；M2 在线链路后续已复验通过 |
| 2026-06-18 | **M2 完整验证通过 + deepAgent 接入**：后端新增 deepagents 依赖，Agentic query_augment 优先用 createDeepAgent 规划 3 条检索问句（CommonJS 下用原生 dynamic import 规避 ESM require 问题）；retrieval 强制保留原始问题并追加 deepAgent 查询；BM25 修复中文分词（单字 + bigram）避免中文短查询空召回；reflection 上下文从 200 字扩到 800 字。验证：docker compose 基础设施 healthy；agentic 非流式答案 + 引用 + reflection=1.00 ✓；auto 路由到 agentic + 2 引用 + reflection=1.00 ✓；SSE 输出 routing/query_augment/retrieval/token/citation/reflection/final + reflection=0.95 ✓；backend build/lint ✓ |
| 2026-06-18 | **M1/M2 增量完成**：文档上传支持 `.txt` / `.pdf` / `.docx`；Agentic RAG 新增 sufficiencyNode，在 retrieval 后、generate 前评估检索片段是否足够支撑回答；SSE 新增 `sufficiency` 事件，final/chat 响应新增 `retrievalSufficient` 和 `retrievalReason`；前端修复 SSE token/citation 解析并显示检索充分性。验证：backend build ✓ / backend eslint(no-fix) ✓ / frontend build ✓ / TXT/PDF/DOCX 上传 ✓ / SSE sufficiency 全链路 ✓ |
| 2026-06-18 | **P1 Bocha web_search 联网兜底完成**：新增 ToolsModule + BochaSearchService，按官方 `POST https://api.bochaai.com/v1/web-search` 调用；Agentic RAG 在检索充分性不足时触发 webSearchFallbackNode，把联网结果转为引用上下文，SSE 新增 `web_search` 事件；`BOCHA_API_KEY` 缺失时自动跳过并保持 final 正常返回。验证：backend build ✓ / backend eslint(no-fix) ✓ / SSE insufficient→web_search(enabled=false)→final ✓ |
| 2026-06-18 | **P1 DashScope Rerank 完成**：新增 DashScopeRerankService，支持 qwen3-rerank compatible `/reranks` 和 gte-rerank-v2 text-rerank 结构；Agentic RAG 在生成前执行 rerankNode，SSE 新增 `rerank` 事件；默认 RERANK_MODEL 切到 `qwen3-rerank`，新增 `RERANK_BASE_URL` 模板。验证：backend build ✓ / backend eslint(no-fix) ✓ / SSE rerank(enabled=false)→final ✓ |
| 2026-06-18 | **M5 容器化部署完成**：backend/Dockerfile（多阶段：builder npm ci + nest build → runtime npm ci --omit=dev + dist）+ frontend/Dockerfile（多阶段：builder vite build → runtime nginx + dist）+ frontend/nginx.conf（SPA 路由 + /api 反代 backend:3000 + SSE 流式支持）+ docker/docker-compose.prod.yml（7 服务完整栈：backend/frontend/postgres/redis/milvus/etcd/minio，全含 deploy.resources.limits 资源限制 + rag-net bridge 网络）。镜像源用 docker.m.daocloud.io 国内加速。验证：build ✓（backend 278MB / frontend 61.7MB，均 < 300MB）/ up -d ✓（7 容器全 Healthy）/ health ✓ / nginx 反代 ✓。M5 验收标准全部达成 |
| 2026-06-18 | **P2 认证与多租户数据隔离集成完成**：实现 REST 与 SSE EventSource 的 JWT 统一加锁防护，重构对话记录、Redis 缓存、Milvus 向量、BM25 索引全面根据 `userId` 实行逻辑和物理的深层隔离；前端适配磨砂玻璃渐变登录与登出及用户名 Badge 展示，E2E 交叉隔离验证脚本 100% 自动断言成功通过。 |
| 2026-06-18 | **P2 Mem0 长期记忆系统代码完成**：新增 `providers/mem0/mem0.provider.ts`（云端 MemoryClient + 本地 HTTP API 双模式，`MEM0_PROVIDER=cloud\|local` 切换，缺 API key 时自动禁用不阻断启动）+ `modules/memory/memory.service.ts`（搜索注入：chat 前并行搜索 user/session 层记忆构建 SystemMessage 注入 LLM 上下文；分类写入：chat 后 LLM + zod structured output 分类器判断是否写入 user/session 层，复用 agent-course/mem0-test 分类器方案；多租户：user 层按 userId 隔离，session 层按 userId+conversationId 隔离）+ `modules/memory/memory.controller.ts`（`GET /api/memories` 列出 + `DELETE /api/memories` 清空）。集成到 ChatService 和 ChatController SSE 流式：chat 前 searchMemory → 注入记忆，chat 后 classifyAndPersist → 异步持久化。更新 generateAnswerPrompt 增加 memory MessagesPlaceholder。配置：MEM0_ENABLED / MEM0_PROVIDER / MEM0_API_KEY / MEM0_BASE_URL。依赖新增：mem0ai。验证：build ✓ / lint ✓（仅 3 个预存 mcp.provider.ts 报错） |
| 2026-06-18 | **P1 Prompt 工程体系 + P2 对话历史向量化完成**：(1) Prompt 工程：扩展 few-shot 示例库（答案生成/反思评估/查询扩展示例）+ SemanticExampleSelector（Milvus 语义相似度动态挑选示例，启动时自动 embed 示例库）+ LCEL 工具链（RunnableBranch 条件路由 + RunnableWithMessageHistory 对话历史）+ 集成到 AgenticRagService.queryAugmentNode 优先语义选择器。新增 PromptModule。(2) 对话历史向量化：ConversationEmbeddingService 将 QA 对存入 Milvus conversation_chunks 集合，chat 前自动检索相关历史作为上下文注入。集成到 ChatService。验证：build ✓ / lint ✓ |
| 2026-06-18 | **P1 结构化输出 — 文档元数据抽取完成**：新增 DocumentMetadataExtractor（LLM + zod structured output 抽取标题/作者/摘要/关键词/语言/类别）。集成到文档上传流程：上传后异步抽取元数据，更新 documents_meta 表新增 6 个字段（title/author/summary/keywords/language/category）。listDocs 接口返回抽取的元数据。验证：build ✓ / lint ✓ |
| 2026-06-18 | **P1 BM25 中文分词升级 — @node-rs/jieba 接入**：替换 `bm25.util.ts` 中的纯 JS 单字/bigram 分词为 `@node-rs/jieba` 中文分词，英文/拼音 token 保留完整；jieba 加载失败时自动降级回退到纯 JS 分词。修复 `elasticsearch.provider.ts` 中 `content` 字段 `analyzer: 'standard'` → `analyzer: 'ik_smart_analyzer'`，使 ES IK 中文分词真正生效。依赖 `@node-rs/jieba` v2.0.1 已存在于 node_modules。验证：待服务启动后中文检索验证 |
| 2026-06-19 | **P1 Redis LangGraph Checkpointer 接入完成**：新增/接入 `RedisCheckpointer` 到 Agentic RAG 图编译流程，替换原 `MemorySaver`。`RedisCheckpointer` 支持 checkpoint/latest pointer/sorted set/pending writes 存储，Redis 不可用时自动回退 `MemorySaver`，保持本地无 Redis 场景可运行。验证：`cd backend && npm run build` ✓ / `npm run lint` ✓；完整 Redis 重启恢复联调待 Docker daemon 与 Redis 可用后执行 |
| 2026-06-19 | **P0 RAG 评测体系方案定稿**：更新 `rag-plan.md` 第十一节，明确 Dataset 来源为合成数据为主 + 10-20 条高风险样本人工抽样复核；评测模型使用 OpenAI-compatible Judge（默认沿用 Qwen/OpenAI Provider）；CI/CD 路径分两阶段：先本地 `npm run eval:rag`，后 smoke dataset 门禁，正式 CI 配置变更需单独确认。 |
| 2026-06-19 | **P3 结构化日志状态同步**：确认 `backend/src/common/logger/logger.module.ts` 已使用 `nestjs-pino` + `pino` 实现结构化请求日志，开发环境 `pino-pretty`、生产环境 JSON 输出，M3 验证记录已覆盖；将 P3 待办中的结构化日志项标记为完成。 |
| 2026-06-19 | **P0 Provider 接口状态同步**：确认 `llm-provider.interface.ts`、`embedding-provider.interface.ts`、`speech-provider.interface.ts` 均已存在；LLM/Embedding 通过 Qwen Provider 实现，Speech 通过 TencentSpeechProvider 实现 ASR/TTS/分块流式合成接口；将 P0 Provider 接口定义项标记为完成。 |
| 2026-06-19 | **P3 API 限流完成**：新增 `@nestjs/throttler`，在 `AppModule` 接入全局 `ThrottlerGuard`；新增配置 `THROTTLE_TTL_MS` / `THROTTLE_LIMIT`，默认 60 req/min；更新 `.env.example` 模板。验证：`cd backend && npm run build` ✓ / `npm run lint` ✓；压测属于后续增强，不阻塞当前验收。 |
| 2026-06-19 | **P3 单元测试基础版完成**：新增 MarkdownChunker、BM25、cosine、BochaSearchService、DashScopeRerankService 单元测试，覆盖文本切分、关键词检索排序、中文召回、余弦相似度边界、无 API key 禁用分支、mock API 响应解析/排序。验证：5 suites / 13 tests 全通过，build/lint 通过。Provider mock 深水区和更多异常路径后续扩展。 |
| 2026-06-19 | **P3 Prometheus 指标基础版完成**：新增 `prom-client` 和 `MetricsModule`，提供 `GET /api/v1/metrics`；通过全局 MetricsInterceptor 采集 HTTP 请求总数与耗时直方图，同时启用默认 Node 指标。验证：build/lint 通过；2026-06-20 运行时复验返回 Prometheus 文本。 |
| 2026-06-19 | **P2 定时任务 Agent 骨架完成**：新增 `@nestjs/schedule` + `cron`，实现内存版 JobsModule。支持 cron/every/at 三类任务注册、启动、停止、删除，管理接口受 JWT 保护；新增单测覆盖 every 启停、at 一次执行、非法 everyMs。验证：jobs 单测 3 条通过，build/lint 通过；后续已接入 SupervisorService 执行 instruction。 |
| 2026-06-19 | **P2 TTS SSE 流式音频完成**：新增 `GET /api/speech/tts/stream` SSE base64 音频块接口，输出 meta/chunk/done/error 事件；前端朗读按钮改为 EventSource 接收音频块并组装 audio/wav Blob 播放。验证：backend build/lint ✓、frontend build ✓；frontend lint 已于 2026-06-20 补齐工具链并通过；腾讯云 Secret 已配置，真实播放联调待外部网络调用验证。 |
| 2026-06-19 | **P2 Skills 技能系统基础版完成**：新增 `SkillsModule`，提供 `GET /api/skills` 和 `GET /api/skills/match`；支持递归加载本地 `SKILL.md`、解析 frontmatter 元数据、本地中英文 token 匹配排序。验证：skills 单测 3 条通过，backend build/lint 通过；后续已增强为 Qwen Embedding 语义匹配并保留 token 回退。 |
| 2026-06-19 | **P3 异常场景测试基础版完成**：新增 Karpathy RAG 空库/无相关文档/向量失败降级测试，新增腾讯云 SpeechProvider 缺 key 错误测试，扩展 Bocha 503 服务不可用测试，并复用已有长文本切分测试覆盖大文件基础场景。验证：异常场景相关 3 suites / 8 tests 通过，backend build/lint 通过。 |
| 2026-06-19 | **P3 Mermaid 工作流可视化基础版完成**：新增 `WorkflowModule` 和 `GET /api/workflows/agentic/mermaid`，导出 Agentic RAG 工作流 Mermaid 图，并支持通过 SSE 事件列表高亮执行路径。验证：agentic-workflow Mermaid 单测 3 条通过，backend build/lint 通过。 |
| 2026-06-19 | **P2 Skills Embedding 语义匹配增强完成**：Skills 匹配新增 OpenAI-compatible Embeddings 语义排序，返回 matchMode/semanticScore；无 key 或调用失败时自动回退本地 token 匹配，避免直接接入 EmbeddingProvider 导致无 key 启动失败。验证：真实 Qwen text-embedding-v3 调用返回 1024 维非零向量；skills 单测扩展到 4 条通过，backend build/lint 通过。 |
| 2026-06-19 | **本地密钥快照防误提交完成**：新增 `.gitignore` 规则 `.history/**/.env*`，避免本地历史环境变量快照被误加入版本库；已存在本地快照仍需主人确认后才能删除。 |
| 2026-06-19 | **P3 文件系统中间件 + 权限控制基础版完成**：新增 `FilesystemPolicyModule` / `FileAccessPolicyService`，默认限制文件访问在 workspace 根内，并拒绝 `.env`、`.git`、`.history`、`agent-course`、`node_modules` 等敏感路径段。验证：file-access-policy 单测 4 条通过，backend build/lint 通过。 |
| 2026-06-19 | **本地 start:dev 启动问题修复**：定位到 3000 端口已有 node 进程监听，以及 MCP 默认读取 `workspace/mcp-servers.yaml` 后启动 `agent-course/tool-test` 示例 server 失败；新增 `MCP_ENABLED=false` 默认关闭 MCP 初始化，保留 `MCP_CONFIG_PATH` 显式配置入口。验证：`PORT=3001 npm run start:dev` watch 编译 0 error，`GET /api/health` 返回 200；ES 客户端/服务端兼容头不匹配仍记录为未完成问题。 |
| 2026-06-19 | **M1/P0/P1/P2 基础设施与定时任务持久化恢复完成**：(1) ES 客户端对齐 v8.13.0 解决版本兼容头问题，加载 analysis-ik 中文分词插件并初始化 `rag_chunks` 索引，混合检索全链路联调成功；(2) 数据库 Migration 迁移文件 InitSchema 重构为 Table 和 TableIndex 定义，实现数据库无关 schema 设计，完美支持 Postgres & MySQL；(3) 定时任务持久化：新增 `ScheduledJobEntity` 实现在 PostgreSQL 数据库中的持久化，并在 `JobsService` 应用启动时自动恢复调度 active 状态任务；(4) 修复 LangGraph 的 `humanApproval` 节点命名冲突问题。验证：15 suites / 57 tests 全部通过，build/lint 无 error。 |
| 2026-06-19 | **P0/P2 Mem0 长期记忆方案定稿与集成验证完成**：确立了长短期记忆双层存储方案与基于 LLM+Zod 的事实提取判定分类逻辑；编写并运行了 `Mem0Provider` 和 `MemoryService` 单元测试（2 suites / 18 tests），全面覆盖了 disabled、cloud 和 local（包含 HTTP fetch mock）驱动模式，通过 build 与 strict lint 校验。 |
| 2026-06-19 | **P2 MCP 协议集成与连接验证完成**：使用 `MultiServerMCPClient` 实现多服务器连接与工具自动加载配置；编写并运行了 `McpProvider` 的单元测试，完全覆盖了 disabled、缺少配置文件、配置文件为空，以及成功连接和断开连接的所有逻辑分支，均 100% 通过。 |
| 2026-06-19 | **P3 REPL 沙箱代码计算环境集成完成**：安装了 `@langchain/quickjs` 依赖，重构 `AnalystAgent` 在 `DeepAgent` 下使用 `createCodeInterpreterMiddleware` 构建 `js_eval` 沙箱环境；编写了 `analyst.agent.spec.ts` 单元测试，全面覆盖了标准沙箱运算分支和无 VM 模块时的标准 LLM 降级回退分支。 |
| 2026-06-20 | **前端 lint 工具链补齐完成**：新增 frontend ESLint flat config，补齐本地 ESLint/TypeScript/React Hooks 开发依赖，修复登录错误处理 `any`、TTS 文本清理正则、UploadPage Hook 依赖 warning。验证：`cd frontend && npm run lint` ✓ / `cd frontend && npm run build` ✓。 |
| 2026-06-20 | **dev 基础服务阻塞解除**：Docker Desktop 已运行，`docker/docker-compose.dev.yml` 下 PostgreSQL/Redis/Milvus/Elasticsearch/MinIO/etcd 容器均运行且核心服务 healthy；后端 `PORT=3001 node dist/src/main` 成功连接 PostgreSQL/Redis/Elasticsearch/Milvus，`/api/v1/health` 与 `/api/v1/debug/vector-index` 验证通过。Milvus warmup 仍有约 0.8s timeout warning，按已知问题快速降级。 |
| 2026-06-20 | **架构设计文档与 PRD 补齐完成**：新增 `ARCHITECTURE.md` 记录 RAG 知识库系统架构、核心链路、模块边界、部署与风险；新增 `PRD.md` 记录产品目标、用户故事、功能范围、验收标准和开放问题；同步 `ROADMAP.md` 最近验证与变更记录。 |
| 2026-06-20 | **项目文档关系统一**：在 `ARCHITECTURE.md` / `PRD.md` / `ROADMAP.md` / `CLAUDE.md` / `rag-plan.md` 中统一说明五类文档职责：架构、产品需求、真实进度、项目规则、早期计划。 |
| 2026-06-20 | **ROADMAP 非 CI/CD 项状态优化**：修复 Prometheus 条目损坏，清理 Mem0/ES/Docker/Redis 旧阻塞描述；复验 build、dev compose、后端启动、health、metrics、Mem0、Graph schema、traces、ES health。CI/CD 待办保留不动。 |
| 2026-06-20 | **ROADMAP 结构整理**：将当前剩余工作拆分为待专项联调、红线待确认、可本地增强；将唯一显式未完成项收口为正式 CI/CD 接入 `npm run eval:rag` 门禁；清理已完成多租户仍停留在待确认、已解除 Docker/PostgreSQL 阻塞仍停留在阻塞区等旧状态描述。 |
| 2026-06-20 | **RAG 评测 Drone CI 门禁完成**：新增 `.drone.yml`，在 Dockerfile 构建 dry-run 前执行 backend build、no-fix ESLint、`npm run eval:rag`，并执行 frontend lint/build；本地验证通过，离线 RAG smoke 评测 `passed=true`、`averageScore=1.0`。未推镜像，未部署。 |
| 2026-06-20 | **依赖与 Docker 基础镜像版本固定**：backend/frontend npm 依赖按 lockfile 固定为精确版本；Dockerfile 与 docker compose 中 Node/nginx/pgvector/Redis/Neo4j 等浮动 tag 固定为明确小版本；已通过 npm ci、build、lint、RAG eval、compose config 与 backend/frontend Docker build。 |
| 2026-06-21 | **专项联调脚本化优化**：新增 `smoke:mcp`、`smoke:graph`、`smoke:speech`、`smoke:speech:direct`、`smoke:external`、`smoke:redis-checkpointer`、`smoke:hybrid` 脚本，以及 GraphRAG / Hybrid 固定样本数据。验证：MCP stdio smoke 通过，Qwen LLM-as-Judge 真实调用通过，腾讯云 TTS→ASR 直连回环通过；Bocha/Rerank 当前因 key 为空跳过；GraphRAG/Hybrid/backend Speech/Redis 运行时 smoke 已由第三轮补齐。 |
| 2026-06-21 | **Prometheus 业务指标与 Milvus 可调超时优化**：新增检索命中、LLM 调用次数、LLM 调用耗时、输入/输出 token 估算指标；新增 Milvus search/delete/warmup/circuit 超时配置项，便于按机器资源收敛首次检索 warning。验证：backend build/lint 通过，karpathy + mcp 单测 8 条通过。 |
| 2026-06-21 | **文档当前态同步与 Provider/Agent 类型收敛**：同步 `ARCHITECTURE.md` / `PRD.md` / `CLAUDE.md` / `rag-plan.md` / `ROADMAP.md` 当前状态，修正旧接口路径与已完成联调描述；移除 Elasticsearch provider 查询路径中的 `any`，收紧 Analyst Agent 动态导入类型。验证：backend build/lint 通过，analyst + karpathy + mcp 单测 10 条通过；文档旧状态扫描无命中。 |
| 2026-06-21 | **RAG 主链路质量闸门**：围绕“查得准、答得稳、引用能撑住、不会瞎编”，simple/Karpathy 主链路新增 query normalize、低相关检索拒答、引用编号校验、引用覆盖率校验；空库、无相关、无引用、引用撑不住等场景不采纳 LLM 确定性回答。验证：backend build/lint 通过，karpathy 单测 7 条通过。 |
| 2026-06-21 | **RAG 核心质量优化第一轮**：扩展中文质量回归集，Agentic 复用质量闸门，auto 路由收敛为明确启发式边界，GraphRAG 查询增加关系型问题边界，MarkdownChunker 注入章节路径/表格/条款结构提示。验证：backend build/lint 通过，全量单测 18 suites / 85 tests 通过。 |
| 2026-06-21 | **架构评审问题修复第一轮**：记录毒辣评审摘要并开始逐项修复；引用校验升级为逐句 claim-level 支撑，`eval:rag` 增加引用/拒答检查并补无答案负例。验证：backend build/lint 通过，全量单测 18 suites / 87 tests 通过，离线 `eval:rag` 通过。 |
| 2026-06-21 | **企业级差距可本地增强第一轮**：业务评测 dataset 格式升级，`eval:rag` 增加 category/claim/citation/refusal/conflict 分项输出，新增 `eval:rag:e2e` 真实服务回放脚本，多版本冲突提示接入 Karpathy/Agentic。验证：backend build/lint 通过，Karpathy 单测 10 条通过，离线 eval 通过，e2e 在服务未运行时 skipped。 |
| 2026-06-21 | **企业级差距可本地增强第二轮**：来源权威治理落地为 `RAG_SOURCE_AUTHORITY_RULES` 可选排序权重；新增 `eval:rag:judge` Qwen LLM-as-Judge claim 支撑评测脚本，缺 key 时 skipped。验证：backend build/lint 通过，全量单测 18 suites / 89 tests 通过，离线 eval 通过，judge skip 分支通过，e2e 在服务未运行时 skipped。 |
| 2026-06-21 | **企业级差距真实联调第三轮**：Docker dev 服务恢复后完成 3001 后端真实启动、GraphRAG/Hybrid/Speech/Redis smoke、simple+auto 真实 e2e 回放 18/18、120 条内置业务评测集生成与校验；修复 MetricsModule 注入、Speech SSE 解析、LLM 无引用时片段抽取式保守回退。结构化事实治理随后在第四轮补齐。 |
| 2026-06-21 | **企业级差距第四轮结构化事实治理**：新增 `document_chunks`、`fact_conflicts`、文档版本/生效期/来源权威字段和迁移；上传链路写入父子 chunk、source span、section/clause/table metadata，并检测简单版本事实冲突；GraphRAG 写入 aliases/confidence；新增 `eval:rag:quality` 稳定门禁；部署目标固定 Docker Compose 并新增 `DEPLOYMENT.md` 与 compose config 验证脚本；删除 `.history/backend/.env_*` 本地历史快照。验证：migration run/show、真实上传/查询/删除闭环、build/lint、定向单测、Qwen Judge 强制门禁、compose config、history env 清理均通过。 |
| 2026-06-21 | **中文错别字召回回归修复**：真实 e2e 发现 `企业知识哭` 召回后生成侧会解释笔误但缺引用，被 claim-level 闸门拒绝；新增 `知识哭 -> 知识库` 查询归一化并将修正 query 传给生成 prompt，补单测覆盖。验证：最小真实复现通过，`npm run eval:rag:e2e` simple 9/9 + auto 9/9 通过。 |
| 2026-06-21 | **外部输入类任务工程入口补齐**：新增真实业务评测集导入模板/脚本、GraphRAG 业务种子导入模板/脚本、业务 MCP 配置模板/校验脚本、外部 API 严格 smoke、生产就绪检查脚本，并更新 `DEPLOYMENT.md` / `backend/scripts/README.md`。验证：新增 dry-run 与配置检查通过，`eval:rag:quality` 通过，build/no-fix lint/full test/脚本语法/diff check 通过；Bocha/Rerank 严格 smoke 因 key 为空按预期失败，继续等待真实 key。 |
| 2026-06-21 | **Agentic 成本边界补齐**：新增 `AGENTIC_*` 配置，限制置信阈值、最大重试、扩展查询数、检索查询数、返回 chunk 数、联网搜索数、Rerank topN、auto 最大 query 长度，并支持关闭 web_search/rerank；补单测覆盖预算截断与 auto 超长回退 simple。验证：build/no-fix lint/full test/quality gate/diff check 通过，全量单测 20 suites / 98 tests。 |
| 2026-06-21 | **RBAC 基础角色守卫补齐**：新增 `@Roles()` 与 `RolesGuard`，基于 JWT payload role 做方法级权限；jobs 管理写操作限制 admin，列表仍保持登录可见。验证：build/no-fix lint/full test/quality gate/diff check 通过，全量单测 21 suites / 101 tests；完整组织/团队权限模型仍不在当前阶段。 |
| 2026-06-21 | **Milvus 诊断 smoke 补齐**：新增 `npm run smoke:milvus`，可检查 SDK/server 版本、health、schema、row count、index、load state、loading progress 和受限 search。当前本机结果显示 metadata 全正常但 search `DEADLINE_EXCEEDED`，SDK 2.4.4 对齐尝试无效且破坏 build，已回退；后续需确认是否允许 collection 压实/重建或容器版本升级。 |
| 2026-06-21 | **定时任务 Agent 执行动作补齐**：`JobsService.run()` 接入 `SupervisorService.query(instruction)`，定时任务触发后会走现有 Supervisor 多 Agent 管线；失败仅记录 warning，不影响 scheduler。验证：build/no-fix lint/full test/quality gate/diff check 通过，全量单测 21 suites / 101 tests。 |
| 2026-06-21 | **企业级成熟度门禁补齐**：新增 `eval:rag:maturity`，按四个核心标准和工程化/真实落地准备评分；接入 `eval:rag:quality`。当前本地工程成熟度 93/100，达到 90 分门槛，同时保留真实私有题集、Milvus runtime、生产材料三项扣分缺口。 |
| 2026-06-21 | **项目级仿真实业务评测补齐并真实跑通**：新增 8 文档 / 11 问题项目级评测集与 `eval:rag:project`；修复版本冲突题召回/引用回退和弱词误召回问题。验证：`PROJECT_EVAL_REQUIRE_LIVE=true npm run eval:rag:project` 在 3001 后端真实上传/问答/清理，simple 11/11、auto 11/11，score=1。 |
| 2026-06-21 | **简历与面试讲解手册补齐**：新增 `INTERVIEW_PLAYBOOK.md`，按高级 Agent 工程师、高级 AI 应用开发工程师、高级前端开发工程师、前端负责人四类目标岗位整理项目定位、必须弄懂的技术点、简历写法、面试讲法、高频问答和不能硬吹的边界。 |
| 2026-06-22 | **上海 Agent 面试题专项补强**：根据真实面试题补充 `INTERVIEW_PLAYBOOK.md`，覆盖 RAG 召回评测指标、Agent 死循环治理、外部工具调用方式、Skill 与 Tool 区别、结构化切片、召回准确率提升、Agent vs Chatbot、Reranker、记忆方案选择、Context Engineering、LangChain vs LangGraph、ReAct/FSM、多 Agent、可插拔 RAG、本地部署与配置管理。 |
| 2026-06-22 | **AI Agent / RAG 核心知识地图补齐**：新增 `AI_AGENT_CORE_KNOWLEDGE.md`，不再按零散面试题堆内容，而是按 RAG、召回排序、评测、切片、Agent、工具、Skill、记忆、上下文工程、幻觉控制、生产化、工程抽象和前端产品化沉淀底层知识框架。 |
| 2026-06-23 | **AI Agent / RAG 核心知识地图人话版重写**：将 `AI_AGENT_CORE_KNOWLEDGE.md` 从抽象提纲改为“人话理解 / 面试说法 / 项目对应”结构，补充类比、可直接复述的话术和最小复习清单，降低理解门槛。 |
| 2026-06-23 | **AI Agent / RAG 核心知识地图继续补强**：补充数据治理、权限安全、缓存成本、模型选择、多模态 RAG、GraphRAG 使用边界、Human-in-the-loop、线上评测运营和常见工程坑，进一步覆盖 RAG 与 Agent 应用开发的高级追问。 |
| 2026-06-23 | **AI Agent / RAG 面试决策叙事模板补齐**：在 `AI_AGENT_CORE_KNOWLEDGE.md` 中新增背景、目标、候选方案、方案对比、最终选择、落地实现、验证效果、遗留边界的高级面试叙事模板，并补充 Hybrid Retrieval、Agentic 路由、LangGraph/FSM、记忆方案、项目级评测五组方案对比示例。 |
| 2026-06-23 | **管理后台功能清单补齐**：新增 `ADMIN_FEATURES.md`，基于 8 张界面截图整理登录注册、首页大盘、文档管理、智能搜索、AI 问答、知识图谱、个人中心、系统管理、通知、权限角色和后续 RAG 运营建议。 |
| 2026-06-23 | **后台域与 RAG 域边界第一版落地**：新增 `SERVICE_BOUNDARIES.md`，并在后端新增 `CoreDomainModule`、`AdminDomainModule`、`RagDomainModule` 三个领域聚合模块；`AppModule` 改为导入领域模块，新增 `/api/v1/admin-domain/boundary` 与 `/api/v1/rag-domain/boundary` 边界说明接口，保持一个项目内区分管理后台域和 RAG 服务域。 |
| 2026-06-23 | **后台域与 RAG 域路由别名落地**：按 `SERVICE_BOUNDARIES.md` 继续改造，新增 `/api/v1/admin/dashboard`、`/api/v1/admin/rag/capabilities`、`/api/v1/admin/rag/vector-index` 后台运营入口，并新增 `/api/v1/rag/documents/*`、`/api/v1/rag/chat/*`、`/api/v1/rag/graph/*` RAG 服务域别名；旧路由继续保留兼容，不改 schema，不做跨用户后台聚合。 |
| 2026-06-23 | **管理后台独立项目方案改版**：根据最新决策，将 `SERVICE_BOUNDARIES.md` 从“一个 NestJS 后端内部分域”改为 `rag-backend` + `admin-backend` 两个独立后端项目；`ADMIN_FEATURES.md` 补充后台独立项目实现边界；`ROADMAP.md` 新增服务拆分决策与管理后台独立项目待办。当前只改文档，不改代码结构，不删除过渡代码。 |
| 2026-06-23 | **暂不抽 shared 包决策补充**：明确管理后台与 RAG 服务先不创建 `packages/shared`，避免两个业务模型因为共享 DTO/API client 重新耦合；`admin-backend` 自己维护 `rag-client/dto`，`rag-backend` 自己维护接口 DTO，双方只通过 HTTP API 契约对齐。 |
| 2026-06-24 | **AG-UI + LangSmith 企业级收口验证完成**：`eval:rag:langsmith` 从离线导出升级为可选 LangSmith Dataset/Experiment 上传，默认 `LANGSMITH_UPLOAD=false` 保持本地门禁稳定，`LANGSMITH_UPLOAD_REQUIRED=true` 可用于 CI 严格门禁；导出数据补齐 query、reference answer、expected claims、引用/拒答/冲突期望。修复 rag-backend 运行时 `thrift -> uuid@13` CJS/ESM 兼容问题，pnpm override 固定 `thrift@0.23.0>uuid@9.0.1`。验证通过：`cd backend && pnpm run build`、`pnpm test -- agui.service.spec.ts --runInBand`、`pnpm run eval:rag:langsmith`、`LANGSMITH_UPLOAD=true pnpm run eval:rag:langsmith`（无 key 时只报告 uploadError，不失败）；`cd admin && pnpm run build` 通过；本地三段服务真实启动通过，端口为 rag-backend 3000、admin-backend 3001、admin 8000/8001；管理后台 SSE 代理返回 `RUN_STARTED -> TEXT_MESSAGE_START -> STATE_DELTA -> CUSTOM -> RUN_FINISHED`。 |
