# Agentic RAG + Karpathy-Style RAG Web 应用计划

## Summary

构建一个从零开始的 Web RAG 系统：前端支持文件上传、语音输入、流式回答；后端使用 NestJS、LangChain.js、LangGraph.js 和 DeepAgents.js；向量库使用 Milvus，全文检索使用 Elasticsearch（IK 中文分词）；模型、Embedding 和语音服务采用可插拔 Provider。

Karpathy 部分按照"极简、透明的 nano-rag 风格"实现一条手写检索管线（使用 `rank_bm25` + 纯 JS cosine 评分），并与 Agentic RAG 混合使用。两种方案可以在同一查询请求中按策略切换。

技术栈对齐 `agent-course` 实战经验（见 SUMMARY.md，共 26 个实战项目）：

- **LLM**：通义千问（qwen-plus/turbo）+ OpenAI 兼容接口
- **语音**：腾讯云 ASR/TTS（含流式 TTS）
- **搜索**：Bocha Web Search
- **Rerank**：DashScope Rerank
- **REPL**：QuickJS（quickjs-emscripten）
- **知识图谱**：Neo4j + Cypher（GraphRAG）
- **工具协议**：MCP（Model Context Protocol）
- **Prompt 工程**：LangChain PromptTemplate 全家族 + LCEL Runnable
- **结构化输出**：Zod + withStructuredOutput
- **工程化**：NestJS（JWT/Guards/Interceptors/Pipes/Filters）+ Docker Compose 部署

参考资料：

