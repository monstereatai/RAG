# ARCHITECTURE

> 企业级 RAG 知识库系统架构设计文档。本文描述当前代码真实架构，进度与缺口以 `ROADMAP.md` 为准。

## 1. 架构目标

本项目是面向企业知识问答场景的 Agentic RAG + Karpathy-style RAG Web 应用，目标是在可控成本下提供：

- 多租户隔离的知识库问答能力
- simple / agentic / auto 三种问答路径
- 文档上传、解析、索引、删除的闭环管理
- 向量检索、全文检索、BM25、联网搜索、Rerank、GraphRAG 的可组合检索能力
- JWT 鉴权、结构化日志、指标、追踪、评测和容器化部署能力

## 2. 总体架构

```mermaid
flowchart LR
  User["Web User"] --> Frontend["React + Vite Frontend"]
  Frontend --> Backend["NestJS API / SSE"]

  Backend --> Auth["Auth / JWT / Tenant Guard"]
  Backend --> Document["Document Module"]
  Backend --> Chat["Chat Module"]
  Backend --> Graph["GraphRAG Module"]
  Backend --> Memory["Memory Module"]
  Backend --> Observability["Logs / Metrics / Traces"]

  Document --> Parser["TXT / Markdown / PDF / DOCX Parser"]
  Parser --> Chunker["MarkdownChunker"]
  Chunker --> Embedding["Qwen Embedding Provider"]

  Embedding --> Milvus["Milvus Vector Store"]
  Chunker --> BM25["BM25 / Jieba Index"]
  Chunker --> ES["Elasticsearch IK Index"]
  Document --> Postgres["PostgreSQL Metadata"]

  Chat --> SimpleRag["Karpathy-style RAG"]
  Chat --> AgenticRag["LangGraph Agentic RAG"]
  Chat --> Memory
  AgenticRag --> Bocha["Bocha Web Search"]
  AgenticRag --> Rerank["DashScope Rerank"]
  AgenticRag --> Graph

  Memory --> Mem0["Mem0 Cloud / Local"]
  Graph --> Neo4j["Neo4j"]
  Chat --> Redis["Redis Cache / Checkpoint"]
```

## 3. 运行时组件

| 组件 | 技术 | 职责 |
|---|---|---|
| Frontend | React 18 + Vite | 登录、文档管理、聊天、SSE 展示、Debug 面板、语音输入和朗读 |
| Backend | NestJS + TypeScript | API、鉴权、业务编排、RAG 管线、Provider 管理 |
| PostgreSQL | pgvector/pgvector:pg16 | 用户、会话、消息、文档元数据、任务等关系数据 |
| Redis | redis:7-alpine | 缓存、短期记忆、LangGraph checkpoint |
| Milvus | milvusdb/milvus:v2.4.4 | 主向量数据库，存储文档 chunk embedding 和对话 embedding |
| Elasticsearch | 8.13.0 | 全文检索与中文 IK 分词检索 |
| Neo4j | 5-community | GraphRAG 图谱实体与关系存储 |
| MinIO / etcd | Milvus 依赖 | Milvus 对象存储和元数据依赖 |
| Mem0 | cloud / local | 长期记忆搜索与写入 |

## 4. 后端模块划分

```text
backend/src
├── common/        # Guards / filters / interceptors / decorators / logger / filesystem policy
├── config/        # 环境变量解析和配置映射
├── modules/       # auth / document / chat / memory / graph / jobs / skills / metrics / tracing 等业务模块
├── providers/     # llm / embedding / speech / vector-store / db / redis / elasticsearch / mem0 / neo4j / mcp
├── rag/           # karpathy / agentic / agents / prompts / router
├── tools/         # RAG 工具与 Graph search 工具
└── migrations/    # TypeORM migration
```

关键边界：

- `modules/*` 负责业务入口和用例编排。
- `providers/*` 负责外部系统或可替换能力封装。
- `rag/karpathy` 保持透明、可调试的简单 RAG 管线。
- `rag/agentic` 负责 LangGraph 工作流和多步骤 Agentic RAG。
- `common` 放横切能力，不承载业务规则。

## 5. 核心链路

### 5.1 文档入库链路

