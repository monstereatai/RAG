# RAG 项目简历与面试讲解手册

> 目标：把本项目讲成高级 Agent 工程师、高级 AI 应用开发工程师、高级前端开发工程师、前端负责人都能成立的代表项目。不要背功能清单，要讲清楚问题、取舍、架构、验证和边界。

## 一句话定位

这是一个企业级 Agentic RAG + Karpathy-style RAG 知识库系统，核心不是“接了一个大模型接口”，而是围绕 **查得准、答得稳、引用能撑住、不会瞎编** 做了完整工程闭环：文档解析、混合检索、Agentic 编排、GraphRAG、MCP、语音、多租户隔离、观测、评测门禁和 Docker Compose 部署。

简历上可以写：

```text
主导设计并实现企业级 Agentic RAG 知识库系统，基于 NestJS + React + LangGraph.js + Milvus + Elasticsearch + PostgreSQL + Redis + Neo4j，完成文档解析、混合检索、引用校验、Agentic 工作流、GraphRAG、MCP 工具调用、多租户隔离、Prometheus 指标和自动化评测门禁；本地工程成熟度门禁 93/100，项目级仿真实业务评测 22/22 通过。
```

不要写成：

```text
使用大模型实现了一个知识库问答系统。
```

这个说法太薄，像调 API 的。

## 你必须真正弄懂的东西

### 1. RAG 主链路

必须能讲清楚：

- 文档如何从上传文件变成可检索 chunk。
- Markdown/TXT/PDF/DOCX 的解析边界分别是什么。
- chunk size / overlap 为什么不能乱调。
- BM25、Elasticsearch、Milvus 各自解决什么问题。
- 为什么中文召回不能只靠向量。
- 为什么需要 rerank。
- 为什么低相关时要拒答，而不是硬让 LLM 编。
- 为什么答案必须带引用，并且引用要能支撑 claim。

建议讲法：

```text
我没有把 RAG 简化成“向量召回 + LLM 总结”。系统里默认走 hybrid retrieval，把 BM25/ES 的关键词精确性和 Milvus 的语义召回结合起来，再做相关性闸门、引用编号校验和 claim-level 支撑校验。检索不足、引用缺失、引用支撑不住时，系统会拒答或回退到片段抽取式回答，避免模型用流畅语言掩盖没依据的问题。
```

### 2. Agentic RAG

必须能讲清楚：

- simple / agentic / auto 三种模式的区别。
- Agentic 不是所有问题都该走。
- LangGraph 节点为什么拆成 routing、query augment、retrieval、sufficiency、web search、rerank、generate、reflection、final。
- 为什么 Agentic 要有成本边界。
- 为什么 auto 模式要克制，而不是所有问题都扔给 Agent。
- reflection 的价值和局限是什么。

建议讲法：

```text
我把 Agentic RAG 当成复杂问题增强，而不是默认主链路。普通问题走可解释的 simple hybrid retrieval，复杂问题才进入 LangGraph 编排。Agentic 节点有预算控制，包括 query 扩展数量、检索查询数、返回 chunk 数、web search 数、rerank topN 和最大重试次数，避免 Agent 把一个普通问题跑成高成本黑盒流程。
```

### 3. 企业级 RAG 质量治理

必须能讲清楚：

- 为什么“能回答”不等于“企业级”。
- 什么叫查得准、答得稳、引用能撑住、不会瞎编。
- 如何设计评测集。
- 为什么要有拒答题、冲突题、版本题、别名题、跨文档题。
- 为什么合成评测不能冒充真实业务评测。
- 93/100 代表什么，不代表什么。

建议讲法：

```text
我做了两层评测：一层是内置业务回归集，覆盖 claim、citation、refusal、conflict；另一层是项目级仿真实业务评测，会真实启动后端，上传模拟业务文档，分别用 simple 和 auto 提问，再评分并清理。现在本地工程成熟度是 93/100，项目级仿真实业务评测 22/22 通过。但我不会把它吹成生产业务 90 分，因为还缺公司真实私有题库和真实标准答案。
```

### 4. 引用与幻觉控制

必须能讲清楚：

- 引用编号存在不等于引用有效。
- 为什么要做 claim-level 校验。
- LLM 给了好听答案但引用撑不住时怎么办。
- 无答案问题为什么要拒答。
- 弱关键词误召回为什么危险。

建议讲法：

```text
企业知识库最怕的是模型说得很像真的。我的处理是答案必须显式引用片段，并且关键句要能被引用片段支撑。曾经项目级评测里有一个负例只因为“报销”这个弱词被召回，系统差点给出确定答案，后来我加了中文短语重合闸门，避免单个泛词支撑业务结论。
```

### 5. GraphRAG

必须能讲清楚：

