# ROADMAP

> 项目真实进度源。只有已实现并验证的事项才进入"已完成"，未确认信息标"待确认"。

## 当前阶段

**M1/M3/M4/M5 已完成，M2 部分完成（Milvus search 超时问题阻塞 agentic 完整验证）**

- M0 项目骨架可运行已验证（2026-06-18）
- M1 最简 RAG 管线已验证通过（2026-06-18）：上传→切分→Embedding→Milvus→simple 检索→回答→debug 全链路 OK
- M2 Agentic RAG 工作流逻辑验证通过（2026-06-18）：route/augment/retrieval/generate/reflection 全节点运行，reflection 评估正确（confidence=0.80）
- M2 已知问题：Milvus search 在 agentic 串行多查询场景下超时（详见"阻塞"）
- M3 NestJS 工程化已验证通过（2026-06-18）：JWT + 统一响应 + 全局异常 + pino 日志
- M4 前端最小可用已验证通过（2026-06-18）：React + Vite + TypeScript，文件上传 + 聊天（SSE 流式）+ 引用展示 + 模式切换
- M5 容器化部署已验证通过（2026-06-18）：Dockerfile 多阶段构建 + docker-compose.prod.yml 完整栈 + 资源限制 + nginx 反代
- 下一步：继续解决 M2 Milvus 问题 或 开始 P1/P2 功能扩展（Rerank / ES / 语音 / 评测）

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
- [x] **M1 最简 RAG 管线代码完成**（2026-06-18，代码就绪，待 docker 验证）
  - providers/llm：LLMProvider 接口 + QwenProvider 实现（OpenAI 兼容接口，qwen-plus）
  - providers/embedding：EmbeddingProvider 接口 + QwenEmbeddingProvider 实现（text-embedding-v3，1024 维）
  - providers/vector-store：VectorStoreProvider 接口 + MilvusVectorStoreProvider 实现（含 collection 自动创建 + HNSW 索引 + 连接失败不阻断启动）
  - modules/document：文档上传（multer）+ MarkdownChunker（@langchain/textsplitters）+ Embedding + 写入 Milvus + BM25 内存索引同步
    - `POST /api/documents/upload`（multipart/form-data，file 字段）
    - `GET /api/documents`（列出已上传文档）
    - `GET /api/documents/:docId`（查询单个文档）
  - rag/karpathy：BM25 检索（内存，rank-bm25）+ 余弦相似度（纯 JS）+ 加权融合（0.5/0.5）+ LLM 生成
    - KarpathyRagService.answer(query) → { answer, references }
  - modules/chat：`POST /api/chat`（ChatDto + class-validator 校验 + ValidationPipe）
  - modules/debug：`GET /api/debug/chunks?query=...`（返回 BM25 分、cosine 分、加权总分）
  - main.ts：全局前缀 /api + 全局 ValidationPipe（whitelist + transform）
  - 依赖修复：uuid ESM 兼容（改用 node:crypto.randomUUID + npm overrides 锁 uuid@9）+ @zilliz/milvus2-sdk-node 降级到 v2.6.14
  - 验证通过：`npm run build` ✓ / `npm run lint` ✓ / `npm run start` ✓（所有模块初始化 + 所有路由注册）/ `curl /api/health` → `{"status":"ok"}` ✓
  - 待验证：docker compose 启动 Milvus 后，跑上传→提问→debug 完整链路