```mermaid
sequenceDiagram
  participant U as User
  participant F as Frontend
  participant B as Backend
  participant P as Parser
  participant E as Embedding
  participant V as Milvus
  participant S as Elasticsearch
  participant D as PostgreSQL

  U->>F: Upload file
  F->>B: POST /api/v1/documents/upload
  B->>B: JWT auth + userId
  B->>P: Parse file
  P->>B: Text content
  B->>B: Detect type + quality gate
  B->>B: Strategy routing + structure-aware chunking
  B->>E: Generate embeddings
  E->>V: Insert chunks by userId/docId
  B->>S: Index text chunks
  B->>D: Save document metadata
  B-->>F: docId / chunkCount
```

索引策略：

- Chunking 先按 Markdown 标题建立父子 Section，每个叶子 Chunk 重复完整 `headingPath`，避免切分后丢失 PRD、接口、测试章节语境。
- 游戏官网／活动业务文档采用结构保护切片：代码围栏保持完整；配置、概率和地区表格按完整行切分，并在每个表格 Chunk 重复表头；空单元格与转义竖线保持原列语义。
- 接口契约、测试／验收、版本／地区规则写入轻量内容类型标识，供 BM25／ES、向量召回和 Rerank 联合识别；父子关系、source span、clause 和 table metadata 继续写入 `document_chunks`。
- 入库先执行文档类型识别与质量报告，再选择 PRD／API／Design／Test／Config／Postmortem／General 切片策略。
- 检索采用“自适应候选召回 → RRF／权威排序 → Section／相邻块扩展 → 去重与来源限额 → Token 预算与首尾交错排布”的上下文治理链路。
- `documents_meta` 与 `document_chunks` 保存 project／activity／region／locale／channel／roleScope／documentType／lifecycle metadata；默认过滤 deprecated，历史对比显式放开。
- `rag_feedback` 保存真实用户反馈、错误归因、召回快照和回归集状态，未经审核不进入 Prompt 或 Few-Shot。
- `AddGameProductionRagGovernance` migration 为上述业务元数据、生命周期、query log 快照和反馈表提供 schema；本地开发库已执行，生产环境仍需独立审批。
- `role-presets.ts` 是岗位目录的唯一事实源，静态提供业务负责人、产品、设计、前端、后端、测试、运营和项目管理八个预设；前端通过 `GET /chat/role-presets` 获取，不重复维护角色 Prompt。
- 岗位预设在统一“业务负责人”基础身份上注入当前服务对象、职责和回答结构，并将角色别名归一为 `roleScope`；它不替代 RBAC，不新增数据库表。
- 用户端和管理后台 QA 工作台共用该目录：用户端调用 `/chat/role-presets`，管理后台经 `admin-backend /admin/qa-ops/role-presets` 代理 `/rag/admin/role-presets`；两条 AG-UI 链路都透传同一个 `rolePresetId`。
- Milvus 存储 dense vector，主 collection 默认 HNSW。
- Elasticsearch 存储全文检索索引。
- 内存 BM25 索引用于快速关键词召回和降级。
- 文档删除会删除元数据、BM25 索引、ES 索引和 Milvus 向量；Milvus 删除失败会进入进程内退避重试。

### 5.2 问答链路

```mermaid
flowchart TD
  Q["User Query"] --> Mode{"mode"}
  Role["Role preset + starter task"] --> Q
  Mode -->|simple| Simple["Karpathy RAG"]
  Mode -->|agentic| Agentic["Agentic RAG"]
  Mode -->|auto| Router["Routing"]
  Router --> Simple
  Router --> Agentic

  Simple --> Intent["Intent profile + business／role scope"]
  Intent --> Retrieve["BM25 + Milvus + ES"]
  Agentic --> Plan["Query augment / planning"]
  Plan --> Retrieve
  Retrieve --> Sufficiency["Sufficiency check"]
  Sufficiency -->|insufficient| Web["Bocha web search"]
  Sufficiency -->|sufficient| Rerank["DashScope rerank"]
  Web --> Rerank
  Rerank --> Expand["Section + neighbor expansion"]
  Expand --> Context["Dedup + diversity + budget"]
  Context --> Generate["LLM generation"]
  Generate --> Reflect["Reflection"]
  Reflect -->|pass| Final["Answer + references"]
  Reflect -->|retry| Plan
```

模式策略：

