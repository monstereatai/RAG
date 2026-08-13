# RAG 项目简历写法

更新时间：2026-08-12

## 依据材料

- `jl-pic/jl-pic-summary.md`：已逐张阅读 57 张图片后整理的项目素材总结。
- 本文只吸收可迁移的表达结构，不照搬图片里的行业、公司、时间线和业务指标。

## 项目名称

企业级 Agentic RAG 知识治理与问答平台

## 项目描述

基于 NestJS + React + LangGraph.js + Milvus + Elasticsearch + PostgreSQL + Redis + Neo4j 构建企业级 Agentic RAG 知识治理与问答平台，覆盖文档解析、混合检索、GraphRAG、Agentic Workflow、MCP 工具治理、AG-UI/SSE 流式输出、权限过滤、引用校验、拒答策略、评测门禁和后台运营。项目重点解决企业知识库“搜得到、答得准、有引用、可评测、可运营、可控成本”的工程落地问题。

最新公开资料验收：建立中国 PC 端候选 Top50、页游候选 Top50 目录，实际抓取 127 个公开页面，108 份唯一目标文档全部完成索引；资料进入 PostgreSQL、Milvus、BM25／Elasticsearch、Karpathy 和 Obsidian。该数据用于验证公开资料入库和检索链路，不代表真实企业线上效果。

## 简历最终版

```text
企业级 Agentic RAG 知识治理与问答平台｜NestJS、React、LangGraph.js、Milvus、Elasticsearch、Neo4j

- 主导设计并实现企业级 Agentic RAG 知识治理与问答平台，围绕“数据接入、知识索引、可信问答、权限过滤、评测回归、后台运营”搭建完整闭环，支持企业文档、图谱、个人知识库和多模态素材的统一治理。
- 设计文档入库链路，支持多格式解析、URL 抓取、结构化分块、metadata 标注、Karpathy + Obsidian 知识编译、向量索引、关键词索引和 GraphRAG 实体关系沉淀，保证知识进入系统后可检索、可追踪、可运营。
- 实现 Milvus 向量召回 + BM25/Elasticsearch 关键词召回 + RRF 融合 + DashScope Rerank + 引用支撑校验的 Hybrid Search 链路，配合 query rewrite、低相关拒答和权限过滤，降低企业知识库无依据回答风险。
- 基于 LangGraph 构建 simple / auto / agentic 分层问答编排，简单问题优先走 Karpathy + Obsidian fast path，复杂问题升级到 query augment、retrieval、sufficiency、web search fallback、rerank、generate、reflection、human approval 等节点，并通过预算、超时和降级控制成本与稳定性。
- 接入 MCP Provider、Bocha Web Search、DashScope Rerank、Graph Search、ASR/TTS、Vision Provider 等工具能力，补充 Tool Registry、Prompt Registry、Prompt Injection 检测、工具超时、审计和 fallback 机制，形成 Agent 工具调用治理边界。
- 建设管理后台与评测体系，覆盖文档治理、AI 问答运营、GraphOps 节点编辑、权限管理、审计日志、指标观测、业务回归集、项目级仿真实业务评测和 Agent 任务评测；当前本地工程成熟度 93/100，项目级仿真实业务评测 28/28 通过。
```

## 可展开亮点

- **RAG 主链路**：文档解析、分块、Embedding、Milvus、BM25/ES、RRF、Rerank、引用校验、低相关拒答、权限过滤，能回答“检索效果怎么优化”这类追问。
- **Agent 编排**：LangGraph 节点化工作流、simple/auto/agentic 分层路由、预算参数、超时降级、human approval，能说明 Agent 不是黑盒自由运行。
- **GraphRAG**：Neo4j provider、实体/关系/别名、GraphOps、图谱查询、节点编辑，用来补足向量检索缺少关系推理的问题。
- **MCP / 工具治理**：MCP Provider、Tool Registry、Prompt Registry、Bocha、Rerank、Graph Search、ASR/TTS/Vision Provider，强调工具权限、超时、审计和 fallback。
- **Karpathy + Obsidian**：simple 模式优先走本地知识 fast path，auto 模式按 sufficiency gate 决定是否升级 agentic，适合回答“低延迟和复杂问题怎么兼顾”。
- **AG-UI / SSE**：真实流式 token 输出、Markdown/代码块/图片/引用渲染、事件轨迹去噪、历史会话恢复，适合回答“SSE vs WebSocket”和“富文本怎么输出”。
- **评测闭环**：业务回归集、项目级仿真评测、成熟度评分、Prompt Injection 检测、Agent 任务评测脚手架，避免只靠主观体验调参。
- **后台运营**：文档治理、问答记录、GraphOps、权限管理、审计日志、指标观测、模型配置和系统管理，突出企业级可运营能力。

## 量化指标

- 本地工程成熟度门禁达到 `93/100`。
- 项目级仿真实业务评测 `28/28` 通过。
- 内置业务回归评测集覆盖 `120+` 条用例。
- 私密模拟数据覆盖 `27` 个脱敏业务文档、`193` 条业务问题、`15` 条 GraphRAG 种子、`19` 个多模态登记项。
- Prompt Injection 专项评测 `7/7` 通过。

## 面试补充边界

```text
这个项目主干 RAG / Agent 应用工程能力已经完整，但真实生产 SLA、金融合规、真实组织权限、真实业务 API 和完整多模态模型闭环，需要接入公司真实环境后继续验证。
```

## 从 jl-pic 素材吸收后的面试口径

- 面试官问 RAG 优化时，按“文档解析 -> Chunk -> Embedding -> 多路召回 -> RRF/Rerank -> Prompt -> 引用校验 -> 评测回流”回答，不要只说调 TopK。
- 面试官问 Agent 时，强调状态机、节点、条件边、工具调用、终止条件、预算、超时、降级和人工确认。
- 面试官问 Memory 时，区分短期会话记忆、长期用户记忆和 RAG 知识事实，避免把所有上下文都塞进 prompt。
- 面试官问 MCP 时，回答它解决工具接入、上下文传递、权限边界、审计和多 Agent 共享工具能力的问题。
- 面试官问 SSE 时，回答单向 token 流、断线重连、事件去噪、Markdown 富文本渲染和历史会话恢复；双向高频交互才更适合 WebSocket。
- 面试官问多模态时，当前项目要如实说已有资源登记、Vision Provider、OCR/ASR sidecar 和降级链路，真实视觉向量检索需要模型 key 和样本后继续闭环。
- 面试官问一线大厂差距时，回答真实生产 SLA、真实业务题库、真实组织系统、合规审计、全链路压测和真实多模态模型效果仍需接入公司环境验证。

## 不建议写法

不要写：

```text
使用大模型实现了一个知识库问答系统。
```

原因：

```text
这个说法太薄，像调 API。项目真正的价值是 RAG / Agent / 工具 / 评测 / 权限 / 后台运营的工程闭环。
```