- GraphRAG 适合什么问题，不适合什么问题。
- Neo4j 在系统里承担什么角色。
- 实体、关系、别名、置信度、版本、生效期为什么重要。
- 为什么真实图谱数据比“能跑一个图查询”更重要。

建议讲法：

```text
我没有把 GraphRAG 当成万能检索。它主要用于关系型问题，比如实体之间的上下游、负责人、依赖、组织关系和制度关系。系统已经有实体关系抽取、图谱导入、图查询和 schema 接口，但真实价值依赖业务侧实体类型、关系类型、别名规则和初始数据源。
```

### 6. MCP 与工具调用

必须能讲清楚：

- MCP 解决的不是问答，而是 Agent 连接外部工具的问题。
- server、transport、tool list、鉴权方式分别是什么。
- 为什么默认开发环境不能让 MCP 初始化阻塞启动。
- 工具调用为什么需要边界和观测。

建议讲法：

```text
MCP 在这个项目里负责把 Agent 和外部工具解耦。系统支持配置化接入 MCP server，并提供 smoke 和配置校验。默认开发环境下 MCP 不会阻塞后端启动，只有显式开启时才连接真实 server，这样避免本地依赖缺失把核心 RAG 链路拖死。
```

### 7. 多租户与数据隔离

必须能讲清楚：

- JWT 鉴权只是一层入口，不等于多租户隔离。
- PostgreSQL、Redis、Milvus、BM25 都要按 userId 隔离。
- EventSource SSE 如何携带 token。
- 文档删除为什么要同步清理多处索引。

建议讲法：

```text
这个系统的数据隔离不是只在 controller 里判断一下用户。关系库、Redis 缓存、Milvus 向量、BM25 索引都带 userId 维度。SSE 因为浏览器 EventSource 不方便加 header，所以支持 query token。文档删除时会同步清理元数据、chunk、BM25 和向量侧残留，并且对残留向量做 active docId 过滤。
```

### 8. 可观测与稳定性

必须能讲清楚：

- Prometheus 指标有哪些。
- traceparent 有什么用。
- 为什么 Milvus timeout 不能拖死主链路。
- Redis Checkpointer 解决什么问题。
- 外部 API 没 key 或失败时如何降级。

建议讲法：

```text
外部依赖不稳定是 AI 应用常态，所以系统默认可降级。Milvus search 超时会快速失败并回退 BM25，Bocha/Rerank 没 key 时跳过但不阻断，Redis 不可用时 Checkpointer 回退内存。可观测上有 HTTP 指标、检索命中、LLM 调用耗时、token 估算和 traceparent，方便定位一次回答到底慢在检索、重排还是生成。
```

## 面向不同岗位的讲法

### 高级 Agent 工程师

重点讲：

- LangGraph 状态机拆分。
- simple / agentic / auto 路由策略。
- Agentic 成本预算。
- MCP 工具接入。
- human interrupt / resume。
- Reflection 与质量闸门。
- 不让 Agent 干扰稳定主链路。

简历项目描述：

```text
设计 Agentic RAG 工作流，基于 LangGraph.js 拆分 routing、query augment、retrieval、sufficiency、web search、rerank、generate、reflection 等节点；支持 SSE 事件流、人工审批 resume、MCP 工具接入和成本预算控制，在复杂问题增强与普通问答稳定性之间做路由隔离。
```

面试要表达的判断：

```text
Agent 不是越多越好。我的设计里 Agentic 是复杂问题的增强路径，simple RAG 才是稳定主链路。企业应用里不能为了“智能感”牺牲确定性、成本和可解释性。
```

### 高级 AI 应用开发工程师

重点讲：

- 端到端 AI 应用工程化。
- Provider 抽象。
- LLM / Embedding / Speech / Rerank / Web Search 可插拔。
- 评测门禁。
- 引用、拒答、冲突治理。
- 外部依赖降级。

简历项目描述：

```text
搭建 AI 应用工程化底座，抽象 LLM、Embedding、VectorStore、Speech、Rerank、WebSearch Provider；实现 RAG 质量门禁、业务回归评测、LLM-as-Judge 可选评估、引用支撑校验和低相关拒答策略，保证模型能力可集成、可降级、可观测、可验证。
```

面试要表达的判断：

```text
AI 应用的难点不是调通模型，而是让模型输出在业务系统里可控。我的关注点是召回质量、引用证据、拒答边界、成本预算、外部 API 降级和评测闭环。
```

### 高级前端开发工程师

重点讲：

- React + Vite 前端体验。
- SSE 流式问答。
- 多模式聊天状态。
- 上传、删除、Debug 面板。
- 语音输入、TTS 播放。
- 登录态与 EventSource token。
- 前端如何把 Agent 过程可视化，而不是只展示最终答案。

简历项目描述：