- `simple`：低延迟、透明、可调试，优先用于简单知识库问答。
- `agentic`：多步检索、查询扩展、联网兜底、Rerank、反思评估；通过 `AGENTIC_MAX_RETRIES`、`AGENTIC_MAX_AUGMENTED_QUERIES`、`AGENTIC_MAX_RETRIEVAL_QUERIES`、`AGENTIC_MAX_RETRIEVED_CHUNKS`、`AGENTIC_MAX_WEB_SEARCH_RESULTS`、`AGENTIC_MAX_RERANK_TOP_N` 控制成本边界。
- `auto`：根据问题复杂度和上下文自动选择路径；超出 `AGENTIC_MAX_AUTO_QUERY_LENGTH` 的长问题默认回到 simple，避免普通入口误触发高成本 Agentic 链路。

### 5.3 GraphRAG 链路

GraphRAG 默认可配置开启。当前 Neo4j 已在 dev / staging / prod compose 中支持：

- dev：`docker compose -f docker/docker-compose.dev.yml --profile graphrag up -d neo4j`
- staging：`docker compose -f docker/docker-compose.staging.yml --profile graphrag up -d`
- prod：`docker compose -f docker/docker-compose.prod.yml --profile graphrag up -d`

后端容器内必须使用：

```env
NEO4J_URL=bolt://neo4j:7687
```

本机开发时使用：

```env
NEO4J_URL=bolt://localhost:7687
```

## 6. 数据与隔离设计

系统以 `userId` 作为多租户隔离边界：

- PostgreSQL 查询按 `userId` 过滤。
- Redis key 包含用户或会话隔离维度。
- Milvus chunk metadata 包含 `userId`、`docId`，检索时过滤。
- BM25 索引按用户文档有效集合过滤。
- GraphRAG 查询按 `userId` 过滤图谱数据。
- SSE token 支持 query 参数鉴权，兼容浏览器原生 EventSource。

## 7. Provider 设计

项目通过 Provider 屏蔽外部能力差异：

| Provider | 当前实现 | 可替换方向 |
|---|---|---|
| LLMProvider | Qwen OpenAI-compatible | OpenAI / Anthropic / Ollama |
| EmbeddingProvider | Qwen text-embedding-v3 | OpenAI embeddings / local embeddings |
| SpeechProvider | Tencent ASR/TTS | 其它云服务或本地语音模型 |
| VectorStoreProvider | Milvus | pgvector |
| RelationalDBProvider | PostgreSQL | MySQL |
| Mem0Provider | Mem0 cloud/local | 关闭或本地部署 |
| Neo4jProvider | Neo4j driver | 关闭或独立图数据库 |
| McpProvider | MultiServerMCPClient | 多 MCP server |

设计约束：

- Provider 不应把外部异常扩散为核心问答不可用，除非该能力是当前请求的硬依赖。
- 可选能力缺 key 或服务不可达时应明确降级或返回可解释错误。
- 密钥只从 `.env` / 环境变量读取，不写入代码和日志。

## 8. 部署架构

### 8.1 本地开发

```bash
docker compose -f docker/docker-compose.dev.yml up -d
docker compose -f docker/docker-compose.dev.yml --profile graphrag up -d neo4j
cd backend && npm run start:dev
cd frontend && npm run dev
```

### 8.2 生产部署

默认不启用 GraphRAG：

```bash
docker compose -f docker/docker-compose.prod.yml up -d
```

启用 GraphRAG：

```bash
docker compose -f docker/docker-compose.prod.yml --profile graphrag up -d
```

生产 compose 中 backend 使用 Docker 网络服务名连接基础设施：

| 能力 | 容器内地址 |
|---|---|
| PostgreSQL | `postgres:5432` |
| Redis | `redis:6379` |
| Milvus | `milvus:19530` |
| Neo4j | `neo4j:7687` |

## 9. 可观测与质量门禁

已实现：

