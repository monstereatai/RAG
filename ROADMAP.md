# ROADMAP

> 项目真实进度源。只有已实现并验证的事项才进入"已完成"，未确认信息标"待确认"。

## 当前阶段

**技术栈已确认（NestJS / Node.js），rag-plan.md 已对齐 26 个实战项目，待启动项目骨架**

- rag-plan.md 已定稿（含改进建议 + agent-course 26 项目经验补充）
- 技术栈选型已确认：NestJS + LangChain.js + LangGraph.js + DeepAgents.js
- rag-plan.md 已同步更新为 Node.js 生态（架构图、依赖清单、代码示例、改进建议全部对齐 NestJS / TypeScript）
- SUMMARY.md 已扩展到 26 个实战项目（含 pgsql/redis/neo4j/nest-feature/nest-dockerfile 等遗漏项目）
- 仓库尚未初始化项目骨架

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

## 进行中

- 无

## 待办

### P0 — 阻塞项，必须先解决

- [ ] **BM25 索引方案定稿**：内存 / JSON 持久化 / Elasticsearch BM25 三选一
- [ ] **对话历史 + Mem0 长期记忆方案定稿**：存储层、注入策略、分类器
- [ ] **RAG 评测体系方案定稿**：Dataset 来源、评测模型、CI/CD 集成方式

### P0 — 基础设施

- [ ] **项目骨架初始化**（NestJS + monorepo）
  - 后端：NestJS 项目（含 CLAUDE.md、.env.example、ESLint、tsconfig）
  - 前端：React + Vite 项目
  - 目录结构：backend / frontend / skills / workspace / docker
- [ ] **NestJS 工程化模式落地**（对齐 agent-course/nest-feature）
  - JWT 认证（@nestjs/jwt + AuthGuard）
  - 角色权限（@CurrentUser() 装饰器 + RBAC）
  - 统一响应（TransformInterceptor：{code, data, message}）
  - 全局异常（AllExceptionsFilter）
  - 参数校验（自定义 Pipe）
  - 请求日志（拦截器记录 method/url/耗时）
  - 目录结构：common/{decorators,filters,guards,interceptors,pipes,interfaces}
- [ ] Milvus + Elasticsearch 环境搭建（docker-compose，对齐 SUMMARY.md）
- [ ] Redis 环境搭建（对话历史 + 缓存）
- [ ] PostgreSQL + MySQL 环境搭建（可插拔，docker-compose）
- [ ] 数据库 schema 设计（chunks、documents、conversations、jobs、users，Milvus collection + ES index）
- [ ] TypeORM 迁移工具初始化（关系型数据：users/conversations/jobs，支持 PostgreSQL + MySQL）
- [ ] LLMProvider / EmbeddingProvider / SpeechProvider 接口定义
  - LLM：通义千问（qwen-plus/turbo）+ OpenAI 兼容
  - Speech：腾讯云 ASR/TTS（含流式 TTS）
- [ ] OpenAI-compatible Provider 实现
- [ ] VectorStoreProvider / RelationalDBProvider 抽象接口（可插拔多后端）

### P1 — 核心管线

- [ ] 文档上传 + 解析（PDF/Markdown/TXT/DOCX）
- [ ] Chunking 策略实现（按格式分策略，chunk_size/overlap 可配置）
- [ ] Embedding 生成 + 写入向量库（Milvus 或 pgvector，按配置）
- [ ] BM25 索引构建（含 @node-rs/jieba 中文分词）
- [ ] Karpathy-style RAG 管线（rank_bm25 + 纯 JS cosine 计算 + 加权融合）
- [ ] Agentic RAG 管线（LangGraph.js：query_rewrite → query_augment → retrieval → rerank → generate）
- [ ] 查询扩展（LLM 生成 3 条多角度问句，并行检索去重）
- [ ] 检索充分性评估（生成前判断，不足触发 web_search）
- [ ] Reflection 节点（含最大重试次数控制）
- [ ] Bocha web_search 工具集成
- [ ] DashScope Rerank 集成
- [ ] Mode Router（auto / agentic / simple）
- [ ] SSE 流式响应（routing/token/tool_call/retrieval/citation/final/error 事件）

### P1 — LangGraph 增强

- [ ] Checkpointer 状态持久化（MemorySaver / SqliteSaver / PostgresSaver）
- [ ] 子 Agent 编排架构（researcher/analyst/writer/critic/editor）
- [ ] 向量索引创建（HNSW，含 ef_search 配置）

### P1 — Prompt 工程与结构化输出

- [ ] **Prompt 工程体系**（对齐 agent-course/prompt-template-test + runnable-test）
  - PromptTemplate / ChatPromptTemplate / MessagesPlaceholder 模板层级
  - Few-shot 示例库（Milvus 语义检索挑选相关示例）
  - PipelinePromptTemplate 管道组合（大纲 → 正文 → 润色）
  - LCEL Runnable 编排（Sequence/Branch/WithMessageHistory/WithFallbacks）
- [ ] **结构化输出**（对齐 agent-course/output-parser-test）
  - model.withStructuredOutput(ZodSchema)（推荐方式）
  - 流式结构化输出
  - 文档元数据抽取（标题/作者/日期/摘要/关键词）
  - 实体关系抽取（用于 Neo4j 图谱构建）
  - 数据导入（非结构化文本 → 结构化数据写入 DB）

### P1 — 容器化部署