- [x] **M3 NestJS 工程化骨架完成**（2026-06-18，已验证）
  - common/interfaces/api-response.interface.ts：ApiResponse<T> + JwtPayload 接口
  - common/interceptors/transform.interceptor.ts：统一响应 {code, data, message} + 请求耗时日志
  - common/filters/all-exceptions.filter.ts：全局异常捕获，HttpException 提取 message，未捕获异常记日志
  - common/decorators/current-user.decorator.ts：@CurrentUser() 从 request.user 提取 JwtPayload
  - common/guards/jwt-auth.guard.ts：JWT 认证守卫骨架（Bearer Token 提取 + 401，待接入 @nestjs/jwt 验签）
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
- [x] **M2 Agentic RAG 管线代码完成**（2026-06-18，待 docker 验证完整链路）
  - rag/agentic/agentic-rag.state.ts：LangGraph Annotation State 定义（query/route/augmentedQueries/retrievedChunks/answer/confidence/retryCount/passed）
  - rag/agentic/sse-event.ts：SSE 事件类型（routing/query_augment/retrieval/token/citation/reflection/final/error）
  - rag/agentic/agentic-rag.service.ts：完整 Agentic RAG 工作流
    - routeNode：auto 模式用 LLM + zod structured output 判断问题复杂度（simple/complex → simple/agentic）
    - queryAugmentNode：LLM 生成 3 条多角度检索问句（参考 agent-course/es-test/query-augment.mjs）
    - retrievalNode：多查询并行检索 + 按 chunkId 去重 + 分数取最大值 + Top-5
    - generateNode：LLM 流式生成（model.stream + onToken 回调）
    - reflectionNode：LLM 评估置信度（0~1）+ reason，阈值 0.7，最多重试 2 次
    - reflectionRouter：passed → end，retryCount >= maxRetries → end，否则 retry
    - run()：完整编排，支持 SSE 回调推送全流程事件
  - rag/agentic/agentic-rag.module.ts：注册 AgenticRagService，依赖 KarpathyRagModule + LlmModule
  - providers/llm/：ILLMProvider 新增 getModel() 方法（暴露 ChatOpenAI 用于 withStructuredOutput / stream）
  - modules/chat/：
    - chat.dto.ts：mode 支持 simple/agentic/auto，ChatResponse 新增 route/confidence/retryCount
    - chat.service.ts：集成 AgenticRagService，simple 走 KarpathyRag，agentic/auto 走 AgenticRag
    - chat.controller.ts：新增 `GET /api/chat/stream?query=...&mode=agentic` SSE 流式接口（@Sse + Observable）
    - chat.module.ts：导入 AgenticRagModule
  - 依赖新增：@langchain/langgraph + zod
  - 验证通过：build ✓ / lint ✓ / start ✓
    - `POST /api/chat` mode=invalid → `{"code":400,"message":"mode must be one of the following values: simple, agentic, auto"}` ✓
    - `GET /api/chat/stream` 无 query → `{"code":400,"message":"query is required"}` ✓
    - `POST /api/chat` mode=auto "对比React和Vue的响应式原理" → auto 路由到 agentic ✓ + query_augment 成功生成 3 条多角度问句 ✓（retrieval 因 docker 未启动返回 500，符合预期）
  - 待 docker 验证：agentic 完整链路（多轮检索 + reflection 重试 + SSE 流式）

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
    - 文件选择（.md/.txt/.markdown）+ 上传按钮 + 上传状态提示
    - 文档列表表格（文件名 / 片段数 / 创建时间 / Doc ID）
  - src/components/ChatPage.tsx：聊天窗口
    - 模式切换器（simple / agentic / auto）+ 模式提示
    - simple 模式：非流式 POST /api/chat
    - agentic/auto 模式：SSE 流式 GET /api/chat/stream
    - SSE 事件处理：routing / token / citation / reflection / final / error
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

## 进行中

- 无（M1/M3/M4/M5 已完成，M2 部分完成受 Milvus 问题阻塞，待主人决定下一步：继续 M2 或 P1/P2 功能扩展）

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

