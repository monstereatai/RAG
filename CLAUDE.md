# CLAUDE.md — 企业级 RAG 项目规则

> 本文件是项目最高规则。任何代码改动必须遵守此处约定。需要调整规则时先改本文件、再改实践。

## 项目定位

企业级 Agentic RAG + Karpathy-Style RAG Web 应用。详细规划见 `rag-plan.md`，进度见 `ROADMAP.md`，参考代码能力总结见 `SUMMARY.md`。

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
├── docker/              # Docker 编排
│   └── docker-compose.yml
├── skills/              # Skills 技能系统（M8+）
├── workspace/           # 运行时工作区（上传文件等，.gitkeep，运行时内容不进 git）
├── CLAUDE.md            # 本文件
├── ROADMAP.md           # 进度源
├── SUMMARY.md           # 参考代码总结
└── rag-plan.md          # 规划文档
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
cd backend && npm run start:dev       # 服务启动
curl http://localhost:3000/api/health # 健康检查

# 基础设施验证（在 docker/ 目录下）
cd docker && docker compose ps        # 所有服务 healthy
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
- **新依赖必须先问**，不得擅自 `npm install` 未在 plan 中列出的包
- **不过度工程**：M0 只做 M0 的事，不提前实现 M1+ 的功能
- **精准修改**：只碰必须碰的，不"改进"相邻代码、不重构没坏的东西

## 当前阶段

**M1 — 最简 RAG 管线跑通**（M0 已完成于 2026-06-18）

M0 交付物：
- ✅ 顶层目录结构（backend/frontend/admin/docker/skills/workspace）
- ✅ CLAUDE.md 项目规则 + 根级 .gitignore
- ✅ backend/ NestJS 项目（@nestjs/config + @nestjs/terminus + dotenv）
- ✅ config/configuration.ts 全量配置加载
- ✅ modules/health 健康检查（`GET /api/health` → `{"status":"ok"}`）
- ✅ main.ts 全局前缀 `/api`
- ✅ backend/.env.example 全量环境变量模板
- ✅ docker/docker-compose.yml（PG16+pgvector / Redis7 / Milvus2.4.4 + etcd + minio，全 healthcheck）
- ✅ 验证通过：build / lint / start / curl /api/health

M1 验收标准（未达成不得进入 M2）：
- [ ] 上传 1 个 Markdown 文件，返回 `doc_id`
- [ ] 切分 + Embedding + 写入 Milvus 成功
- [ ] 用 `simple` 模式提问，5 秒内返回答案 + 引用来源
- [ ] `GET /api/debug/chunks?query=...` 返回 BM25 分、cosine 分、加权总分

**M1 不做的事**：
- 不实现 Agentic RAG / web_search / Rerank / 流式 / 多模式切换
- 不写前端
- 不写 Dockerfile
