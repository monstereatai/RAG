# PRD

> 企业级 RAG 知识库系统产品需求文档。本文描述产品目标和功能边界，实施进度以 `ROADMAP.md` 为准。

## 1. 产品概述

本产品是一个面向企业内部知识管理和问答场景的 Web RAG 系统。用户可以上传企业文档，系统自动解析、切分、索引，并通过 simple / agentic / auto 三种模式完成知识库问答、引用展示、流程追踪和调试分析。

产品强调：

- 企业数据隔离
- 问答结果可追溯
- 多检索通道互补
- Agentic 工作流可观测
- 本地开发和 Docker 部署可复现

## 2. 背景与问题

企业内部文档通常分散在 PDF、DOCX、Markdown、TXT 等格式中，传统全文检索很难处理语义相似、跨文档推理、上下文引用和动态联网补充等问题。通用大模型虽然具备生成能力，但缺少企业私有知识和权限边界。

本项目要解决的问题：

- 文档上传后不能快速转化为可问答知识库。
- 问答无法解释引用来源，难以判断可信度。
- 多用户场景下存在数据串库风险。
- 单一路径 RAG 在复杂问题上容易召回不足。
- Agent 工作流缺乏可观测性，排障困难。
- 本地开发和部署环境不一致，联调成本高。

## 3. 目标用户

| 用户角色 | 需求 |
|---|---|
| 普通知识库用户 | 上传自己的文档并基于文档问答 |
| 企业内部员工 | 在权限范围内快速查询制度、技术文档、业务资料 |
| 管理员 | 管理文档、验证隔离、排查检索质量 |
| 开发/运维人员 | 本地启动、调试、评测和部署系统 |
| AI 应用开发者 | 复用 RAG、Agentic、GraphRAG、Mem0、MCP 等能力 |

## 4. 产品目标

### 4.1 当前目标

- 支持用户登录和 JWT 鉴权。
- 支持多租户知识库隔离。
- 支持文档上传、列表、删除。
- 支持 simple / agentic / auto 三种问答模式。
- 支持 SSE 流式响应和过程事件展示。
- 支持引用来源展示。
- 支持 Debug 面板查看检索分数。
- 支持语音输入和 TTS 朗读。
- 支持长期记忆、GraphRAG、MCP 等扩展能力的可配置启用。
- 支持 Docker Compose 本地 / 预发 / 生产环境。

### 4.2 非目标

- 不做公开 SaaS 多租户计费系统。
- 不做完整企业权限组织架构和 RBAC 后台。
- 不承诺所有真实 LLM 生成链路都满足亚秒级延迟。
- 不把 CI/CD workflow 改动纳入默认开发，CI/CD 属于单独确认项。
- 不把 `agent-course/` 当作产品代码目录，它只是参考实现。

## 5. 核心用户故事

### 5.1 登录与隔离

作为用户，我希望登录后只能看到自己的文档和会话，避免看到其他用户的数据。

验收标准：

- 未登录访问受保护接口返回 401。
- 登录成功后返回 JWT。
- 文档列表、会话列表、检索结果均按 `userId` 隔离。
- 使用不同用户上传的文档互不可见。

### 5.2 文档管理

作为用户，我希望上传文档后系统能自动解析并建立索引，之后可以删除文档。

验收标准：

- 支持 `.md` / `.txt` / `.pdf` / `.docx`。
- 上传成功返回 `docId` 和 chunk 数量。
- 文档列表能显示当前用户文档。
- 删除文档后，元数据、BM25、ES、Milvus 检索结果不再进入回答。
- Milvus 删除超时时不会阻塞主流程，并有重试和残留保护。

### 5.3 知识库问答

作为用户，我希望基于上传文档提问，并看到答案引用来源。

验收标准：

- simple 模式能快速检索和回答。
- agentic 模式能输出过程事件。
- auto 模式能按问题复杂度选择路径。
- 答案包含引用片段。
- 无相关文档时返回友好提示。

### 5.4 流式与过程可视化

作为用户，我希望长回答可以流式输出，并看到系统正在做什么。

验收标准：