```text
实现 RAG 前端应用，支持文档上传、多模式聊天、SSE 流式响应、Agent 路由追踪、Debug 检索分数面板、引用展示、Web Speech 语音输入和 TTS 播放；处理 JWT 登录态、EventSource token 兼容和多租户视图隔离。
```

面试要表达的判断：

```text
AI 前端不是把一个聊天框套到页面上。用户需要看到回答从哪里来、当前处于哪个 Agent 节点、引用是否可靠、为什么拒答。前端要把模型的不确定性产品化。
```

### 前端负责人

重点讲：

- 如何把 AI 项目拆阶段推进。
- 如何定义验收标准。
- 如何控制技术债和边界。
- 如何让前后端、算法、基础设施协同。
- 如何把质量从“主观感觉”变成门禁。
- 如何把风险写进 ROADMAP，而不是藏起来。

简历项目描述：

```text
负责企业级 RAG 应用从 0 到 1 的技术规划、架构拆解与交付推进，按 M0-M5 里程碑管理项目节奏，定义查得准、答得稳、引用能撑住、不会瞎编四类核心质量标准，并通过 ROADMAP、评测门禁、Docker Compose 和可观测指标形成持续交付闭环。
```

面试要表达的判断：

```text
我不会一开始就堆 GraphRAG、MCP、多 Agent。我的推进方式是先跑通最小 RAG 链路，再做 Agentic，再做前端体验和部署，最后补评测、观测、权限和质量门禁。AI 项目最怕看起来很炫，实际上没有验收标准。
```

## 面试高频问题与回答

### 你这个项目最大的技术难点是什么？

回答重点：

```text
最大的难点不是接模型，而是让回答可控。企业 RAG 的核心风险是召回不准、引用撑不住、模型编答案、外部依赖不稳定。我做了 hybrid retrieval、低相关拒答、claim-level 引用支撑校验、项目级评测、外部依赖降级和 Prometheus 指标，把“看起来能答”变成“有证据地答”。
```

### 为什么不用纯向量检索？

回答重点：

```text
纯向量对语义相近问题有优势，但中文业务知识库里有大量制度编号、系统缩写、人名、金额、版本号、专有名词，纯向量容易召回语义像但事实不准的片段。所以系统结合 BM25/ES 的关键词精确召回和 Milvus 的语义召回，再加 rerank 与质量闸门。
```

### 为什么还要 BM25？

回答重点：

```text
BM25 对关键词、缩写、编号、金额、版本、制度名很稳定，而且可解释。它不是过时方案，在企业 RAG 里反而是压住幻觉的基础部件。尤其中文场景里，我还接入了 jieba 分词和短语重合闸门，避免弱词误召回。
```

### Agentic RAG 和普通 RAG 的边界是什么？

回答重点：

```text
普通事实查询优先 simple RAG，因为链路短、成本低、可解释。只有多跳、需要查询扩展、检索不足、需要联网或工具调用的问题，才进入 Agentic。否则 Agent 只会增加不确定性和延迟。
```

### 你怎么证明这个 RAG 质量好？

回答重点：

```text
我不用主观 demo 证明。项目里有 eval:rag:quality 质量门禁，包括 smoke、业务回归集、项目级仿真实业务评测和成熟度评分。项目级评测会真实上传模拟业务文档，用 simple 和 auto 提问，评分后清理。目前 22/22 通过，本地工程成熟度 93/100。但我也明确承认，没有真实私有业务题库前，不能宣称真实生产业务 90 分。
```

### 如果模型答错了，你怎么定位？

回答重点：

```text
先看检索：命中的 chunk、BM25/向量/融合分、是否低相关、是否 rerank 后偏移。再看生成：答案引用编号是否存在、claim 是否被引用支撑。最后看外部依赖：Milvus、Redis、Bocha、Rerank、LLM 调用耗时和错误。系统有 Debug 面板、SSE 事件、Prometheus 指标和 traceparent，能拆到链路阶段。
```

### 项目还有什么不足？

回答重点：

```text
我会明确说三个：第一，缺真实私有业务评测集，合成数据不能冒充业务真实；第二，本机 Docker Milvus search 仍有 timeout warning，虽然已快速降级但运行时治理还可继续；第三，GraphRAG 和 MCP 已有工程入口，但真实价值依赖业务侧数据源和真实工具。这个回答比硬吹“全完成”更可信。
```

## 可以写进简历的成果指标

可写：

- 本地工程成熟度门禁 `93/100`。
- 项目级仿真实业务评测 `22/22` 通过。
- 业务回归评测集 `120` 条。
- 支持 simple / agentic / auto 三种 RAG 模式。
- 支持 Markdown/TXT/PDF/DOCX 上传解析。
- 覆盖 PostgreSQL / Redis / Milvus / BM25 多租户隔离。
- 支持 Prometheus 指标、traceparent、SSE 事件流。
- 支持 Bocha Web Search、DashScope Rerank、腾讯云 ASR/TTS、Mem0、MCP、Neo4j GraphRAG。