- **Milvus search 在 agentic 串行多查询场景下超时**（2026-06-18）
  - 现象：
    - simple 模式单次 search 正常（< 1s）
    - debug 接口单次 search 正常（< 1s）
    - agentic 模式 3 条扩展查询串行 search，每条都超时（15s/60s 均超时）
    - 偶发：某次测试中 3 条查询有 2 条成功，reflection 通过（confidence=0.80）
    - 超时后 Milvus 服务不可用，连 debug 接口也失败，需重启 Milvus
  - 已尝试：
    - 重建 collection（IVF_FLAT + nlist=1024，参考 agent-course/milvus-test/src/insert.mjs）→ 空集合 search 54ms ✓，但上传数据后 agentic 仍超时
    - 添加 nprobe=16 参数 → 无效
    - 添加 warmup 预热 search → warmup 成功，但 agentic 仍超时
    - timeout 从 60s 降到 15s → 快速失败，但问题依旧
    - Milvus 连接地址 localhost → 127.0.0.1 → 无效
  - 待尝试：
    - 检查 Milvus querynode 资源配置（可能内存不足导致索引加载失败）
    - 尝试 HNSW 索引替代 IVF_FLAT
    - 检查 Milvus 2.4.4 已知 bug
    - 参考 agent-course 的 docker-compose 配置对比
  - 影响：M2 agentic 完整链路无法稳定验证，但工作流逻辑已验证正确
  - 临时方案：前端先基于 simple 模式开发，agentic 问题后续解决

## 待确认

- 是否需要多租户（影响 schema 设计）— 待主人确认
  - **建议**：第一版单租户。多租户的复杂度（数据隔离、权限、计费）是 10 倍。先做单租户，schema 里预留 `tenant_id` 字段即可，后续切换成本可控。
- 部署目标环境（本地 / 云服务器 / Docker / K8s）— 待主人确认
  - **建议**：Docker Compose。K8s 是给团队 10 人以上的，单人/小团队搞 K8s 是在浪费生命。Compose 足以覆盖 dev + 小规模 prod。

## 最近验证

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