- SSE 输出 `routing`、`query_augment`、`retrieval`、`sufficiency`、`web_search`、`rerank`、`token`、`citation`、`reflection`、`final` 等事件。
- 前端能展示思考/检索阶段和最终答案。
- 出错时返回 `error` 事件，不让界面一直卡住。

### 5.5 Debug 与可观测

作为开发者，我希望能看到检索分数和系统指标，便于调试问答质量。

验收标准：

- Debug chunks 接口返回 BM25 / cosine / total score。
- 前端 Debug 面板可以查看分数和 chunk 原文。
- Prometheus metrics 接口可用。
- trace 接口可查询最近 span。
- workflow Mermaid 接口可导出 Agentic RAG 工作流。

### 5.6 长期记忆

作为用户，我希望系统能记住稳定偏好或长期事实，在后续问答中自动注入上下文。

验收标准：

- `MEM0_ENABLED=true` 时启用 Mem0。
- cloud 模式使用 `MEM0_API_KEY`。
- local 模式使用 `MEM0_BASE_URL`。
- 缺配置时明确禁用，不影响核心 RAG。
- 支持记忆列表和清空接口。

### 5.7 GraphRAG

作为用户，我希望系统能基于实体关系回答关系型问题。

验收标准：

- `GRAPH_RAG_ENABLED=true` 且 Neo4j 可用时启用 GraphRAG。
- Neo4j schema 接口返回 `enabled=true`。
- 图谱为空时返回空 schema，不报错。
- 支持实体关系抽取、导入和图谱查询接口。
- dev / staging / prod Docker Compose 都能通过 `graphrag` profile 启动 Neo4j。

## 6. 功能范围

### 6.1 已实现功能

| 模块 | 功能 |
|---|---|
| Auth | 登录、JWT、profile |
| Document | 上传、解析、列表、删除 |
| Chat | simple / agentic / auto 问答 |
| SSE | 流式问答和过程事件 |
| Retrieval | BM25、Milvus、Elasticsearch、Rerank、Web Search |
| Memory | Mem0 cloud/local 接入 |
| GraphRAG | Neo4j 接入、实体关系抽取、导入、查询、schema |
| Speech | 浏览器语音输入、腾讯云 ASR/TTS、TTS SSE |
| Debug | chunks 分数、vector index 信息 |
| Observability | pino、metrics、traces、workflow Mermaid |
| Deployment | dev / staging / prod Docker Compose |
| Evaluation | RAG eval、E2E、perf 脚本 |

### 6.2 待确认 / 待补资源

| 项目 | 当前状态 |
|---|---|
| CI/CD | 本地评测脚本已完成，正式 workflow 需单独确认 |
| MCP | 代码完成，仍需真实 `workspace/mcp-servers.yaml` 和可运行 server |
| GraphRAG 数据 | Neo4j 已连接，仍需导入真实图谱数据源 |
| Bocha | 需 `BOCHA_API_KEY` 才能真实联网搜索 |
| Rerank | 需 `RERANK_API_KEY` 才能真实重排 |
| Tencent ASR/TTS | 需腾讯云密钥和外网联调 |
| 部署目标 | Docker Compose 已建议，云服务器 / K8s 仍待确认 |

## 7. 关键页面

### 7.1 登录页

能力：

- 输入账号密码登录。
- 快捷测试账号登录。
- 登录失败提示。
- 登录成功保存 token。

### 7.2 文档管理页

能力：

- 上传文档。
- 查看当前用户文档列表。
- 删除文档。
- 展示上传和删除状态。

### 7.3 对话页

能力：

- 输入问题。
- 切换 simple / agentic / auto。
- 流式展示回答。
- 展示流程阶段。
- 展示引用来源。
- 支持语音输入和朗读。

### 7.4 Debug 页

能力：

- 输入 query 查看召回 chunk。
- 展示 BM25 / cosine / total score。
- 展开 chunk 原文。

## 8. API 范围

