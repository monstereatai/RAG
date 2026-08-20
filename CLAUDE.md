# CLAUDE.md — 企业级 RAG 项目规则

> 本文件是项目最高规则。任何代码改动必须遵守此处约定。需要调整规则时先改本文件、再改实践。

## 项目定位

企业级 Agentic RAG + Karpathy-Style RAG Web 应用。详细规划见 `docs/plans/rag-plan.md`，进度见 `ROADMAP.md`，参考代码能力总结见 `docs/reference/SUMMARY.md`。

## 文档关系

- `docs/architecture/ARCHITECTURE.md`：技术架构与设计约束。
- `docs/product/PRD.md`：产品需求与验收标准。
- `ROADMAP.md`：真实进度源。
- `CLAUDE.md`：项目规则。
- `docs/plans/rag-plan.md`：早期计划和技术路线。
- `docs/README.md`：文档分类和阅读入口。

## 技术栈（锁死，未经主人确认不得更换）

### 后端
- **框架**：NestJS（TypeScript）
- **RAG**：LangChain.js + LangGraph.js + DeepAgents.js
- **向量库**：Milvus（主）/ pgvector（备），通过 `VECTOR_STORE_PROVIDER` 切换
- **关系型数据库**：PostgreSQL（主）/ MySQL（备），通过 `RELATIONAL_DB_PROVIDER` 切换，TypeORM 统一管理
- **搜索引擎**：Elasticsearch（IK 中文分词）
- **缓存/短期记忆**：Redis（ioredis）
- **LLM**：通义千问（qwen-plus/turbo）+ OpenAI 兼容接口
- **语音**：腾讯云 ASR/TTS
- **搜索工具**：Bocha Web Search
- **Rerank**：DashScope Rerank
- **长期记忆**：Mem0（云端 / 本地部署，可插拔）
- **日志**：pino（JSON 格式）
- **REPL**：quickjs-emscripten

### 前端
- **用户端**（frontend/）：React + Vite
- **管理后台**（admin/）：React + Vite + Ant Design，内置 Agent 控制台（DeepAgents 驱动）

### 基础设施
- **容器化**：Docker + Docker Compose
- **评测**：LangSmith + OpenEvals

## 目录结构

```
RAG/
├── agent-course/        # 参考代码（只读，禁止修改）
├── backend/             # NestJS 后端
│   ├── src/
│   │   ├── common/      # 工程化（decorators/filters/guards/interceptors/pipes/interfaces）
│   │   ├── config/      # 配置加载
│   │   ├── modules/     # 业务模块（每个模块独立目录：entity/service/controller/dto）
│   │   ├── providers/   # 可插拔 Provider（llm/embedding/speech/vector-store/db）
│   │   ├── rag/         # RAG 管线（karpathy / agentic / router）
│   │   ├── tools/       # LangChain 工具定义
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── .env.example
│   ├── .env             # 本地环境变量（不进 git）
│   └── package.json
├── frontend/            # 用户端前端（M4+）
├── admin/               # 管理后台前端（M4+）
├── admin-backend/       # 管理后台服务
├── rag-cli/              # RAG 命令行工具
├── tools/                # MCP 和外部工具服务
├── scripts/              # 项目级脚本
├── docker/              # Docker 编排
│   └── docker-compose.yml
├── skills/              # Skills 技能系统（M8+）
├── workspace/           # 运行时工作区（上传文件等，运行时内容不进 git）
├── docs/                # 项目文档、面试资料、方案、素材和验证证据
│   ├── architecture/   # 架构、服务边界和部署
│   ├── product/        # PRD、后台功能和集成说明
│   ├── plans/          # 技术方案和实施计划
│   ├── interview/      # 面试、简历和岗位材料
│   ├── cli/            # CLI 设计文档
│   ├── reference/      # 参考项目和能力总结
│   ├── archive/        # 历史文档
│   └── assets/         # 截图、面试素材和文档附件
├── CLAUDE.md            # 本文件
├── ROADMAP.md           # 进度源
└── docs/README.md        # 文档总索引
```

## 命名约定

- **文件**：业务模块用 kebab-case（`document.service.ts`）；类名用 PascalCase（`DocumentService`）
- **接口**：可插拔 Provider 接口以 `Provider` 结尾（`LLMProvider`、`VectorStoreProvider`）
- **环境变量**：全大写下划线（`VECTOR_STORE_PROVIDER`），分组用前缀（`MILVUS_*`、`REDIS_*`、`TENCENT_*`）
- **数据库表**：snake_case（`documents`、`conversation_chunks`）
- **API 路径**：`/api/v1/<resource>`，版本化从 M3 开始

## 验证命令（改完必须跑）

```bash
# 后端验证（在 backend/ 目录下）
cd backend && npm run build           # 编译通过
cd backend && npm run lint            # ESLint 通过
cd backend && npm test -- --runInBand # 相关单测，按改动范围可定向执行
cd backend && npm run start:dev       # 服务启动，若 3000 被占用使用 PORT=3001
curl http://localhost:3000/api/v1/health # 健康检查

# 基础设施验证（在 docker/ 目录下）
cd docker && docker compose ps        # 所有服务 healthy

# 专项 smoke（按本次改动选择执行）
cd backend && npm run smoke:mcp
cd backend && npm run smoke:external
cd backend && npm run smoke:speech:direct
cd backend && npm run smoke:redis-checkpointer
```

