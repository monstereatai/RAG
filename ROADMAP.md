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
- `ROADMAP.full-2026-06-25.md`：2026-06-18 至 2026-06-25 的完整历史进度备份。

## 当前结论

当前项目已经从 RAG demo 推进到可运营的企业级 RAG 原型：

- `backend/` 是 `rag-backend`：负责文档解析、结构化切片、Embedding、Milvus、BM25/ES、GraphRAG、Agentic RAG、AG-UI、引用校验、评测和工具接入。
- `admin-backend/` 是管理后台后端：负责后台登录态、用户/角色/权限、菜单、日志、通知、配置、大盘和 RAG 运营 API 代理。
- `admin/` 是管理后台前端：已完成大盘、文档、搜索、问答、图谱、个人中心、系统管理等主要页面。
- 前台 `frontend/` 和管理后台都已接入 RAG / AG-UI 相关能力。
- 本地工程成熟度门禁历史结果为 `93/100`，项目级仿真实业务评测历史结果为 `22/22` 通过。
- 生产级落地仍依赖真实业务数据、真实外部 key、目标机器/域名/证书/备份策略等外部输入。

## 当前服务拆分决策

- `backend/` 继续作为 RAG 服务，不继续在里面堆完整管理后台能力。
- `admin-backend/` 通过 HTTP 调用 `backend/` 的 RAG 运营 API，不直接 import RAG 内部 service，不直接读写向量库或 Neo4j。
- 当前不抽 `packages/shared`，避免两个业务模型因为共享 DTO/API client 重新耦合。
- `admin-backend` 自己维护 `rag-client/dto`；`backend` 自己维护 RAG API DTO；双方只通过 HTTP API 契约对齐。

## 当前核心标准

知识库后续不优先横向堆模块，优先把主链路做硬：

- **查得准**：query normalize、中文/英文混合召回、低相关拒答；GraphRAG / Agentic / Web Search 只在明确触发条件下增强。
- **答得稳**：普通问题优先走可解释的 hybrid retrieval，复杂问题才进入 Agentic。
- **引用能撑住**：答案必须显式引用命中的片段，关键回答内容需要能被引用片段支撑。
- **不会瞎编**：检索为空、低分、引用缺失、引用支撑不足时，不输出伪确定性结论。
- **可运营**：后台必须区分 loading / empty / error / demo / data，不静默 mock。

## 已完成且仍需记住的能力

- RAG 主链路：文档上传、解析、结构化 chunk、Embedding、向量检索、BM25/ES 混合检索、Rerank、生成、引用校验、低相关拒答。
- Agentic RAG：routing、query augment、retrieval、sufficiency、web search、rerank、generate、citation、reflection、final。
- AG-UI：前台与管理后台均有流式问答链路；admin-backend 代理支持 SSE 兜底和超时例外。
- GraphRAG：Neo4j、实体别名、关系置信度、schema/entities/relationships/search 运营接口。
- 评测：`eval:rag`、`eval:rag:quality`、`eval:rag:project`、`eval:rag:maturity`、`eval:rag:langsmith`。
- 多租户隔离：PostgreSQL、Redis、Milvus、BM25 等层面按 `userId` 隔离。
- 可观测：Prometheus 指标、traceparent、查询日志、RAG 运营分析。
- 管理后台：Dashboard、Documents、SearchOps、QaOps、GraphOps、Account、System、Notification、Audit 等主要模块。
- 面试知识沉淀：`INTERVIEW_PLAYBOOK.md` 和 `AI_AGENT_CORE_KNOWLEDGE.md` 已覆盖最近真实面试追问。

## 当前开放事项

### P0

- [ ] **真实私有业务毒题集**：需要主人提供 50-100 条真实业务问题、标准答案和来源文档，覆盖应答、拒答、跨文档冲突、时效版本、表格/制度条款。
- [ ] **真实生产目标材料**：目标机器、域名、证书、备份策略、监控接入方式仍待确认。

### P1

- [ ] **GraphRAG 真实业务图谱数据**：当前图谱链路和后台页面已完成，但真实价值依赖业务实体类型、关系类型、别名规则和初始数据源。
- [ ] **Milvus search 运行时治理**：历史本机环境出现 `DEADLINE_EXCEEDED` / warmup timeout warning，当前有快速失败和 BM25 降级，但仍值得按真实环境资源继续治理。
- [ ] **真实 Bocha / Rerank key 外部 smoke**：脚本和严格 smoke 入口已存在，等待真实 key。

### P2

- [ ] **admin GraphOps 浏览器截图复验**：`/graph-ops/nodes`、`/graph-ops/relations`、`/graph-ops/stats` 路由和接口已联调，仍缺视觉截图复验。
- [ ] **admin production build 复验**：最近一次因已有 `localhost:8000` dev server 持有 `.turbopack/lock` 未执行完成，未停止用户进程。
- [ ] **admin-backend verify 脚本修复**：`npm run verify` 被既有 Jest 参数传递问题阻塞；单独 build/lint/jest/migration check 可通过。

## 阻塞 / 红线

- 不修改 `.env`、密钥、token、CI/CD、生产部署配置，除非主人明确确认。
- 不执行数据库 schema 变更或数据迁移，除非主人明确确认。
- 不删除文件、目录或做 git 回滚，除非主人明确确认。
- 真实私有业务评测数据、真实业务 MCP server、Bocha/Rerank key、生产机器/域名/证书/备份策略均依赖主人提供。
- 当前 shell Node.js 曾显示为 v20.18.0，部分 admin 工具链要求 Node 22+；最终构建建议在 Node 22+ 复验。

## 最近验证

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