- [ ] **Docker 多阶段构建**（对齐 agent-course/nest-dockerfile-test）
  - Builder 阶段：npm ci + nest build
  - 运行阶段：仅生产依赖 + 编译产物（更小镜像）
- [ ] **docker-compose 多环境**
  - dev：热重载 + 全部服务（PostgreSQL/MySQL/Redis/Milvus/ES/Neo4j）
  - prod：仅必要服务 + 资源限制
- [ ] 完整栈编排（app + postgres + mysql + redis + milvus + elasticsearch + neo4j）

### P2 — 功能扩展

- [ ] 认证与多租户（JWT + user_id 隔离）
- [ ] 文档删除接口（Milvus + BM25 + ES 同步删除）
- [ ] 缓存层（Embedding 缓存 / 查询缓存 / 对话历史缓存）
- [ ] TTS 语音合成（SpeechProvider 扩展，SSE 流式音频）
- [ ] 定时任务 Agent（@nestjs/schedule 或 node-cron，cron/every/at 三种类型）
- [ ] Skills 技能系统（SKILL.md 加载 + 语义匹配）
- [ ] 图中断人工审批（interrupt + /chat/resume）
- [ ] Mem0 长期记忆集成（双层记忆 + 分类器）
- [ ] 对话历史向量化（conversation_chunks 表，include_history 参数）
- [ ] **MCP 协议集成**（对齐 agent-course/tool-test）
  - @langchain/mcp-adapters 的 MultiServerMCPClient
  - 支持 stdio 和 SSE 两种 transport
  - MCP Server 配置化管理（yaml 配置）
  - 工具来源标注（builtin / mcp:server_name）

### P2 — 前端

- [ ] React + Vite 项目初始化
- [ ] 文件上传 + 知识库列表页
- [ ] 聊天窗口（流式回答 + useChat）
- [ ] 引用来源展示（可展开 chunk 原文）
- [ ] 模式切换器（simple / agentic / auto）
- [ ] 路由追踪面板（实际模式 + 工具调用链）
- [ ] Debug 面板（BM25/cosine 分数 + 完整 Prompt）
- [ ] 语音录入（录音 → STT → 查询）
- [ ] TTS 朗读按钮
- [ ] 审批弹窗（interrupt 事件）

### P3 — 企业级能力

- [ ] Supervisor 多 Agent 架构（按领域路由：HR/财务/技术/法务）
- [ ] 文件系统中间件 + 权限控制（deny/allow 规则）
- [ ] REPL 数据分析（quickjs-emscripten 沙箱，复用 deepagents-test 方案）
- [ ] Mermaid 工作流可视化（图导出 + 执行路径高亮）
- [ ] **知识图谱 RAG（Neo4j）**（对齐 agent-course/neo4j-graphrag）
  - Neo4jGraph 连接（@langchain/community/graphs/neo4j_graph）
  - LangGraph.js 三节点：generateCypher → executeGraphQuery → generateAnswer
  - 路由判断（关系型查询走 GraphRAG，语义型走向量 RAG）
  - 图谱构建（结构化数据导入 + LLM 抽取实体关系）
  - 接口：POST /api/v1/graph/import、POST /api/v1/graph/query、GET /api/v1/graph/schema
  - 通过 GRAPH_RAG_ENABLED=true 启用，默认关闭
- [ ] API 限流与配额（@nestjs/throttler）
- [ ] 结构化日志（pino，JSON 格式）
- [ ] Prometheus 指标（prom-client，QPS / 延迟 / 检索命中 / token 消耗）
- [ ] OpenTelemetry 分布式追踪
- [ ] API 版本化（/api/v1/，NestJS 版本控制中间件）
- [ ] RAG 评测 CI/CD 集成（管线改动自动跑评测，分数下降阻断合并）

### P3 — 测试与运维

- [ ] 单元测试（chunking / BM25 评分 / cosine / Provider mock / Bocha mock）
- [ ] 集成测试（双索引一致性 / 三模式 / 流式事件顺序 / Debug 接口）
- [ ] E2E 测试（注册→上传→提问→切换模式→Debug→语音→删除全流程）
- [ ] 性能基准（simple P50<300ms / agentic P50<800ms）
- [ ] 异常场景测试（空库 / 无相关文档 / 大文件 / key 缺失 / 服务不可用）

## 阻塞

- 无（技术栈已确认，Dataset 已确认合成数据）

## 待确认

- 是否需要多租户（影响 schema 设计）— 待主人确认
  - **建议**：第一版单租户。多租户的复杂度（数据隔离、权限、计费）是 10 倍。先做单租户，schema 里预留 `tenant_id` 字段即可，后续切换成本可控。
- 部署目标环境（本地 / 云服务器 / Docker / K8s）— 待主人确认
  - **建议**：Docker Compose。K8s 是给团队 10 人以上的，单人/小团队搞 K8s 是在浪费生命。Compose 足以覆盖 dev + 小规模 prod。

## 最近验证

- 无（项目尚未开始编码）

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
- SSE 流式响应能正确推送 `routing / token / retrieval / citation / final` 事件
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
| M0 | P0 项目骨架 + docker-compose 基础服务 | 未开始 |
| M1 | P1 核心管线（simple 子集）+ P0 Provider 接口 | 未开始 |
| M2 | P1 核心管线（完整）+ P1 LangGraph 增强 | 未开始 |
| M3 | P0 NestJS 工程化 + P3 pino 日志 | 未开始 |
| M4 | P2 前端子集 | 未开始 |
| M5 | P1 容器化部署 | 未开始 |

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