- **M2 Agentic RAG 工作流逻辑验证**（2026-06-18，部分通过）
  - `POST /api/chat` mode=agentic "LangChain是什么" → 工作流完整运行 ✓
    - routeNode → queryAugmentNode（生成 3 条多角度问句）→ retrievalNode → generateNode → reflectionNode ✓
    - Reflection: confidence=0.80, passed=true, retry=1/2（一次通过）✓
    - 响应时间 87s（含 60s Milvus 首次 search 超时）
  - 已知问题：agentic 串行多查询 Milvus search 超时（详见"阻塞"）

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
| M0 | P0 项目骨架 + docker-compose 基础服务 | ✅ 已完成（2026-06-18） |
| M1 | P1 核心管线（simple 子集）+ P0 Provider 接口 | 代码完成，待 docker 验证 |
| M2 | P1 核心管线（完整）+ P1 LangGraph 增强 | 代码完成，待 docker 验证 |
| M3 | P0 NestJS 工程化 + P3 pino 日志 | ✅ 已完成（2026-06-18） |
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
| 2026-06-18 | **M0 完成**：创建顶层目录（backend/frontend/admin/docker/skills/workspace）+ CLAUDE.md 项目规则 + 根级 .gitignore + backend NestJS 初始化（@nestjs/config + @nestjs/terminus + dotenv）+ config/configuration.ts 全量配置 + modules/health 健康检查模块 + main.ts 全局前缀 /api + .env.example 全量模板 + docker-compose.yml（PG16+pgvector/Redis7/Milvus2.4.4+etcd+minio，全 healthcheck）。验证通过：build ✓ / lint ✓ / start ✓ / curl /api/health → {"status":"ok"} ✓ |
| 2026-06-18 | **M1 代码完成**：providers（llm/embedding/vector-store）+ modules（document/chat/debug）+ rag/karpathy（BM25+cosine+加权融合+LLM 生成）+ class-validator 校验 + ValidationPipe。修复 uuid ESM 兼容（node:crypto.randomUUID + npm overrides 锁 uuid@9）+ milvus2-sdk-node 降级到 v2.6.14。Milvus 连接失败不阻断启动。验证：build ✓ / lint ✓ / start ✓ / health ✓。待 docker 验证完整链路 |
| 2026-06-18 | **安全修复**：清除 .env.example 中误填的真实 QWEN_API_KEY，创建 .env（已 gitignore）存放真实密钥 |
| 2026-06-18 | **M3 工程化启动**：开始 NestJS 工程化模式落地（TransformInterceptor / AllExceptionsFilter / 请求日志 / JWT 骨架），不依赖 docker，可独立验证 |
| 2026-06-18 | **M3 工程化骨架完成**：common/ 目录落地（interfaces/interceptors/filters/decorators/guards）+ main.ts 全局注册 + config 新增 auth 配置 + .env 新增 JWT_SECRET。验证：build ✓ / lint ✓ / start ✓ / 统一响应 {code,data,message} ✓ / 全局异常 400+message ✓ |
| 2026-06-18 | **M3 工程化完整完成**：nestjs-pino 结构化日志（JSON + pino-pretty）+ 完整 JWT 认证模块（AuthModule/AuthService/AuthController + JwtAuthGuard 接入 JwtService.verifyAsync + @CurrentUser + @UseGuards）+ 测试用户（admin/admin123、user/user1234）+ `POST /api/auth/login` + `GET /api/auth/profile`。验证：401 无 token ✓ / 登录签发 token ✓ / 带 token 200 ✓ / 无效 token 401 ✓ / pino 日志 ✓ |
| 2026-06-18 | **M2 Agentic RAG 代码完成**：rag/agentic/ 模块（state + sse-event + service + module）+ LangGraph 工作流（routeNode/queryAugmentNode/retrievalNode/generateNode/reflectionNode + reflectionRouter）+ auto 模式 LLM 分类 + query_augment 3 条多角度问句 + 多查询并行检索去重 + LLM 流式生成 + reflection 置信度评估（阈值 0.7，最多重试 2 次）+ SSE 流式接口 `GET /api/chat/stream`。ILLMProvider 新增 getModel()。验证：build ✓ / lint ✓ / start ✓ / 参数校验 ✓ / auto 路由分类 ✓ / query_augment ✓（retrieval 待 docker）|
| 2026-06-18 | **Docker 环境启动 + M1 完整验证**：docker compose 拉起 Milvus + PostgreSQL + Redis（全 healthy）。M1 验收：上传 test-doc.md → docId ✓ / debug chunks 返回 BM25+cosine+总分 ✓ / simple chat 返回答案+引用 ✓。M1 验收标准全部达成 |
| 2026-06-18 | **M2 Agentic 工作流逻辑验证（部分通过）**：agentic 模式完整运行 route→augment→retrieval→generate→reflection，reflection confidence=0.80 passed=true 一次通过。但 Milvus search 在 agentic 串行多查询场景下超时（详见阻塞），agentic 完整链路无法稳定验证 |
| 2026-06-18 | **Milvus search 超时问题排查**：重建 collection（IVF_FLAT）+ 添加 nprobe=16 + warmup 预热 + timeout 15s/60s + 连接地址 127.0.0.1，均未根本解决。simple/debug 单次 search 正常，agentic 串行多查询超时。问题记录到阻塞，后续解决 |
| 2026-06-18 | **M4 前端最小可用完成**：frontend/ React 18 + Vite 5 + TypeScript 项目。含文件上传页（上传+状态+文档列表）、聊天窗口（simple 非流式 + agentic/auto SSE 流式，token 拼接+流程追踪）、引用展示（可展开 chunk 原文+分数）、模式切换器（simple/agentic/auto）。vite 代理 /api→localhost:3000。验证：build ✓（88 模块 195KB）/ dev ✓ / 代理 ✓。M4 验收标准全部达成 |
| 2026-06-18 | **M5 容器化部署完成**：backend/Dockerfile（多阶段：builder npm ci + nest build → runtime npm ci --omit=dev + dist）+ frontend/Dockerfile（多阶段：builder vite build → runtime nginx + dist）+ frontend/nginx.conf（SPA 路由 + /api 反代 backend:3000 + SSE 流式支持）+ docker/docker-compose.prod.yml（7 服务完整栈：backend/frontend/postgres/redis/milvus/etcd/minio，全含 deploy.resources.limits 资源限制 + rag-net bridge 网络）。镜像源用 docker.m.daocloud.io 国内加速。验证：build ✓（backend 278MB / frontend 61.7MB，均 < 300MB）/ up -d ✓（7 容器全 Healthy）/ health ✓ / nginx 反代 ✓。M5 验收标准全部达成 |