| 能力 | 接口 |
|---|---|
| 登录 | `POST /api/v1/auth/login` |
| 当前用户 | `GET /api/v1/auth/profile` |
| 上传文档 | `POST /api/v1/documents/upload` |
| 文档列表 | `GET /api/v1/documents` |
| 删除文档 | `DELETE /api/v1/documents/:docId` |
| 非流式问答 | `POST /api/v1/chat` |
| 流式问答 | `GET /api/v1/chat/stream` |
| 会话列表 | `GET /api/v1/chat/conversations` |
| Debug chunks | `GET /api/v1/debug/chunks` |
| Vector index | `GET /api/v1/debug/vector-index` |
| 记忆列表 | `GET /api/v1/memories` |
| 清空记忆 | `DELETE /api/v1/memories` |
| 图谱抽取 | `POST /api/v1/graph/extract` |
| 图谱导入 | `POST /api/v1/graph/import` |
| 图谱查询 | `POST /api/v1/graph/query` |
| 图谱 schema | `GET /api/v1/graph/schema` |
| Metrics | `GET /api/v1/metrics` |
| Traces | `GET /api/v1/traces` |
| Workflow | `GET /api/v1/workflows/agentic/mermaid` |

## 9. 非功能需求

### 9.1 安全

- 除登录外接口默认需要 JWT。
- SSE 支持 query token，但必须经过同一鉴权逻辑。
- 所有租户数据以 `userId` 隔离。
- 密钥只存在 `.env` 或运行时环境变量。
- `.env`、`.git`、`.history` 等敏感路径不得被文件工具访问。

### 9.2 性能

- 空知识库快速失败路径已通过性能门禁。
- simple 目标 P50 小于 300ms，agentic 空库快速失败目标 P50 小于 800ms。
- 有真实文档和 LLM 生成时，不承诺固定亚秒级。
- Milvus 超时必须快速降级，不允许问答一直卡住。

### 9.3 可用性

- 可选服务缺配置时不阻断核心 RAG。
- 外部工具缺 key 时返回明确 disabled 状态。
- 文档删除即使遇到 Milvus delete timeout，也不能让残留向量进入答案。

### 9.4 可观测

- 关键接口需要结构化日志。
- HTTP 指标和 Node 指标可采集。
- Trace 支持查询最近 span。
- RAG 流程事件对前端可见。

## 10. 验收标准

### 10.1 本地基础验收

- Docker dev 基础服务 healthy。
- 后端能启动并返回 health 200。
- 前端能 build。
- 前端 lint 通过。
- 后端 build / lint 通过。

### 10.2 业务验收

- 用户能登录。
- 用户能上传文档并提问。
- 答案能显示引用。
- 用户只能看到自己的文档和检索结果。
- 删除文档后不能再被回答引用。
- GraphRAG 启用时 schema 返回 `enabled=true`。

### 10.3 工程验收

- `ROADMAP.md` 与真实状态同步。
- Docker dev / staging / prod 配置可解析。
- prod 启用 `--profile graphrag` 时包含 Neo4j。
- CI/CD 改动未确认前不得修改 workflow。

## 11. 发布与里程碑

| 里程碑 | 范围 | 状态 |
|---|---|---|
| M0 | 项目骨架、规则、基础 Docker | 已完成 |
| M1 | simple RAG 管线 | 已完成 |
| M2 | Agentic RAG | 已完成 |
| M3 | 工程化、鉴权、多租户 | 已完成 |
| M4 | 前端 MVP | 已完成 |
| M5 | 容器化部署 | 已完成 |
| P1/P2/P3 扩展 | Mem0、MCP、GraphRAG、评测、观测 | 多数完成，外部联调继续 |

## 12. 开放问题

- 是否要把 GraphRAG 的图谱导入做成前端可操作能力。
- 是否要引入管理员后台做用户和文档审计。
- 是否需要组织、团队、角色级权限模型。
- 是否要把 Mem0 记忆管理暴露成可编辑 UI。
- 是否要将评测门禁接入正式 CI/CD。
- 生产部署目标是单机 Docker Compose、云服务器还是 K8s。

## 13. 文档关系

- `ARCHITECTURE.md`：技术架构与设计约束。
- `PRD.md`：产品需求与验收标准。
- `ROADMAP.md`：真实进度源。
- `CLAUDE.md`：项目规则。
- `rag-plan.md`：早期计划和技术路线。