不要写：

- “生产可用 99.99%”。
- “完全企业级闭环”。
- “真实业务准确率 90%+”。
- “支持所有文档格式完美解析”。

这些没有真实生产证据，面试官追问会露馅。

## 讲项目的 2 分钟版本

```text
这个项目是我做的企业级 Agentic RAG 知识库系统。它不是简单的向量库问答，而是围绕企业知识库最核心的四个标准设计：查得准、答得稳、引用能撑住、不会瞎编。

技术上，后端用 NestJS，前端用 React + Vite。RAG 主链路有文档解析、chunking、Embedding、Milvus 向量检索、BM25/Elasticsearch 中文关键词检索、DashScope Rerank、引用支撑校验和低相关拒答。复杂问题会进入 LangGraph Agentic 工作流，包含 query augment、retrieval、sufficiency、web search、rerank、generate、reflection 等节点，但普通问题不会默认走 Agent，避免成本和不确定性。

工程化上，我做了 JWT 和多租户隔离，数据隔离覆盖 PostgreSQL、Redis、Milvus 和 BM25；还有 Prometheus 指标、traceparent、Docker Compose、MCP 工具接入、GraphRAG、腾讯云 ASR/TTS 和 Redis Checkpointer。

质量上，项目不是靠 demo 证明，而是有 eval:rag:quality 门禁，包含 120 条业务回归集、项目级仿真实业务评测和成熟度评分。当前本地工程成熟度是 93/100，项目级仿真实业务评测 22/22 通过。但我也明确区分工程分和真实业务分，真正生产级还需要接入公司真实私有题库和生产环境材料。
```

## 讲项目的 30 秒版本

```text
我做了一个企业级 Agentic RAG 知识库系统，后端 NestJS，前端 React，检索层结合 Milvus、BM25、Elasticsearch 和 Rerank，复杂问题走 LangGraph Agentic 工作流，普通问题走稳定 simple RAG。系统重点解决企业知识库里的召回准确性、引用支撑、拒答边界、多租户隔离、外部依赖降级和评测门禁。本地工程成熟度 93/100，项目级仿真实业务评测 22/22 通过。
```

## 面试时最好主动承认的边界

主动说这些，反而显得懂行：

- 93/100 是本地工程成熟度，不是生产 SLA。
- 仿真实业务题不能替代公司真实私有题库。
- Milvus 本机 Docker search warning 已降级，但还值得从容器版本、segment、资源配置继续治理。
- GraphRAG 和 MCP 的工程入口已有，但真实业务价值取决于数据源和工具质量。
- AI 应用不是一次性交付，必须持续积累评测集和失败样本。

## 你要避免的低级说法

不要说：

- “我用 LangChain 做了 RAG。”
- “Agent 会自动判断并解决复杂问题。”
- “向量检索比关键词检索高级。”
- “有了 GraphRAG 就更准确。”
- “准确率 90% 多。”
- “这个项目已经企业级生产可用了。”

应该说：

- “我用 hybrid retrieval 和质量闸门控制回答边界。”
- “Agentic 是复杂问题增强，不是默认路径。”
- “关键词检索在中文企业知识库里非常关键。”
- “GraphRAG 适合关系型问题，价值依赖真实图谱数据。”
- “当前本地工程成熟度 93/100，真实业务分要接真实题库后才能打。”
- “系统具备生产化基础，但发布仍需要目标环境、证书、备份、密钥注入策略。”

## 推荐复盘顺序

面试前按这个顺序准备：

1. 先读 `README.md`，掌握项目一句话和当前状态。
2. 再读 `ARCHITECTURE.md`，掌握模块边界和技术取舍。
3. 再读 `ROADMAP.md`，掌握完成项、缺口和验证证据。
4. 再看 `backend/src/rag/karpathy/karpathy-rag.service.ts`，弄懂稳定主链路。
5. 再看 `backend/src/rag/agentic/agentic-rag.service.ts`，弄懂 Agentic 编排。
6. 再看 `backend/scripts/eval-rag-quality-gate.mjs`、`backend/scripts/eval-rag-project.mjs`、`backend/scripts/eval-rag-maturity.mjs`，弄懂质量门禁。
7. 最后看前端聊天、上传、Debug、SSE 相关页面，准备前端岗位追问。

## 最核心的面试心法

这个项目最有价值的讲法不是“我接了很多 AI 能力”，而是：

```text
我知道企业级 RAG 最容易死在哪里，并且我在工程里给这些风险加了边界、证据、降级和评测。
```

高级岗位看重的不是功能数量，而是你能不能解释清楚为什么这样设计、哪里不能吹、出了问题怎么定位、上线后怎么持续变好。