- pino JSON 结构化日志
- HTTP QPS / 延迟 / Node 默认指标
- RAG 业务指标：检索命中、LLM 调用次数、LLM 调用耗时、输入/输出 token 估算
- 上下文治理指标：`rag_retrieval_context_chunks`、`rag_retrieval_context_characters`、`rag_retrieval_expanded_chunks_total`
- Bad Case 闭环：非流式问答同步记录 query log 与召回快照，用户反馈绑定服务端快照，Admin 支持审核、归因和回归集标记
- 动态 Bad Case Few-Shot：只有人工审核且进入回归集的纠错样本写入独立 Milvus collection，生成前最多召回 2 条相似样本，当前知识证据优先
- W3C `traceparent` 兼容的 in-memory tracing
- Agent 节点 trace 与指标：记录 LangGraph 节点耗时、首 token、工具成功率、空召回、循环终止原因；单 trace 超过 15 个节点标记 `span_limit`
- 产研运 FSM：产品、设计、前端、后端、测试、运营顺序执行，每个岗位结构化输出并人工审批，驳回回退一节点，Redis Checkpointer 支持恢复
- 结构化短期记忆：压缩时提取角色、模块、变更前后、版本、生效期、证据、决策和开放问题，同时保留最近 6 轮原文
- Debug chunks 分数面板
- Agentic workflow Mermaid 导出
- RAG eval / E2E / perf 脚本
- RAG 质量闸门：query normalize、低相关拒答、逐句 claim-level 引用支撑校验、多版本冲突提醒
- 结构化事实治理：`document_chunks` 保存父子 chunk、source span、section/clause/table metadata、doc version、生效期、来源权威；`fact_conflicts` 保存第一版事实冲突记录
- 可选来源权威排序：`RAG_SOURCE_AUTHORITY_RULES` 按 docId / chunk 内容匹配来源权威权重
- LLM-as-Judge 质量门禁：`npm run eval:rag:quality` 默认不消耗 Judge key，`EVAL_RAG_JUDGE_REQUIRED=true` 时强制 Qwen 判断 claim 为 supported / contradicted / not_mentioned
- 企业级成熟度门禁：`npm run eval:rag:maturity` 按查得准、答得稳、引用能撑住、不会瞎编、可观测恢复、工程化门禁、真实落地准备打分；2026-08-03 当前本地工程成熟度 93/100，缺口是生产材料确认和 Milvus search runtime 降级，不把本地分数冒充生产就绪
- 项目级仿真实业务评测：`npm run eval:rag:project` 覆盖多文档、多部门、版本冲突、跨文档、缩写别名、无答案拒答和强引用；`PROJECT_EVAL_REQUIRE_LIVE=true` 时必须真实后端上传/问答/打分，2026-08-03 真实后端回放 simple/auto 共 28/28 通过
- 专项 smoke 脚本：MCP、GraphRAG、Speech、外部工具、Redis Checkpointer、Hybrid retrieval

待确认：

- 正式 CI/CD 接入属于红线，需单独确认后再改 workflow。
- 已提供 120 条内置业务场景回归评测集和 193 条私密模拟业务评测样本，覆盖多部门问题、标准答案、expectedClaims、引用要求和拒答要求；若要升级为主人公司真实私有业务评测集，仍需真实业务问题和标准答案输入。
- 真实生产发布仍需目标机器、域名、证书、备份和密钥注入策略。
- `RAG_MATURITY_REQUIRE_EXTERNAL=true` 会把真实私有业务评测集和生产材料作为硬阻塞；默认门禁不伪造外部输入。
- OTLP exporter 接入仍是后续增强，不影响当前本地可观测。

## 10. 已知风险

| 风险 | 当前处理 |
|---|---|
| Milvus search 偶发 timeout | search/delete/warmup/circuit 超时可通过环境变量配置，主检索快速失败并短期熔断，降级 BM25 |
| Milvus 删除偶发 timeout | 删除失败进入进程内退避重试，active docId 过滤避免残留命中进入答案 |
| GraphRAG 图谱为空 | 已提供 `smoke:graph` 和种子数据，并完成 Docker/Neo4j 真实运行时验证；真实业务图谱仍需业务数据源 |
| MCP 缺真实 server | 已提供本地 stdio smoke server；业务 MCP server 可追加到 `workspace/mcp-servers.yaml` |
| 外部 key 不完整 | Qwen Judge 与腾讯云语音直连已验证；Bocha / Rerank 缺 key 时脚本输出 skipped |
| Docker daemon 不可用 | 2026-06-21 已恢复并完成 GraphRAG / Hybrid / backend Speech / Redis smoke；后续若 Docker 关闭，对应 smoke 会失败或 skipped |
| 真实评测代表性 | 已新增 120 条内置业务评测集和 193 条私密模拟业务评测样本；主人公司真实私有业务样本仍需主人提供 |

## 11. 文档关系

- `ARCHITECTURE.md`：技术架构与设计约束。
- `PRD.md`：产品需求与验收标准。
- `ROADMAP.md`：真实进度源。
- `CLAUDE.md`：项目规则。
- `rag-plan.md`：早期计划和技术路线。
- `SUMMARY.md`：`agent-course/` 参考能力总结。