**纪律**：每次改动后必须跑相关验证。不要只改不验。

## 里程碑纪律（来自 ROADMAP.md）

- **M0 未达成前，禁止动 M1 的代码**
- **M1 未达成前，禁止实现 Agentic RAG / 前端 / 容器化等任何"高级"特性**
- 先跑通一条链路，再谈扩展
- 每个里程碑的验收标准见 `ROADMAP.md`，未达成不得进入下一个

## 红线（即使在 auto-accept 模式下也必须停下来问主人）

- 删除文件、目录或 git 回滚
- 修改 .env、密钥、token、CI/CD 配置
- 数据库 schema 变更或数据迁移
- 安装新的全局依赖或修改系统配置
- 公开发布（npm publish、部署到生产、发文章等）
- 修改 `agent-course/` 目录下的任何文件（参考代码，只读）

## 工程纪律

- **改完主动跑验证**，不要只改不验
- **不要为了让代码跑起来注释掉报错或加绕过标记**，找根本原因
- **密钥、token、密码不进代码、不进 commit、不进日志**
- **大改动前先出方案**，主人确认后再动手
- **不创建 .env 文件**，只创建 .env.example，.env 由主人手动填写
- **新依赖必须可追溯**：计划内依赖可安装，计划外依赖先确认并更新文档
- **不过度工程**：M0 只做 M0 的事，不提前实现 M1+ 的功能
- **精准修改**：只碰必须碰的，不"改进"相邻代码、不重构没坏的东西

## 当前阶段

**M0-M5 已完成，P0/P1/P2/P3 大部分能力已实现并验证；当前剩余工作集中在外部专项联调与红线确认项。**（2026-06-21）

## 开发环境要求

- **Node.js ≥ 22**（管理后台要求 Node ≥ 22；项目根目录有 `.nvmrc` / `.node-version`，`nvm use` 自动切换）
- **包管理器**：根目录统一使用 pnpm 10.17.1，通过 `pnpm-workspace.yaml` 纳管所有应用和工具包；各子项目原有锁文件与 workspace 配置暂时保留，用于兼容独立启动

已完成能力：
- M0 项目骨架：NestJS 后端、React/Vite 前端目录、Docker 基础设施、配置体系。
- M1 simple RAG：上传 Markdown/PDF/TXT/DOCX、切分、Embedding、写入 Milvus、BM25 内存索引、Karpathy-style 检索回答。
- M2 Agentic RAG：deepAgent 检索规划、Query 扩展、检索充分性评估、流式生成、置信度自我评估重试。
- M3 工程化与多租户隔离：JWT 认证保护、EventSource 流式 Token 兼容、统一响应/全局异常/日志，以及基于 `userId` 在数据库、Redis 缓存、Milvus 向量及内存 BM25 中的物理/逻辑硬隔离。
- M4 前端 MVP：磨砂渐变登录卡片、文件上传、聊天窗口、simple/agentic/auto 模式、流式事件追踪、Debug 属性面板、Web 语音输入、TTS 朗读按钮。
- M5 容器化：后端/前端多阶段 Dockerfile、prod compose、nginx 代理。
- P1 Prompt 工程体系：SemanticExampleSelector（Milvus 语义相似度挑选示例）+ LCEL 工具链（RunnableBranch/RunnableWithMessageHistory）+ 集成到 Agentic RAG 查询扩展。
- P1 结构化输出：DocumentMetadataExtractor（LLM + zod structured output 抽取标题/作者/摘要/关键词/语言/类别），集成到文档上传流程。
- P2 Mem0 长期记忆：Mem0Provider（云端/本地双模式）+ MemoryService（搜索注入+分类写入+分类器）+ 记忆管理 API（GET/DELETE /api/v1/memories），单元测试覆盖 cloud/local/disabled。
- P2 对话历史向量化：ConversationEmbeddingService 将 QA 对嵌入 Milvus，自动检索相关历史对话作为上下文。
- P2 MCP：MultiServerMCPClient + 本地 stdio smoke server，`npm run smoke:mcp` 已验证工具加载。
- P3 GraphRAG：Neo4j Provider、实体关系抽取、图谱导入/查询/schema 接口已实现，业务图谱联调脚本已准备。
- P3 可观测：Prometheus HTTP/Node/检索命中/LLM 调用/token 估算指标，traceparent in-memory tracing，workflow Mermaid。
- 专项 smoke：MCP、GraphRAG、Speech、external tools、Redis Checkpointer、Hybrid retrieval 脚本已挂到 `backend/package.json`。

当前已知问题：
- Milvus `search` 仍可能出现短暂 timeout warning。当前主检索快速失败、短期熔断、BM25 降级，且 search/delete/warmup/circuit 超时均可通过环境变量配置。
- 本机 Docker daemon 不可连接时，GraphRAG / Hybrid / backend Speech / Redis smoke 只能等待基础服务恢复后执行。

下一步建议：
- 恢复 Docker Desktop 后执行 `smoke:graph`、`smoke:speech`、`smoke:hybrid` 和 Redis 真实跨进程 smoke。
- 补齐 `BOCHA_API_KEY` / `RERANK_API_KEY` 后执行真实联网增强 smoke。
- 红线项（schema/migration、生产部署、删除 `.history` 快照、部署目标）必须主人单独确认。