- [LangGraph.js Streaming](https://langchain-ai.github.io/langgraphjs/)
- [DeepAgents.js](https://github.com/langchain-ai/deepagentsjs)
- [LangChain.js Milvus](https://js.langchain.com/docs/integrations/vectorstores/milvus)
- [rank_bm25](https://github.com/dorianbrown/rank_bm25)
- [Bocha Search API](https://open.bochaai.com/)
- [DashScope Rerank](https://help.aliyun.com/zh/dashscope/developer-reference/api-details-9)

---

## 文档关系

- `../architecture/ARCHITECTURE.md`：技术架构与设计约束。
- `../product/PRD.md`：产品需求与验收标准。
- `../../ROADMAP.md`：真实进度源。
- `../../CLAUDE.md`：项目规则。
- `rag-plan.md`：早期计划和技术路线。

---

## 当前实现快照（2026-06-21）

- **M1/M2/M3/M4/M5 已完成**，真实进度以 `ROADMAP.md` 为准。
- **后端**：NestJS + LangChain.js + LangGraph.js + DeepAgents；已实现 auth/document/chat/debug/memory/graph/mcp/metrics/tracing/jobs/skills 等模块。
- **simple 模式**：Karpathy-style RAG，使用 BM25 / Elasticsearch / Milvus 混合检索；Milvus 超时快速降级，并通过 active docId 过滤避免残留向量进入答案。
- **agentic/auto 模式**：包含 route、query augment、retrieval、sufficiency、web_search、rerank、generate、reflection 和 resume 流程。
- **SSE**：`GET /api/v1/chat/stream` 输出 `routing / query_augment / retrieval / sufficiency / web_search / rerank / token / citation / reflection / final / error`。
- **前端**：React + Vite 已支持登录、文件上传、文档列表、聊天、引用展示、模式切换、SSE 流式显示、浏览器语音输入和 TTS 朗读。
- **专项 smoke**：已新增 MCP、GraphRAG、Speech、external tools、Redis Checkpointer、Hybrid retrieval 脚本；MCP stdio、Qwen Judge、腾讯云 TTS→ASR 直连已验证。
- **仍需资源**：Bocha/Rerank 真实 key、Docker daemon/后端服务用于 GraphRAG/Hybrid/backend Speech/Redis 运行时 smoke，生产部署目标仍待确认。

---

## Key Changes

### 后端架构

- 使用 NestJS 提供 REST API 和 SSE 流式接口。
- 使用 LangGraph.js 定义 Agentic RAG 工作流节点：
  - Query rewrite
  - Routing（由 DeepAgents.js 原生决策，不额外引入路由框架）
  - Retrieval（Milvus 向量检索 + Bocha 联网检索 + ES 关键词检索）
  - Rerank（DashScope Rerank）
  - Answer generation
  - Reflection / Self-Critique
- 使用 DeepAgents.js 处理复杂任务，包括规划、工具调用、多步检索和子任务分解。
- Karpathy-style RAG 作为独立模块，使用 `rank_bm25` + 纯 JS cosine 实现，不依赖 LangChain 检索器，便于调试与对照。

### 混用策略

两种方案在同一系统中互补运行，不互斥：

- **简单问题** 默认走 Karpathy-style 快速检索（rank_bm25 + 纯 JS cosine），延迟低、结果透明可调试。
- **复杂问题** 走 Agentic RAG，由 DeepAgents.js 判断是否需要多轮检索、查询改写、工具调用（含 Bocha 联网）和子任务分解。
- 提供以下运行模式（用户可在请求中强制指定）：
  - `auto`：DeepAgents.js 自动决策，作为默认值。
  - `agentic`：强制使用 Agentic RAG + 全部工具。
  - `simple`：强制使用 Karpathy-style 快速管线。

### Karpathy-Style RAG 模块（极简透明管线）

使用以下现有库，**不自己实现算法**：

| 功能 | 使用库 |
|---|---|
| 稀疏检索（BM25） | `rank_bm25`（`BM25Okapi`）+ `@node-rs/jieba` 中文分词 |
| 密集检索（cosine） | 纯 JS 实现（向量点积 / norm，不依赖 numpy） |
| 分数融合 | 线性加权：`score = α * bm25 + (1-α) * cosine` |
| Prompt Assembly | 纯 TypeScript 模板字符串，无框架 |
| Top-K 筛选 | `Array.sort() + slice()` |

**可观测能力**（内置 Debug 接口）：

- `GET /api/v1/debug/chunks?query=...` 返回每个 candidate chunk 的 BM25 分、cosine 分和最终分，用于调试。
- 在流式响应的 `retrieval` 事件中携带各 chunk 原始分数，前端 Debug 面板可展开查看完整 prompt。

### Agentic RAG 模块（工具调用 + 多轮检索）

DeepAgents.js + LangGraph.js，包含以下内置工具：

| 工具 | 实现方案 |
|---|---|
| `vector_search` | Milvus 向量检索（LangChain.js Milvus 集成） |
| `keyword_search` | BM25 关键字检索（`rank_bm25` + `@node-rs/jieba`，复用 Karpathy 模块） |
| `es_search` | Elasticsearch 全文检索（`multi_match` + `ik_smart` 分词，参考 agent-course/es-test） |
| `web_search` | Bocha Search API（参考 agent-course/deep-research-assistant/tools/search.mjs） |
| `query_decompose` | DeepAgents.js 内置规划能力，拆解多跳问题为子问题 |
| `document_summarizer` | LangChain.js `loadSummarizationChain`（map-reduce 模式） |
| `code_interpreter` | QuickJS REPL（quickjs-emscripten，参考 deepagents-test） |

**Multi-hop 检索**：Agent 最多执行 3 轮检索，每轮根据前一轮结果自动调整查询词。

**Reflection 节点**：LangGraph.js 中加入 Answer Critic 节点，对生成答案打置信分（0~1），低于阈值（默认 0.7）则触发重新检索。

### Router 策略（DeepAgents.js 原生决策）

不引入额外路由框架，由 DeepAgents.js 根据输入消息和工具上下文自动决策：

- 简单事实型问题 → DeepAgents.js 直接选择 `keyword_search` / `vector_search` / `es_search`，走 Karpathy 快速管线。
- 含多跳、比较、推理类问题 → DeepAgents.js 触发 `query_decompose` + 多轮工具调用，走 Agentic 管线。
- 需要联网补充知识时 → DeepAgents.js 自动调用 `web_search`（Bocha）。

流式响应新增 `routing` 事件，前端展示"本次实际使用的模式 + 工具调用链"。

提供以下显式运行模式（用户可强制覆盖）：

- `auto`：DeepAgents.js 自动决策，默认值。
- `agentic`：强制使用 Agentic RAG + 全部工具。
- `simple`：强制使用 Karpathy-style 快速管线（rank_bm25 + 纯 JS cosine）。

### 数据层

数据层采用**可插拔多后端**设计，向量库和关系型数据库均可通过配置切换，通过抽象接口 `VectorStoreProvider` 和 `RelationalDBProvider` 屏蔽底层差异。

**向量库**（二选一，通过 `VECTOR_STORE_PROVIDER` 环境变量切换）：
- **Milvus**：独立向量数据库，高性能分布式检索（对齐 SUMMARY.md，生产推荐）
- **PostgreSQL + pgvector**：复用 PostgreSQL，单库简化运维（轻量场景推荐）

**关系型数据库**（二选一，通过 `RELATIONAL_DB_PROVIDER` 环境变量切换）：
- **PostgreSQL**（TypeORM）：默认，支持 pgvector 复用
- **MySQL**（TypeORM）：兼容已有 MySQL 基础设施的场景

**全文检索**：
- **Elasticsearch**（IK 中文分词）：关键词检索引擎，与向量库形成混合检索（参考 agent-course/es-test）

**缓存与短期记忆**：
- **Redis**：对话历史短期记忆 + 缓存层

**Chunk metadata 标准字段**：

```json
{
  "chunk_id": "uuid",
  "doc_id": "uuid",
  "source_file": "paper.pdf",
  "page": 3,
  "char_start": 1024,
  "char_end": 2048,
  "chunk_index": 7,
  "embedding_model": "text-embedding-3-small",
  "created_at": "ISO8601"
}
```

- 支持按 `doc_id` 过滤检索，避免跨知识库干扰。
- 支持增量更新：文档修改后只重新索引变更 chunk，不全量重建。
- 第一版支持以下文件格式：
  - PDF
  - Markdown
  - TXT
  - DOCX
- 文档处理流程：
  1. 上传
  2. 解析
  3. 切分
  4. 生成 embedding（OpenAI-compatible Provider）
  5. 写入向量库（Milvus 或 pgvector，按配置）
  6. 写入 ES 索引（IK 分词）+ BM25 内存索引（rank_bm25 + @node-rs/jieba 分词）
  7. 查询处理状态

### 模型抽象

- 定义 `LLMProvider`、`EmbeddingProvider` 和 `SpeechProvider` 接口（TypeScript）。
- 第一版支持：
  - **LLM**：通义千问（qwen-plus / qwen-turbo）+ OpenAI 兼容接口（参考 agent-course 各项目）
  - **Embedding**：通义千问 Embedding / OpenAI text-embedding-3-small
  - **Speech**：腾讯云 ASR（语音识别）+ TTS（语音合成），参考 agent-course/asr-and-tts-nest-service
- 预留 Ollama、Anthropic 等 Provider 配置。
- Karpathy 模块的 Embedding 复用同一个 `EmbeddingProvider`，不单独实现。

### 前端

- 推荐使用 React + Vite 构建轻量 MVP。
- 页面包含：
  - 文件上传
  - 知识库列表
  - 聊天窗口（含流式回答）
  - 语音录入（浏览器 Web Speech API → 输入框 → 查询；后端已提供腾讯云 ASR/TTS 接口）
  - 引用来源展示（可展开查看 chunk 原文）
  - **模式切换器**：用户可手动选择 `simple / agentic / auto`
  - **路由追踪面板**：每次回答结束后展示"实际使用模式 + 检索轮数 + 工具调用链"
  - **Debug 面板**（可折叠）：展示各 chunk 的 BM25 / cosine 原始分数 + 完整 Prompt

---

## Public Interfaces

### 文档接口

- `POST /api/v1/documents/upload`
  - 上传文件并触发索引（向量 + BM25 双索引）。
- `GET /api/v1/documents`
  - 查看已索引文档和处理状态。

### 聊天接口

- `POST /api/v1/chat`
  - 非流式调试接口。
- `GET /api/v1/chat/stream?query=...&mode=agentic|auto|simple`
  - 使用 SSE 流式输出 token、检索事件、reflection 事件和引用来源。

Chat 请求字段：

- `query`
- `mode`: `auto | agentic | simple`
- `history`：仅 `POST /api/v1/chat` 支持，可选
- `provider`：规划字段，当前未启用
- `conversation_id`：规划字段，当前未启用
- `top_k`：规划字段，当前未启用

Chat 流式响应事件：

- `routing`：本次实际选用的模式和工具列表
- `query_augment`：deepAgent 或结构化输出生成的检索问句
- `token`：LLM 生成的 token 片段
- `web_search`：检索不足时的 Bocha 联网兜底调用结果
- `retrieval`：检索结果，含各 chunk 的 BM25 / cosine 分数
- `sufficiency`：生成前检索充分性评估，含 sufficient 和 reason
- `citation`：引用来源
- `reflection`：答案置信度、是否通过、重试次数
- `final`：完整答案
- `error`

### 语音接口

- `POST /api/v1/speech/asr`
  - 上传音频文件字段 `audio`，调用腾讯云 ASR 返回识别文本。
- `GET /api/v1/speech/tts?text=...`
  - 调用腾讯云 TTS 返回音频。
- `GET /api/v1/speech/tts/stream?text=...`
  - 使用 SSE 返回 TTS 音频分片。

### Debug 接口

- `GET /api/v1/debug/chunks?query=&mode=&top_k=`
  - 返回 candidate chunks 的 BM25 分、cosine 分、加权总分和文本内容，用于两种方案对比调试。

---

## 架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                              Frontend                                │
│  React + Vite  ─────────────────────────────────────────────────   │
│                                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ 文件上传  │ │ 知识库列表│ │ 聊天窗口 │ │ 语音录入  │ │ 模式切换 │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
│                                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                            │
│  │ 引用来源 │ │路由追踪  │ │ Debug面板 │ │                            │
│  └──────────┘ └──────────┘ └──────────┘                            │
└─────────────────────────────────────────────────────────────────────┘
                              │ SSE / REST
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           Backend (NestJS)                           │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                     API Layer                                 │   │
│  │  POST /upload  GET /documents  POST /chat  POST /chat/stream │   │
│  │  POST /speech/transcribe  GET /debug/chunks                  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                   Mode Router                                 │   │
│  │  auto → DeepAgents.js / LangGraph.js 决策                     │   │
│  │  agentic → Agentic RAG 管线                                  │   │
│  │  simple  → Karpathy-style 快速管线                           │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                        │              │                              │
│          ┌─────────────┘              └─────────────┐              │
│          ▼                                          ▼              │
│  ┌──────────────────┐                  ┌──────────────────────┐     │
│  │  Agentic RAG     │                  │  Karpathy-style RAG  │     │
│  │  (LangGraph.js)  │                  │  (Minimal Pipeline)  │     │
│  │                  │                  │                      │     │
│  │ ┌──────────────┐ │                  │ ┌──────────────────┐ │     │
│  │ │ Query Rewrite│ │                │  │ │ rank_bm25+jieba  │ │     │
│  │ └──────────────┘ │                  │ └──────────────────┘ │     │
│  │ ┌──────────────┐ │          ┌───────┤ 纯 JS cosine        │ │     │
│  │ │ DeepAgents.js│ │          │       │ score fusion         │ │     │
│  │ │ 规划 + 工具  │ │          │       │ top_k filter         │ │     │
│  │ └──────────────┘ │          │       └──────────────────────┘ │     │
│  │ ┌──────────────┐ │          ▼                              ▼     │
│  │ │ Multi-hop    │ │    ┌───────────────────────────┐           │     │
│  │ │ 检索 (≤3轮)  │ │    │   Score Fusion / Retrieval  │           │     │
│  │ └──────────────┘ │    │   Layer (统一输出层)       │           │     │
│  │ ┌──────────────┐ │    └───────────────────────────┘           │     │
│  │ │ Reflection / │ │                  │                          │     │
│  │ │ Self-Critique│ │                  ▼                          │     │
│  │ └──────────────┘ │    ┌───────────────────────────┐           │     │
│  │ ┌──────────────┐ │    │   Answer Generation        │           │     │
│  │ │ Answer Gen   │ │    │   (LLM Provider)           │           │     │
│  │ └──────────────┘ │    └───────────────────────────┘           │     │
│  └──────────────────┘                                             │     │
│                                                                    │     │
│  ┌────────────────────────────────────────────────────────────┐   │     │
│  │                  Tools (Agentic 管线)                       │   │     │
│  │  vector_search  keyword_search  es_search                  │   │     │
│  │  web_search(Bocha)  query_decompose                        │   │     │
│  │  document_summarizer  code_interpreter(QuickJS)            │   │     │
│  └────────────────────────────────────────────────────────────┘   │     │
└─────────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌──────────────────┐
│  Milvus         │ │  Elasticsearch  │ │  PostgreSQL      │
│  (向量库)       │ │  (全文检索)     │ │  (关系型数据)    │
│  ┌───────────┐  │ │  ┌───────────┐  │ │  ┌───────────┐   │
│  │ chunks    │  │ │  │ chunks    │  │ │  │ users     │   │
│  │ embeddings│  │ │  │ (IK分词)  │  │ │  │ documents │   │
│  │ metadata  │  │ │  │ metadata  │  │ │  │ conversa. │   │
│  └───────────┘  │ │  └───────────┘  │ │  │ jobs      │   │
└─────────────────┘ └─────────────────┘ │  └───────────┘   │
          │                             └──────────────────┘
          │ 可替换为 pgvector                   │ 可替换为 MySQL
          ▼                                     ▼
┌─────────────────┐ ┌──────────────────┐
│  pgvector       │ │  MySQL           │
│  (向量库备选)   │ │  (关系型备选)    │
│  复用 PostgreSQL│ │  TypeORM 兼容    │
└─────────────────┘ └──────────────────┘
          ┌───────────────────┐
          ▼                   ▼
┌─────────────────┐ ┌──────────────────┐
│  Redis          │ │  External APIs   │
│  (对话历史+缓存)│ │  ─────────────   │
│  ┌───────────┐  │ │  通义千问 LLM    │
│  │ sessions  │  │ │  Embedding       │
│  │ cache     │  │ │  Bocha Search    │
│  └───────────┘  │ │  腾讯云 ASR/TTS  │
└─────────────────┘ │  DashScope Rerank│
                    └──────────────────┘
```

## 依赖清单（核心库）

| 库 | 版本要求 | 用途 |
|---|---|---|
| `@nestjs/core` | latest | 后端框架 |
| `@nestjs/common` | latest | 后端框架 |
| `@nestjs/platform-express` | latest | NestJS HTTP 平台 |
| `@nestjs/typeorm` | latest | TypeORM 集成（关系型数据） |
| `@nestjs/throttler` | latest | API 限流 |
| `@nestjs/schedule` | latest | 定时任务 |
| `langchain` | latest | RAG 组件（LangChain.js） |
| `@langchain/core` | latest | LangChain 核心 |
| `@langchain/community` | latest | pgvector / Bocha 等集成 |
| `@langchain/milvus` | latest | Milvus 向量库（向量库 Provider 之一） |
| `@langchain/langgraph` | latest | Agentic 工作流（LangGraph.js） |
| `@langchain/mcp-adapters` | latest | MCP 协议适配器（外部工具接入） |
| `@langchain/community/graphs/neo4j_graph` | latest | Neo4j 知识图谱集成（GraphRAG） |
| `neo4j-driver` | latest | Neo4j 驱动（知识图谱 RAG） |
| `deepagents` | latest | Agent 规划与工具调用（DeepAgents.js） |
| `rank_bm25` | >=0.2 | Karpathy-style BM25 检索 |
| `@node-rs/jieba` | latest | 中文分词（BM25 + ES） |
| `@elastic/elasticsearch` | latest | ES 客户端（全文检索） |
| `typeorm` | latest | ORM（PostgreSQL / MySQL 通用） |
| `pg` | latest | PostgreSQL 驱动（关系型 + pgvector 向量库） |
| `pgvector` | latest | PostgreSQL 向量扩展支持（向量库备选） |
| `mysql2` | latest | MySQL 驱动（关系型备选） |
| `ioredis` | latest | Redis 客户端（对话历史 + 缓存） |
| `mem0ai` | latest | Mem0 长期记忆 |
| `quickjs-emscripten` | latest | QuickJS REPL（代码执行沙箱） |
| `@ai-sdk/react` | latest | 前端 AI SDK（useChat） |
| `@ai-sdk/langchain` | latest | LangChain 流转 AI SDK 协议 |
| `openai` | latest | OpenAI-compatible LLM/Embedding |
| `pino` | latest | 结构化日志 |
| `prom-client` | latest | Prometheus 指标 |
| `zod` | latest | 结构化输出校验 |

---

## Test Plan

### 单元测试

- 验证文档解析、chunking 和 metadata 保留（包含 char_start/char_end）。
- 验证 Karpathy 模块：rank_bm25 评分、cosine 计算、加权融合和 Top-K 筛选结果正确。
- 验证 Provider 抽象在 mock LLM 和 embedding 下可以运行。
- 验证 Bocha 工具调用在 mock 模式下正确传参和解析结果。

### 集成测试

- 上传文件后可以在 Milvus、ES 索引和 BM25 内存索引中同时查到对应 chunks。
- `simple`、`agentic` 和 `auto` 三种模式都能返回答案及引用。
- 流式接口按顺序输出 `routing → token → retrieval → final` 事件。
- Bocha web_search 触发后，`tool_call` 事件正确出现在流中。
- Debug 接口 `/api/v1/debug/chunks` 返回包含 BM25 / cosine 双分数的结果。

### 前端验证

- 文件上传和处理状态正确。
- 语音录入可以生成文本并发送查询。
- 流式回答不阻塞 UI。
- 引用来源可以展开查看 chunk 原文。
- 模式切换后，路由追踪面板显示正确模式和工具链。
- Debug 面板可折叠，展开后显示各 chunk 分数。

### 异常与回归场景

- 空知识库查询（BM25 索引为空时降级处理）。
- 无相关文档查询。
- 大文件上传失败。
- Provider key 缺失。
- 模型或语音服务不可用。
- Bocha API key 缺失时，web_search 工具被自动禁用，不影响其他工具。

---

## Assumptions

- 当前仓库为空，项目按全新系统搭建。
- 第一版知识库以用户上传文件为主。
- 向量库可插拔：默认 Milvus，可通过 `VECTOR_STORE_PROVIDER=milvus|pgvector` 切换；pgvector 复用 PostgreSQL，适合轻量部署。
- 关系型数据库可插拔：默认 PostgreSQL，可通过 `RELATIONAL_DB_PROVIDER=postgres|mysql` 切换；TypeORM 统一 ORM 层。
- 全文检索使用 Elasticsearch（IK 中文分词），与向量库形成混合检索。
- Karpathy-style 模块使用 `rank_bm25` + `@node-rs/jieba` + 纯 JS cosine，不自己实现 BM25 或向量算法，embedding 复用统一 Provider。
- Router 不引入额外框架，由 DeepAgents.js 原生决策；`mode` 字段允许用户强制覆盖。
- Bocha Web Search 为可选工具，API key 缺失时自动跳过，不作为必选依赖。
- 模型层要求可插拔，第一版实现通义千问 + OpenAI 兼容 Provider + 腾讯云 ASR/TTS，再通过配置扩展其他 Provider。
- BM25 索引在内存中维护，服务启动时从 Milvus 加载所有 chunk 文本重建；后续可按需持久化。
- 技术栈对齐 `agent-course` 实战经验（见 SUMMARY.md，共 26 个实战项目），全部使用 Node.js / TypeScript 生态。
- NestJS 工程化模式对齐 `agent-course/nest-feature`：JWT 认证、AuthGuard、TransformInterceptor（统一响应）、AllExceptionsFilter、自定义 Pipe。
- 容器化部署对齐 `agent-course/nest-dockerfile-test`：多阶段 Dockerfile + docker-compose 多环境（dev/prod）。
- 知识图谱 RAG（Neo4j）为可选能力，通过 `GRAPH_RAG_ENABLED=true` 启用，默认关闭。
- MCP 协议集成通过配置文件管理外部 MCP Server，启动时自动加载。

---

## 改进建议（待实施）

> 以下为评审后建议补充的内容，按优先级分类。实施时按需取舍。

### 一、架构层面（高优先级）

#### 1. BM25 内存索引的扩展性问题

当前方案"服务启动时从 Milvus 加载所有 chunk 文本重建"在文档量大时存在风险：
- **启动慢**：10 万 chunk 全量重建可能耗时几十秒
- **内存占用**：每个 worker 都要加载一份副本
- **多 worker 不一致**：写入时无法实时同步到其他 worker 的内存索引

**改进方案**（按阶段推进）：
- **短期**：将 BM25 索引持久化到磁盘（JSON 序列化），启动时加载 + 增量更新，避免全量重建
- **中期**：改用 Elasticsearch 全文检索（`IK` 分词 + `BM25` 评分）替代内存 BM25，天然支持多 worker 一致
- **长期**：若数据量持续增长，迁移到 Elasticsearch（参考 `agent-course/es-test`）

#### 2. Reflection 节点的循环控制

"低于阈值 0.7 则触发重新检索"需要明确**最大重试次数**，否则可能死循环或延迟过高。

**改进方案**：
- 阈值和最大重试次数都做成可配置（环境变量 `REFLECTION_THRESHOLD`、`REFLECTION_MAX_RETRY`）
- 默认最大重试 1-2 次，避免单次查询延迟过高
- 重试时记录原因，供 Debug 面板展示

#### 3. 对话历史/记忆缺失

请求里有 `conversation_id` 字段，但计划未说明如何存储和利用多轮对话历史。

**改进方案**：
- **存储**：PostgreSQL 新增 `conversations` 表（conversation_id、user_id、messages JSON、created_at、updated_at）
- **注入策略**：取最近 N 轮（默认 6 条）原始消息 + 更早消息的摘要注入上下文
- **指代消解**：Query Rewrite 节点参考历史做指代消解（如"他后来怎么样了"→"段誉后来怎么样了"）
- **可选**：接入 Mem0 做长期记忆（参考 `agent-course/mem0-test`）

#### 4. 认证与多租户隔离

计划提到"按 doc_id 过滤避免跨知识库干扰"，但缺少用户体系。

**改进方案**：
- 第一版：JWT 认证，`Authorization: Bearer <token>`
- 知识库表新增 `user_id` 或 `tenant_id` 字段
- 上传/查询/删除接口均需鉴权，按 `user_id` 过滤
- 预留 OAuth2（GitHub/Google）扩展点

### 二、数据层（中优先级）

#### 5. Chunking 策略明确化

补充切分策略说明：

| 文件格式 | 切分策略 | 参数 |
|----------|----------|------|
| PDF | 按页切分，页内递归字符切分 | chunk_size=1000, overlap=200 |
| Markdown | 按 heading 切分，超长段落再递归切分 | 保留 heading 层级 metadata |
| TXT | 递归字符切分（RecursiveCharacterTextSplitter） | chunk_size=1000, overlap=200 |
| DOCX | 按段落切分 | chunk_size=1000, overlap=200 |

- 参数可通过环境变量配置：`CHUNK_SIZE`、`CHUNK_OVERLAP`
- metadata 中保留 `heading_path`（Markdown）或 `page`（PDF）便于引用定位

#### 6. 向量索引创建

Milvus 自动管理向量索引，无需手动建索引。Collection 创建时指定索引参数：

```typescript
// Milvus collection 创建（TypeScript）
await milvusClient.createCollection({
  collection_name: 'chunks',
  fields: [
    { name: 'chunk_id', dataType: 'VARCHAR', is_primary: true, max_length: 64 },
    { name: 'doc_id', dataType: 'VARCHAR', max_length: 64 },
    { name: 'embedding', dataType: 'FLOAT_VECTOR', dim: 1536 },
    { name: 'metadata', dataType: 'JSON' },
  ],
});

// 创建 HNSW 索引（推荐）
await milvusClient.createIndex({
  collection_name: 'chunks',
  field_name: 'embedding',
  index_type: 'HNSW',
  metric_type: 'COSINE',
  params: { M: 16, efConstruction: 64 },
});
```

- 查询时调整 `ef` 参数控制召回精度
- ES 索引通过 mapping 定义（含 IK 分词器）

#### 7. Embedding 模型迁移策略

metadata 里已存 `embedding_model` 字段（好设计），但需要明确换模型时的处理：

- **方案 A（推荐）**：全量重算。Milvus 新建 collection（不同维度），双写过渡后切换
- **方案 B**：双索引过渡。新模型 collection 构建完成后，原子切换，删除旧 collection
- **方案 C**：版本化。metadata 增加 `embedding_version`，查询时按版本过滤

#### 8. 文档删除接口

补充删除接口：

- `DELETE /api/v1/documents/{doc_id}`
  - 删除 Milvus 中该文档的所有 chunks（按 doc_id 过滤删除）
  - 同步删除 ES 索引中对应文档
  - 更新内存 BM25 索引（重建或增量删除）
  - 返回删除的 chunk 数量
  - 支持级联删除关联的 conversations 引用（可选）

### 三、功能补充（中优先级）

#### 9. 缓存层

引入 Redis 缓存：

| 缓存对象 | Key | TTL | 用途 |
|----------|-----|-----|------|
| Embedding 缓存 | `emb:{hash(text)}` | 7 天 | 避免重复 embedding 调用 |
| 查询结果缓存 | `query:{hash(query+mode+filters)}` | 1 小时 | 相同查询短期复用 |
| 对话历史 | `conv:{conversation_id}` | 30 分钟 | 减少 DB 查询 |

#### 10. 限流与配额

- **API 限流**：用 `@nestjs/throttler`，默认 60 req/min/user
- **Token 配额**：按用户统计 LLM token 消耗，超限拒绝
- **文件大小限制**：单文件默认 50MB，可在配置中调整
- **并发上传限制**：单用户最多 3 个并发上传任务

#### 11. 日志与可观测性

- **应用日志**：用 `pino`（pino-pretty 开发环境）输出结构化 JSON 日志
- **关键指标**（Prometheus 格式）：
  - `rag_http_requests_total{method,route,status}`：HTTP 请求次数
  - `rag_http_request_duration_seconds{method,route,status}`：HTTP 请求耗时
  - `rag_retrieval_hits_total{source,mode}`：检索命中数
  - `rag_llm_calls_total{provider,status}`：LLM 调用次数
  - `rag_llm_call_duration_seconds{provider,status}`：LLM 调用耗时
  - `rag_llm_tokens_estimated_total{provider,direction}`：输入/输出 token 估算
- **分布式追踪**：当前为 W3C `traceparent` 兼容的 in-memory tracing；OTLP exporter 属后续增强

### 四、实施细节（低优先级）

#### 12. 技术栈确认

技术栈已确认：**NestJS / Node.js / TypeScript**（对齐 `agent-course` 全部实战代码）。

- 后端：NestJS + LangChain.js + LangGraph.js + DeepAgents.js
- 前端：React + Vite + AI SDK
- 向量库：Milvus（对齐 SUMMARY.md）
- 全文检索：Elasticsearch（IK 中文分词）
- 关系型数据：PostgreSQL + TypeORM
- 记忆：Mem0 + Redis
- LLM：通义千问 + OpenAI 兼容
- 语音：腾讯云 ASR/TTS
- 搜索：Bocha
- Rerank：DashScope
- REPL：QuickJS（quickjs-emscripten）

#### 13. 流式协议明确

明确选 **SSE**（Server-Sent Events）而非 WebSocket：
- 单向流（服务器→客户端）足够
- 实现更简单，浏览器原生支持自动重连
- 兼容性更好，无需额外库
- 响应头：`Content-Type: text/event-stream`

#### 14. API 版本化

所有 API 路径加版本前缀：`/api/v1/`，方便后续迭代：
- `/api/v1/documents/upload`
- `/api/v1/chat/stream`
- `/api/v1/speech/transcribe`
- `/api/v1/debug/chunks`

#### 15. 数据库迁移工具

使用 **TypeORM migrations**（NestJS 生态标准）管理 PostgreSQL schema 变更：
- 每次表结构变更生成迁移文件（`typeorm migration:generate`）
- 支持回滚
- 版本化记录在 migrations 表
- Milvus collection 和 ES index 通过初始化脚本管理

### 五、测试计划补充

#### 16. 性能指标

补充性能目标：

| 指标 | simple 模式 | agentic 模式 |
|------|-------------|--------------|
| 检索延迟 P50 | < 300ms | < 800ms |
| 检索延迟 P99 | < 800ms | < 2000ms |
| 端到端首 token | < 1s | < 2s |
| 并发吞吐 | 100 QPS | 20 QPS |
| 单次查询 token | < 2000 | < 8000 |

#### 17. 端到端测试场景

补充完整用户旅程 E2E 测试：
1. 用户注册/登录
2. 上传 PDF 文档
3. 轮询处理状态直到完成
4. 用 `simple` 模式提问，验证引用来源
5. 切换 `agentic` 模式重问，验证工具调用链
6. 查看 Debug 面板的 BM25/cosine 分数
7. 语音输入提问
8. 删除文档，验证检索不再命中

---

## 实施优先级建议

按影响范围和实施难度排序，建议按以下顺序处理：

| 优先级 | 改进项 | 原因 |
|--------|--------|------|
| P0 | 技术栈确认：NestJS / Node.js（已确认） | 影响整个实现方向 |
| P0 | BM25 索引方案 | 影响扩展性，架构基础 |
| P0 | 对话历史方案 | 影响多轮对话体验 |
| P1 | Chunking 策略 | 影响检索质量 |
| P1 | Reflection 循环控制 | 影响稳定性 |
| P1 | 向量索引创建 | 影响检索性能 |
| P2 | 认证与多租户 | 影响安全性 |
| P2 | 缓存层 | 影响成本和性能 |
| P2 | 文档删除接口 | 功能完整性 |
| P3 | 限流与配额 | 生产环境必备 |
| P3 | 日志与可观测性 | 运维必备 |
| P3 | API 版本化、迁移工具 | 长期维护性 |

---

## 基于 agent-course 经验的能力补充

> 以下能力来源于 `agent-course` 26 个实战项目的经验沉淀，用于将本系统从 MVP 升级为**企业级 RAG 平台**。按功能模块组织，补充到上述计划中。

### 一、语音能力补全：双向语音（STT + TTS）

**现状**：已实现 `POST /api/v1/speech/asr`、`GET /api/v1/speech/tts` 和 `GET /api/v1/speech/tts/stream`，腾讯云 TTS→ASR 直连 smoke 已验证。

**补充**：参考 `agent-course/asr-and-tts-nest-service`，增加 TTS 语音合成输出，实现完整语音对话闭环。

| 接口 | 功能 | 实现 |
|------|------|------|
| `POST /api/v1/speech/asr` | STT 语音识别 | 已实现 |
| `GET /api/v1/speech/tts` | TTS 语音合成 | 已实现 |
| `GET /api/v1/speech/tts/stream` | TTS 流式分片 | 已实现 |

**TTS 设计**：
- Provider 抽象：`SpeechProvider` 接口同时覆盖 STT 和 TTS
- 第一版支持：腾讯云 TTS、OpenAI TTS（`tts-1`）
- 流式 TTS：支持 SSE 流式返回音频块，前端边收边播
- 语音选择：请求参数 `voice`（如 `alloy`、`zh-Yunxi`），支持多音色
- 前端：聊天窗口增加"朗读"按钮，点击对 AI 回复调用 TTS

**语音对话模式**：
- 前端"按住说话"按钮 → 录音 → STT → RAG 查询 → AI 文本回复 → TTS → 播放
- 参考 `asr-ai-stream.html` 的联动设计

### 二、定时任务 Agent（企业级场景必备）

**现状**：计划无定时任务能力。

**补充**：参考 `agent-course/cron-job-tool`，引入定时任务 Agent，支持自然语言创建定时任务。

**企业级场景**：
- 定时同步外部知识库（每天凌晨拉取最新文档）
- 定时生成知识库摘要报告（每周一早 9 点）
- 定时清理过期对话历史（每天清理 30 天前的会话）
- 定时重新生成 embedding（模型升级后批量重算）
- 知识库健康度巡检（定时检测检索质量）

**接口设计**：
- `POST /api/v1/jobs`：创建定时任务（Agent 解析自然语言 → cron 表达式）
- `GET /api/v1/jobs`：列出所有任务
- `PATCH /api/v1/jobs/{id}/toggle`：启用/禁用任务
- `DELETE /api/v1/jobs/{id}`：删除任务

**任务类型**（参考 cron-job-tool）：
| 类型 | 字段 | 示例 |
|------|------|------|
| `cron` | cron 表达式 | `0 9 * * 1`（每周一 9 点） |
| `every` | 间隔 | `3600s`、`24h` |
| `at` | 一次性时间 | `2026-12-31T23:59:59Z` |

**实现**：
- 后端用 `@nestjs/schedule`（装饰器风格）或 `node-cron`
- 任务实体：`jobs` 表（id、user_id、type、schedule、instruction、enabled、last_run、next_run，TypeORM Entity）
- 任务执行器：到点后启动一个 Agent，按 `instruction` 调用工具完成任务
- 工具复用：web_search（Bocha）、document_summarizer、vector_search 等

### 三、子 Agent 编排架构（多 Agent 协作）

**现状**：计划用单一 DeepAgents.js 处理所有任务。

**补充**：参考 `agent-course/deep-research-assistant`，对复杂查询引入子 Agent 分工协作。

**子 Agent 设计**：

| 子 Agent | 职责 | 工具 |
|----------|------|------|
| `researcher` | 多源检索（向量+关键词+联网），收集原始素材 | vector_search、keyword_search、web_search |
| `analyst` | 数据分析与计算，处理数值型问题 | QuickJS REPL、document_summarizer |
| `writer` | 答案起草，组织语言和引用 | 无工具，专注生成 |
| `critic` | 答案审阅，打分并给修改建议 | 无工具，专注评估 |
| `editor` | 根据审阅建议修订答案 | 无工具，专注修订 |

**编排流程**（LangGraph.js）：
```
researcher → analyst（可选）→ writer → critic → editor
                ↑                          │
                └──────── 修订循环 ─────────┘
```

**触发条件**：
- `simple` 模式：不走子 Agent，直接 Karpathy 管线
- `agentic` 模式：DeepAgents.js 自动决定是否启用子 Agent
- 复杂查询（多跳、比较、分析类）强制走子 Agent 流程

### 四、Skills 技能系统

**现状**：计划无技能系统。

**补充**：参考 `agent-course/deepagents-test/skills-agent.mjs` 和 `deep-research-assistant/skills/`，引入可插拔的技能系统。

**技能定义**：每个技能是一个 Markdown 文件（`SKILL.md`），包含：
- `name`：技能名
- `description`：触发条件描述
- `instructions`：详细执行步骤
- 可选 `tools`：该技能可用的工具列表

**内置技能**：

| 技能 | 用途 | 触发场景 |
|------|------|----------|
| `web-research` | 联网调研流程 | 需要最新信息时 |
| `report-writer` | 报告生成模板 | 用户要求生成报告 |
| `knowledge-base-qa` | 知识库问答流程 | 默认 RAG 查询 |
| `data-analysis` | 数据分析流程 | 含数值计算的问题 |
| `multi-doc-compare` | 多文档对比 | 用户要求比较多个文档 |

**技能加载**：
- 技能文件存放在 `skills/` 目录
- 服务启动时扫描加载，支持热更新
- DeepAgents.js 根据用户查询自动匹配技能（通过 `description` 语义匹配）

### 五、文件系统中间件 + 权限控制

**现状**：计划无文件系统抽象。

**补充**：参考 `agent-course/deepagents-test/filesystem-agent.mjs`，为 Agent 提供安全的文件操作能力。

**用途**：
- Agent 生成的报告、分析结果可落盘为文件供用户下载
- 定时任务的输出产物管理
- 长期记忆的文件存储（AGENTS.md 风格）

**权限模型**（deny/allow 规则）：
```yaml
filesystem:
  base_dir: ./workspace
  rules:
    - type: allow
      path: "./workspace/reports/**"
      operations: [read, write]
    - type: allow
      path: "./workspace/exports/**"
      operations: [write]
    - type: deny
      path: "./**/.env*"
      operations: [read, write]
    - type: deny
      path: "/etc/**"
      operations: [read, write]
```

**接口**：
- `GET /api/v1/files`：列出用户工作区文件
- `GET /api/v1/files/{path}`：下载文件
- `DELETE /api/v1/files/{path}`：删除文件

### 六、查询扩展（Query Augmentation）

**现状**：计划有 Query Rewrite，但未涉及多角度查询扩展。

**补充**：参考 `agent-course/es-test/src/rag/query-augment.mjs`，在检索前用 LLM 生成多角度查询。

**设计**：
- Query Rewrite 节点扩展为：`query_rewrite → query_augment`
- `query_rewrite`：指代消解、查询改写（已有）
- `query_augment`：用 LLM 生成 3 条多角度检索问句，并行检索后合并去重

**示例**：
```
原始查询："段誉的武功"
↓ query_augment
扩展查询：
  1. "段誉学会了哪些武功"
  2. "段誉六脉神剑凌波微步"
  3. "段誉内力修为"
```

**融合策略**：
- 每条扩展查询独立检索 Top-K
- 按 chunk_id 去重，分数取最大值
- 再统一 Rerank 取最终 Top-N

### 七、中文分词优化

**现状**：BM25 用 `rank_bm25` 默认分词，对中文效果差。

**补充**：参考 `agent-course/es-test` 的 IK 分词经验，为 BM25 引入中文分词。

**方案**：
- Node.js：用 `@node-rs/jieba` 对中文文本分词后再喂给 `rank_bm25`
- 分词结果缓存，避免重复计算

**代码示例**（TypeScript）：
```typescript
import { jieba } from '@node-rs/jieba';
import { BM25Okapi } from 'rank_bm25';

const tokenizeZh = (text: string): string[] => jieba.cut(text, false);

const bm25 = new BM25Okapi(corpus.map(tokenizeZh));
const scores = bm25.getScores(tokenizeZh(query));
```

### 八、LangGraph.js 状态持久化（Checkpointer）

**现状**：计划未提及 LangGraph.js 状态持久化。

**补充**：参考 `agent-course/langgraph-test/checkpointer-*.mjs`，为 Agentic RAG 工作流增加状态持久化。

**用途**：
- 长时间运行的 Agent 任务可中断恢复
- 多轮对话的状态保持
- 故障恢复（服务重启后从中断点继续）

**方案**：
| Checkpointer | 适用场景 | 持久性 |
|---------------|----------|--------|
| `MemorySaver` | 开发调试 | 进程内，重启丢失 |
| `SqliteSaver` | 单机部署 | SQLite 文件 |
| `PostgresSaver` | 生产部署 | PostgreSQL（推荐，复用现有 DB） |

**配置**：
- 环境变量 `LANGGRAPH_CHECKPOINTER=postgres`
- 按 `thread_id`（即 `conversation_id`）隔离状态
- 支持时间旅行（回到历史某个 checkpoint 重新执行）
- LangGraph.js 对应：`@langchain/langgraph-checkpoint-postgres`

### 九、图中断与人工审批（interrupt）

**现状**：计划无人工审批机制。

**补充**：参考 `agent-course/langgraph-test/graph-interrupt.mjs`，为关键操作引入人工审批。

**企业级场景**：
- Agent 要执行高成本操作（如批量删除文档、调用付费 API）前暂停，等待用户确认
- 定时任务执行前需管理员审批
- 答案生成后，关键场景需人工 review 后才返回用户

**实现**（LangGraph.js）：
```typescript
import { interrupt, Command } from '@langchain/langgraph';

function riskyActionNode(state) {
  if (state.needsApproval) {
    const userInput = interrupt({
      action: 'delete_documents',
      doc_ids: state.targetDocs,
      message: '即将删除 5 个文档，请确认',
    });
    if (userInput === 'approved') {
      return executeDelete(state);
    } else {
      return { status: 'cancelled' };
    }
  }
}
```

**接口**：
- `POST /api/v1/chat/stream` 返回 `interrupt` 事件，前端展示审批弹窗
- `POST /api/v1/chat/resume` 提交审批结果，恢复执行

### 十、Supervisor 多 Agent 架构

**现状**：计划用单一 DeepAgents.js。

**补充**：参考 `agent-course/langgraph-test/multi-agent-supervisor.mjs`，对复杂场景引入 Supervisor 多 Agent 架构。

**适用场景**：
- 企业级知识库涉及多个领域（HR、财务、技术、法务）
- 单一 Agent 工具过多导致决策混乱
- 不同领域需要不同的 System Prompt 和工具集

**架构**：
```
用户查询 → Supervisor（路由决策）
            ├→ hr_agent        (HR 知识库 + HR 工具)
            ├→ finance_agent   (财务知识库 + 计算工具)
            ├→ tech_agent      (技术文档 + 代码工具)
            └→ legal_agent     (法务文档 + 合规检查工具)
```

**Supervisor 职责**：
- 分析查询，决定路由到哪个领域 Agent
- 支持多 Agent 协作（一个查询可先后调用多个领域 Agent）
- 汇总各 Agent 结果

**配置化**：
```yaml
agents:
  - name: hr_agent
    description: "处理人事、考勤、薪酬相关问题"
    tools: [vector_search, keyword_search]
    knowledge_base: hr_docs
    system_prompt: "你是 HR 助手..."
  - name: finance_agent
    description: "处理财务、报销、预算问题"
    tools: [vector_search, web_search, calculator]
    knowledge_base: finance_docs
```

### 十一、RAG 评测体系（企业级必备）

**现状**：计划测试部分仅有功能测试和性能测试，无 RAG 质量评测。

**补充**：参考 `agent-course/langsmith-test`，建立完整的 RAG 评测体系。

**三大评测指标**（LLM-as-Judge）：

| 指标 | 评估什么 | 阈值 |
|------|----------|------|
| `rag_groundedness`（忠实度） | 答案是否被检索上下文支撑，防幻觉 | ≥ 0.8 |
| `rag_helpfulness`（有用性） | 答案是否切题、完整回答了用户问题 | ≥ 0.7 |
| `rag_retrieval_relevance`（检索相关性） | 召回的 chunk 是否与问题相关 | ≥ 0.7 |

**评测流程**：
1. **构建 Dataset**：以合成数据为主，从已上传知识库 chunk 生成 50-100 条样本（问题 + 标准答案 + 相关 chunk id），再抽样人工复核 10-20 条高风险样本。
2. **跑评测**：用 Dataset 跑 simple / agentic / auto 三种模式，收集（问题、答案、引用上下文、检索分数、SSE 事件链）。
3. **LLM-as-Judge**：默认使用 OpenAI-compatible Judge 模型（优先更强模型；无外部 key 时使用 Qwen 配置）对三个指标打分。
4. **生成报告**：LangSmith 实验报告 + 本地 JSON 汇总，对比不同切分策略、检索权重、Prompt、Rerank 配置的得分。

**集成到 CI/CD**：
- 第一阶段不直接改 CI：提供 `npm run eval:rag` 本地命令和报告产物，手动触发。
- 第二阶段接入 CI：仅当 RAG 管线改动（切分策略、检索参数、Prompt、Rerank、Agentic 图节点）时自动跑 smoke dataset。
- 门禁规则：`rag_groundedness >= 0.8`、`rag_helpfulness >= 0.7`、`rag_retrieval_relevance >= 0.7`；任一指标较基线下降超过 5% 阻断合并。
- 定期回归评测：每日/每周全量 dataset，监控线上质量漂移；结果进入 LangSmith 对比实验。

**接口**：
- `POST /api/v1/eval/run`：触发评测任务
- `GET /api/v1/eval/results/{run_id}`：查询评测结果
- `GET /api/v1/eval/dataset`：管理评测数据集

**方案定稿（2026-06-19）**：
- Dataset 来源：合成数据为主，人工抽样复核，不依赖早期大量人工标注。
- 评测模型：OpenAI-compatible Judge 模型，可通过环境变量切换；默认沿用项目 Qwen/OpenAI 兼容 Provider。
- CI/CD 集成：先本地命令，后 smoke dataset 门禁；正式 CI 配置变更需单独确认。

### 十二、长期记忆系统升级（Mem0）

**现状**：改进建议中提了"可选接入 Mem0"，应升级为**必备**。

**补充**：参考 `agent-course/mem0-test/mem0-redis-mem0-agent.mjs`，实现双层记忆。

**记忆分层**：

| 层级 | 存储 | 内容 | 生命周期 |
|------|------|------|----------|
| 短期记忆 | Redis | 当前会话的对话历史 | TTL 30 分钟，超阈值摘要压缩 |
| 长期记忆-用户层 | Mem0 | 用户偏好、历史事实 | 跨会话持久 |
| 长期记忆-会话层 | Mem0 | 当前会话的关键信息 | 会话内持久 |
| 项目记忆 | AGENTS.md | 项目级约定、输出格式偏好 | 永久 |

**记忆分类器**：
- 每轮对话后，用轻量 LLM 判断该写入哪层记忆
- 例如："用户叫张三" → 用户层；"本次任务是分析销售数据" → 会话层；"用户偏好中文回答" → 项目记忆

**记忆注入**：
- 查询时，从 Mem0 检索相关长期记忆（向量检索）
- 与 RAG 检索结果合并注入 Prompt
- Prompt 结构：`[长期记忆] + [对话历史] + [检索上下文] + [用户问题]`

### 十三、对话历史向量化

**现状**：计划对话历史仅作为上下文注入。

**补充**：参考 `agent-course/memory-test/memory/insert-conversations.mjs`，将历史对话向量化存入 Milvus，支持 RAG 检索历史对话。

**用途**：
- 用户问"上次我们聊到的那个方案" → 检索历史对话
- 跨会话引用历史结论
- 知识沉淀（有价值的对话转为知识库文档）

**实现**：
- 每轮对话结束后，将（用户问题 + AI 回答）拼接向量化
- 存入 `conversation_chunks` 表（与文档 chunks 分开，检索时可选择是否包含）
- 查询时支持 `include_history=true` 参数，同时检索文档和历史对话

### 十四、检索充分性评估（二次评估机制）

**当前状态**：基础版已实现。Agentic RAG 在检索后、生成前执行 `sufficiencyNode`，并通过 SSE `sufficiency` 事件输出 `sufficient` 和 `reason`；不足后触发 Bocha `web_search` 补充外部上下文，`BOCHA_API_KEY` 缺失时自动跳过。

**后续补充**：继续优化联网结果去重、质量评估和与 DashScope Rerank 的排序融合。

**流程**：
```
检索 → 充分性评估 → [充分] → 生成答案
                   → [不足] → 联网补充检索 → 二次评估 → 生成
```

**充分性评估**：
- 用 LLM 判断检索到的上下文是否能回答用户问题
- 输出：`sufficient: bool` + `reason: string`
- 不足时，触发 `web_search`（Bocha）补充

**与 Reflection 区别**：
- 充分性评估：检索后、生成前，判断"信息够不够"
- Reflection：生成后，判断"答案好不好"
- 两者互补，形成双重质量保障

### 十五、可观测性增强：Mermaid 图导出

**现状**：计划有日志和指标，但无工作流可视化。

**补充**：参考 `agent-course/langgraph-test` 的 Mermaid 导出能力。

**功能**：
- LangGraph.js 工作流支持导出 Mermaid 图
- Debug 面板展示本次查询的实际执行路径（高亮走过的节点）
- 每次查询记录执行轨迹，便于事后分析

**接口**：
- `GET /api/v1/debug/graph`：返回工作流的 Mermaid 图定义
- 流式响应的 `routing` 事件携带本次执行路径

**前端**：
- 用 `mermaid.js` 渲染工作流图
- 高亮实际执行的节点和边
- 点击节点查看输入/输出详情

### 十六、REPL 数据分析能力

**现状**：计划无代码执行能力。

**补充**：参考 `agent-course/deep-research-assistant` 的 analyst 子 Agent，为 Agent 提供数据分析能力。

**用途**：
- 用户上传含数据的文档（CSV、Excel），Agent 可写代码分析
- 数值型问题（如"这份财报的同比增长率"）需要计算
- 生成图表（用 matplotlib/echarts）

**实现**：
- Node.js：用 `quickjs-emscripten` 沙箱执行代码（参考 `agent-course/deepagents-test`）
- 工具名：`code_interpreter`
- 安全限制：禁用文件系统、网络、无限循环

### 十六之二、知识图谱 RAG（Neo4j GraphRAG）

**现状**：计划仅有向量 + 关键词混合检索，无知识图谱能力。

**补充**：参考 `agent-course/neo4j-graphrag`，为特定领域（如企业组织架构、产品关系、法规引用）引入知识图谱 RAG。

**适用场景**：
- 关系型查询（"张三的下属是谁"、"这个产品的上游供应商"）
- 多跳推理（"哪些部门参与了该项目"）
- 实体关系密集型领域（法务、医疗、制造）

**架构**：
```
用户查询 → 路由判断
            ├→ 普通查询 → 向量/关键词检索
            └→ 关系查询 → GraphRAG 管线
                           ├→ LLM 生成 Cypher
                           ├→ Neo4j 执行图查询
                           └→ 基于图结果生成答案
```

**实现**：
- `Neo4jGraph`（`@langchain/community/graphs/neo4j_graph`）连接图库
- LangGraph.js 编排三节点：`generateCypher` → `executeGraphQuery` → `generateAnswer`
- 节点/关系定义通过 schema 配置，支持多领域图谱
- 图谱构建：从结构化数据（CSV/数据库）或非结构化文档（LLM 抽取实体关系）导入

**接口**：
- `POST /api/v1/graph/import`：导入图谱数据
- `POST /api/v1/graph/query`：图查询（自然语言 → Cypher → 结果）
- `GET /api/v1/graph/schema`：查看图谱 schema

**与向量 RAG 融合**：
- 路由器判断查询类型，关系型走 GraphRAG，语义型走向量 RAG
- 复杂查询可并行：向量检索相关文档 + 图谱检索关系，结果融合后生成

### 十六之三、MCP 协议集成

**现状**：已实现 MCP Provider 和本地 stdio smoke server。

**补充**：参考 `agent-course/tool-test`，支持 MCP（Model Context Protocol）工具接入，实现工具生态可扩展。

**用途**：
- 接入第三方 MCP Server（如数据库查询、API 调用、文件系统）
- 用户可自定义 MCP Server 扩展 Agent 能力
- 标准化工具协议，便于生态复用

**实现**：
- 使用 `@langchain/mcp-adapters` 的 `MultiServerMCPClient` 加载 MCP 工具
- 支持stdio 和 SSE 两种 transport
- MCP Server 配置化：

```yaml
mcp_servers:
  - name: db_query
    command: "node"
    args: ["./mcp-servers/db-query-server.js"]
  - name: api_gateway
    url: "http://localhost:8080/sse"
```

- Agent 启动时加载所有配置的 MCP Server，工具自动注册
- 流式响应的 `tool_call` 事件标注工具来源（`builtin` / `mcp:server_name`）

**当前验证**：
- `workspace/mcp-servers.yaml` 默认指向 `backend/scripts/mcp-smoke-server.mjs`
- `npm run smoke:mcp` 已验证 `rag_smoke_echo` / `rag_smoke_status` 工具加载与调用
- 后续接业务 MCP server 时追加 yaml 配置即可

### 十六之四、NestJS 工程化最佳实践

**现状**：计划提到 NestJS 但未细化工程模式。

**补充**：参考 `agent-course/nest-feature`，落地企业级 NestJS 工程化模式。

**核心模式**（全部对齐 nest-feature 实战）：

| 模式 | 实现 | 用途 |
|------|------|------|
| JWT 认证 | `@nestjs/jwt` + `AuthGuard` | Bearer Token 验证 |
| 角色权限 | `@CurrentUser()` 装饰器 + Guard | RBAC（admin/user） |
| 统一响应 | `TransformInterceptor` | `{code, data, message}` 格式 |
| 全局异常 | `AllExceptionsFilter` | 错误统一包装 |
| 参数校验 | 自定义 Pipe（`ParsePositiveIntPipe`） | 入参验证 |
| 请求日志 | 拦截器记录 method/url/耗时 | 可观测性 |

**目录结构**：
```
src/
  common/
    decorators/      # @CurrentUser 等
    filters/         # 全局异常过滤器
    guards/          # AuthGuard
    interceptors/    # TransformInterceptor
    pipes/           # 参数校验
    interfaces/      # ApiResponse, JwtPayload
  auth/              # 认证模块
  users/             # 用户模块
  documents/         # 文档管理
  chat/              # 聊天接口
  ...
```

### 十六之五、容器化部署（Docker Compose）

**现状**：计划无部署方案。

**补充**：参考 `agent-course/nest-dockerfile-test`，提供完整的容器化部署方案。

**Dockerfile（多阶段构建）**：
```dockerfile
# Builder 阶段
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# 运行阶段（更小镜像）
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

**docker-compose.yml（完整栈）**：
```yaml
services:
  app:
    build: .
    ports: ["3000:3000"]
    depends_on: [postgres, redis, milvus, elasticsearch]
    environment:
      - VECTOR_STORE_PROVIDER=milvus
      - RELATIONAL_DB_PROVIDER=postgres

  postgres:    # 含 pgvector 扩展
    image: pgvector/pgvector:pg16
    volumes: ["./volumes/pg:/var/lib/postgresql/data"]

  mysql:       # 关系型备选
    image: mysql:8
    volumes: ["./volumes/mysql:/var/lib/mysql"]

  redis:
    image: redis:7-alpine

  milvus:      # 含 etcd + minio
    image: milvusdb/milvus:v2.5.25

  elasticsearch:
    image: elasticsearch:8-with-ik

  neo4j:       # 知识图谱（可选）
    image: neo4j:latest
```

**环境区分**：
- `docker-compose.dev.yml`：开发环境（热重载 + 全部服务）
- `docker-compose.prod.yml`：生产环境（仅必要服务 + 资源限制）

### 十六之六、Prompt 工程体系

**现状**：计划 Prompt 为简单模板字符串。

**补充**：参考 `agent-course/prompt-template-test` 和 `runnable-test`，建立完整的 Prompt 工程体系。

**Prompt 模板层级**：
| 模板类型 | 用途 | 示例 |
|----------|------|------|
| `PromptTemplate` | 单轮 Prompt | RAG 生成 Prompt |
| `ChatPromptTemplate` | 多角色对话 | System + History + User |
| `MessagesPlaceholder` | 历史消息占位 | 对话历史注入 |
| `Few-shot` | 示例引导 | 报告生成格式 |
| `PipelinePromptTemplate` | 管道组合 | 分步生成（大纲 → 正文 → 润色） |

**LCEL 管道编排**（参考 runnable-test）：
- 用 `RunnableSequence` 串联 Prompt → Model → OutputParser
- 用 `RunnableBranch` 实现条件分支（不同查询类型走不同 Prompt）
- 用 `RunnableWithMessageHistory` 绑定对话历史
- 用 `RunnableWithFallbacks` 实现降级（主模型失败 → 备用模型）

**语义示例选择**（参考 prompt-template-test）：
- Few-shot 示例库存 Milvus，按查询语义检索最相关示例
- 避免固定示例导致的偏差，动态适配查询场景

### 十六之七、结构化输出与数据导入

**现状**：计划输出为自然语言文本。

**补充**：参考 `agent-course/output-parser-test`，为特定场景提供结构化输出能力。

**场景**：
- 文档元数据抽取（从 PDF 抽取标题/作者/日期）
- 实体关系抽取（用于 Neo4j 图谱构建）
- 数据导入（从非结构化文本抽取结构化数据写入 DB）
- 评测结果（结构化评分便于聚合分析）

**实现**：
- 优先用 `model.withStructuredOutput(ZodSchema)`（推荐，参考 output-parser-test）
- 流式场景用 `stream-with-structured-output`
- 复杂场景用 `StructuredOutputParser.fromZodSchema` + `format_instructions`

**示例**（文档元数据抽取）：
```typescript
const schema = z.object({
  title: z.string(),
  author: z.string().optional(),
  date: z.string().datetime().optional(),
  summary: z.string(),
  keywords: z.array(z.string()).max(5),
});

const extractor = model.withStructuredOutput(schema);
const result = await extractor.invoke(documentContent);
// result 可直接写入 PostgreSQL/MySQL
```

### 十七、综合能力对照表

下表汇总 `agent-course` 各章节能力在本计划中的落地情况：

| agent-course 章节 | 核心能力 | 本计划落地情况 |
|-------------------|----------|----------------|
| prompt-template-test | PromptTemplate/ChatPromptTemplate/Few-shot/PipelinePrompt | ⭐ 新增 Prompt 工程体系 |
| runnable-test | LCEL Runnable 全家族（Sequence/Map/Branch/WithMessageHistory） | ⭐ 新增 LCEL 管道编排 |
| output-parser-test | 结构化输出（Zod/withStructuredOutput）+ MySQL 智能导入 | ⭐ 新增结构化输出 + 数据导入 |
| tool-test | LangChain Tools + MCP Server/Client | ⭐ 新增 MCP 协议集成 |
| rag-test | MemoryVectorStore + TextSplitter 全家族 | ✅ 已有（TextSplitter） |
| milvus-test | Milvus CRUD + epub 电子书 RAG | ✅ 已有（Milvus） |
| pgsql-test | pgvector 基础（HNSW 索引、余弦检索） | ✅ 已有（向量库备选） |
| typeorm-pg-crud | TypeORM + pgvector 会话语义检索 | ✅ 已有（TypeORM 集成） |
| redis-test | Redis 6 大数据类型 + Agent 短期记忆 | ✅ 已有（短期记忆） |
| neo4j-graphrag | Neo4j 知识图谱 + GraphRAG | ⭐ 新增知识图谱 RAG |
| advanced-rag | 朴素/路由/多跳/联网兜底 | ✅ 已有 + ⭐新增检索充分性评估 |
| es-test | 混合检索 + Rerank + 查询扩展 | ✅ 已有 + ⭐新增查询扩展 + 中文分词 |
| hello-nest-langchain | NestJS + LangChain | 参考 |
| nest-feature | JWT/Guards/Interceptors/Pipes/Filters | ⭐ 新增 NestJS 工程化模式 |
| nest-dockerfile-test | Docker 多阶段构建 + Compose 部署 | ⭐ 新增容器化部署 |
| langgraph-test | 图编排 + Checkpointer + interrupt + Supervisor | ⭐ 新增 Checkpointer + interrupt + Supervisor |
| deepagents-test | 五大中间件 | ⭐ 新增文件系统 + 摘要 + 子Agent |
| deep-research-assistant | 子 Agent + Skills + REPL | ⭐ 新增子 Agent + Skills + REPL |
| agui-backend | Agent + AI SDK 协议 | ✅ 已有 |
| agui-frontend | React + 流式 UI | ✅ 已有 |
| memory-test | 对话历史向量化 | ⭐ 新增 |
| mem0-test | Mem0 双层记忆 + 分类器 | ⭐ 升级为必备 |
| asr-and-tts-nest-service | 语音识别合成（NestJS 服务） | ✅ STT 已有 + ⭐新增 TTS |
| tts-stt-test | 腾讯云 TTS/ASR 基础 + 流式 TTS | ✅ 已有（语音 Provider） |
| cron-job-tool | 定时任务 Agent | ⭐ 新增 |
| langsmith-test | RAG 三大评测指标 | ⭐ 新增评测体系 |

### 十八、更新后的实施优先级

整合所有补充能力后的优先级调整：

| 优先级 | 改进项 | 来源 |
|--------|--------|------|
| P0 | 技术栈确认 | 原计划 |
| P0 | BM25 索引方案 + 中文分词 | 原计划 + es-test |
| P0 | 对话历史 + Mem0 长期记忆 | 原计划 + mem0-test |
| P0 | RAG 评测体系 | langsmith-test |
| P0 | NestJS 工程化模式（JWT/Guards/Interceptors） | nest-feature |
| P1 | Chunking 策略 | 原计划 |
| P1 | 查询扩展（多角度） | es-test |
| P1 | 检索充分性评估 | advanced-rag |
| P1 | Reflection 循环控制 | 原计划 |
| P1 | 向量索引 + Checkpointer | 原计划 + langgraph-test |
| P1 | 子 Agent 编排架构 | deep-research-assistant |
| P1 | Prompt 工程体系（LCEL + 模板层级） | prompt-template-test + runnable-test |
| P1 | 结构化输出（元数据抽取/数据导入） | output-parser-test |
| P1 | 容器化部署（Docker Compose） | nest-dockerfile-test |
| P2 | TTS 语音合成 | asr-and-tts |
| P2 | 定时任务 Agent | cron-job-tool |
| P2 | Skills 技能系统 | deepagents-test |
| P2 | 认证与多租户 | 原计划 |
| P2 | 缓存层 | 原计划 |
| P2 | 文档删除接口 | 原计划 |
| P2 | 图中断人工审批 | langgraph-test |
| P2 | MCP 协议集成（外部工具接入） | tool-test |
| P3 | Supervisor 多 Agent | langgraph-test |
| P3 | 文件系统 + 权限 | deepagents-test |
| P3 | 对话历史向量化 | memory-test |
| P3 | REPL 数据分析 | deep-research-assistant |
| P3 | Mermaid 可观测 | langgraph-test |
| P3 | 知识图谱 RAG（Neo4j） | neo4j-graphrag |
| P3 | 限流配额、日志、API 版本化 | 原计划 |
