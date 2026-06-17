# Agentic RAG + Karpathy-Style RAG Web 应用计划

## Summary

构建一个从零开始的 Web RAG 系统：前端支持文件上传、语音输入、流式回答；后端使用 FastAPI、LangChain、LangGraph 和 deepagents；向量库使用 PostgreSQL/pgvector；模型、Embedding 和语音服务采用可插拔 Provider。

Karpathy 部分按照"极简、透明的 nano-rag 风格"实现一条手写检索管线（使用 `rank_bm25` + `numpy` cosine 评分），并与 Agentic RAG 混合使用。两种方案可以在同一查询请求中按策略切换。

参考资料：

- [LangGraph Streaming](https://docs.langchain.com/oss/python/langgraph/streaming)
- [deepagents](https://reference.langchain.com/python/deepagents/deepagents)
- [LangChain PGVector](https://docs.langchain.com/oss/python/integrations/providers/pgvector/)
- [rank_bm25](https://github.com/dorianbrown/rank_bm25)
- [Tavily Search API](https://docs.tavily.com/)

---

## Key Changes

### 后端架构

- 使用 FastAPI 提供 REST API 和 SSE/WebSocket 流式接口。
- 使用 LangGraph 定义 Agentic RAG 工作流节点：
  - Query rewrite
  - Routing（由 deepagents 原生决策，不额外引入路由框架）
  - Retrieval（向量检索 + Tavily 联网检索）
  - Rerank
  - Answer generation
  - Reflection / Self-Critique
- 使用 deepagents 处理复杂任务，包括规划、工具调用、多步检索和子任务分解。
- Karpathy-style RAG 作为独立模块，使用 `rank_bm25` + `numpy` 实现，不依赖 LangChain 检索器，便于调试与对照。

### 混用策略

两种方案在同一系统中互补运行，不互斥：

- **简单问题** 默认走 Karpathy-style 快速检索（rank_bm25 + numpy），延迟低、结果透明可调试。
- **复杂问题** 走 Agentic RAG，由 deepagents 判断是否需要多轮检索、查询改写、工具调用（含 Tavily 联网）和子任务分解。
- 提供以下运行模式（用户可在请求中强制指定）：
  - `auto`：deepagents 自动决策，作为默认值。
  - `agentic`：强制使用 Agentic RAG + 全部工具。
  - `simple`：强制使用 Karpathy-style 快速管线。

### Karpathy-Style RAG 模块（极简透明管线）

使用以下现有库，**不自己实现算法**：

| 功能 | 使用库 |
|---|---|
| 稀疏检索（BM25） | `rank_bm25`（`BM25Okapi`） |
| 密集检索（cosine） | `numpy`（向量点积 / norm） |
| 分数融合 | 线性加权：`score = α * bm25 + (1-α) * cosine` |
| Prompt Assembly | 纯 Python f-string，无框架 |
| Top-K 筛选 | `numpy.argsort` |

**可观测能力**（内置 Debug 接口）：

- `GET /api/debug/chunks?query=...` 返回每个 candidate chunk 的 BM25 分、cosine 分和最终分，用于调试。
- 在流式响应的 `retrieval` 事件中携带各 chunk 原始分数，前端 Debug 面板可展开查看完整 prompt。

### Agentic RAG 模块（工具调用 + 多轮检索）

deepagents + LangGraph，包含以下内置工具：

| 工具 | 实现方案 |
|---|---|
| `vector_search` | pgvector 向量检索（LangChain PGVector） |
| `keyword_search` | BM25 关键字检索（`rank_bm25`，复用 Karpathy 模块） |
| `web_search` | Tavily Search API（`langchain-community` TavilySearchResults） |
| `query_decompose` | deepagents 内置规划能力，拆解多跳问题为子问题 |
| `document_summarizer` | LangChain `load_summarize_chain`（map-reduce 模式） |

**Multi-hop 检索**：Agent 最多执行 3 轮检索，每轮根据前一轮结果自动调整查询词。

**Reflection 节点**：LangGraph 中加入 Answer Critic 节点，对生成答案打置信分（0~1），低于阈值（默认 0.7）则触发重新检索。

### Router 策略（deepagents 原生决策）

不引入额外路由框架，由 deepagents 根据输入消息和工具上下文自动决策：

- 简单事实型问题 → deepagents 直接选择 `keyword_search` / `vector_search`，走 Karpathy 快速管线。
- 含多跳、比较、推理类问题 → deepagents 触发 `query_decompose` + 多轮工具调用，走 Agentic 管线。
- 需要联网补充知识时 → deepagents 自动调用 `web_search`（Tavily）。

流式响应新增 `routing` 事件，前端展示"本次实际使用的模式 + 工具调用链"。

提供以下显式运行模式（用户可强制覆盖）：

- `auto`：deepagents 自动决策，默认值。
- `agentic`：强制使用 Agentic RAG + 全部工具。
- `simple`：强制使用 Karpathy-style 快速管线（rank_bm25 + numpy）。

### 数据层

- 使用 PostgreSQL + pgvector 存储 chunks、embeddings、metadata 和 source references。
- Chunk metadata 标准字段：

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
  5. 写入 pgvector
  6. 写入 BM25 索引（rank_bm25，内存缓存，随服务启动加载）
  7. 查询处理状态

### 模型抽象

- 定义 `LLMProvider`、`EmbeddingProvider` 和 `SpeechProvider` 接口。
- 第一版至少支持 OpenAI-compatible Provider。
- 预留 Ollama、Anthropic 和本地 STT 等 Provider 配置。
- Karpathy 模块的 Embedding 复用同一个 `EmbeddingProvider`，不单独实现。

### 前端

- 推荐使用 React + Vite 构建轻量 MVP。
- 页面包含：
  - 文件上传
  - 知识库列表
  - 聊天窗口（含流式回答）
  - 语音录入（浏览器录音 → 后端 STT → 文本查询）
  - 引用来源展示（可展开查看 chunk 原文）
  - **模式切换器**：用户可手动选择 `simple / agentic / auto`
  - **路由追踪面板**：每次回答结束后展示"实际使用模式 + 检索轮数 + 工具调用链"
  - **Debug 面板**（可折叠）：展示各 chunk 的 BM25 / cosine 原始分数 + 完整 Prompt

---

## Public Interfaces

### 文档接口

- `POST /api/documents/upload`
  - 上传文件并触发索引（向量 + BM25 双索引）。
- `GET /api/documents`
  - 查看已索引文档和处理状态。

### 聊天接口

- `POST /api/chat`
  - 非流式调试接口。
- `POST /api/chat/stream`
  - 使用 SSE 或 WebSocket 流式输出 token、工具事件和引用来源。

Chat 请求字段：

- `message`
- `mode`: `auto | agentic | simple`
- `provider`
- `conversation_id`
- `top_k`

Chat 流式响应事件：

- `routing`：本次实际选用的模式和工具列表
- `token`：LLM 生成的 token 片段
- `tool_call`：工具调用（含 Tavily web_search 调用）
- `retrieval`：检索结果，含各 chunk 的 BM25 / cosine 分数
- `citation`：引用来源
- `final`：完整答案
- `error`

### 语音接口

- `POST /api/speech/transcribe`
  - 将语音文件转换为文本。

### Debug 接口

- `GET /api/debug/chunks?query=&mode=&top_k=`
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
│                           Backend (FastAPI)                          │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                     API Layer                                 │   │
│  │  POST /upload  GET /documents  POST /chat  POST /chat/stream │   │
│  │  POST /speech/transcribe  GET /debug/chunks                  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                   Mode Router                                 │   │
│  │  auto → deepagents / LangGraph 决策                           │   │
│  │  agentic → Agentic RAG 管线                                  │   │
│  │  simple  → Karpathy-style 快速管线                           │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                        │              │                              │
│          ┌─────────────┘              └─────────────┐              │
│          ▼                                          ▼              │
│  ┌──────────────────┐                  ┌──────────────────────┐     │
│  │  Agentic RAG     │                  │  Karpathy-style RAG  │     │
│  │  (LangGraph)     │                  │  (Minimal Pipeline)  │     │
│  │                  │                  │                      │     │
│  │ ┌──────────────┐ │                  │ ┌──────────────────┐ │     │
│  │ │ Query Rewrite│ │                  │ │ rank_bm25        │ │     │
│  │ └──────────────┘ │                  │ └──────────────────┘ │     │
│  │ ┌──────────────┐ │          ┌───────┤ numpy cosine         │ │     │
│  │ │ deepagents   │ │          │       │ score fusion         │ │     │
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
│  │  vector_search  keyword_search  web_search(Tavily)        │   │     │
│  │  query_decompose  document_summarizer                      │   │     │
│  └────────────────────────────────────────────────────────────┘   │     │
└─────────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌──────────────────┐
│  PostgreSQL     │ │   In-Memory     │ │  External APIs   │
│  + pgvector     │ │   BM25 Index    │ │  ─────────────   │
│                 │ │   (rank_bm25)   │ │  OpenAI/兼容 LLM │
│  ┌───────────┐  │ │   启动时加载    │ │  Embedding       │
│  │ chunks    │  │ │                 │ │  Tavily Search   │
│  │ embeddings│  │ │                 │ │  STT (可选)      │
│  │ metadata  │  │ │                 │ └──────────────────┘
│  └───────────┘  │ │
└─────────────────┘ └─────────────────┘
```

## 依赖清单（核心库）

| 库 | 版本要求 | 用途 |
|---|---|---|
| `fastapi` | latest | API 框架 |
| `langgraph` | latest | Agentic 工作流 |
| `langchain` | latest | RAG 组件 |
| `langchain-community` | latest | TavilySearchResults |
| `deepagents` | latest | Agent 规划与工具调用 |
| `rank_bm25` | >=0.2 | Karpathy-style BM25 检索 |
| `numpy` | >=1.24 | cosine 相似度计算 |
| `pgvector` | latest | PostgreSQL 向量扩展 |
| `psycopg2` | latest | PostgreSQL 驱动 |
| `tavily-python` | latest | Tavily Web Search |
| `openai` | latest | OpenAI-compatible LLM/Embedding |

---

## Test Plan

### 单元测试

- 验证文档解析、chunking 和 metadata 保留（包含 char_start/char_end）。
- 验证 Karpathy 模块：rank_bm25 评分、cosine 计算、加权融合和 Top-K 筛选结果正确。
- 验证 Provider 抽象在 mock LLM 和 embedding 下可以运行。
- 验证 Tavily 工具调用在 mock 模式下正确传参和解析结果。

### 集成测试

- 上传文件后可以在 pgvector 和 BM25 内存索引中同时查到对应 chunks。
- `simple`、`agentic` 和 `auto` 三种模式都能返回答案及引用。
- 流式接口按顺序输出 `routing → token → retrieval → final` 事件。
- Tavily web_search 触发后，`tool_call` 事件正确出现在流中。
- Debug 接口 `/api/debug/chunks` 返回包含 BM25 / cosine 双分数的结果。

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
- Tavily API key 缺失时，web_search 工具被自动禁用，不影响其他工具。

---

## Assumptions

- 当前仓库为空，项目按全新系统搭建。
- 第一版知识库以用户上传文件为主。
- 向量库使用 PostgreSQL/pgvector。
- Karpathy-style 模块使用 `rank_bm25` + `numpy`，不自己实现 BM25 或向量算法，embedding 复用统一 Provider。
- Router 不引入额外框架，由 deepagents 原生决策；`mode` 字段允许用户强制覆盖。
- Tavily Web Search 为可选工具，API key 缺失时自动跳过，不作为必选依赖。
- 模型层要求可插拔，但第一版先实现 OpenAI-compatible Provider，再通过配置扩展其他 Provider。
- BM25 索引在内存中维护，服务启动时从 pgvector 加载所有 chunk 文本重建；后续可按需持久化。
