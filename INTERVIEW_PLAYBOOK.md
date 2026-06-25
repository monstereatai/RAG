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

### 9. RAG 召回评测指标

必须能讲清楚：

- 召回评测不是只看最终答案对不对，要拆成 retrieval、rerank、generation 三段。
- Retrieval 看目标证据有没有被召回：Hit Rate、Recall@K、MRR、NDCG。
- Rerank 看目标证据是否排到前面：NDCG@K、MRR、Top1/Top3 命中。
- Answer 看答案是否用对证据：Answer Relevance、Faithfulness、Citation Accuracy、Claim Support。
- 负例看系统会不会拒答：Refusal Accuracy、False Positive Rate。
- 按题型分层看：事实题、别名题、缩写题、金额/版本题、跨文档题、冲突题、无答案题、多轮追问题。

建议讲法：

```text
我会把 RAG 评测拆成召回、排序、生成三层。召回层看 Recall@K、Hit Rate、MRR，确认标准答案证据有没有进 topK；排序层看 rerank 后 NDCG/MRR 是否提升；生成层看答案相关性、faithfulness、引用准确率和 claim 是否被引用片段支撑。企业场景还必须单独评拒答题和冲突题，否则系统很容易在无答案问题上胡编。
```

项目映射：

- `eval:rag:quality`：质量总门禁。
- `eval:rag`：业务回归集、claim/citation/refusal/conflict 评测。
- `eval:rag:project`：项目级仿真实业务真实后端回放。
- `eval:rag:maturity`：按查得准、答得稳、引用能撑住、不会瞎编打工程成熟度分。

### 10. Agent 死循环治理

必须能讲清楚：

- Agent 死循环通常来自目标不清、工具结果不可判定、planner 反复生成相同 action、observation 没有进入状态、模型无法判断终止。
- 不能只说“加最大轮数”，这只是兜底。
- 要同时做 step 上限、tool call 上限、token/耗时/费用预算、重复 action 检测、状态去重、timeout、fallback、human-in-the-loop。
- ReAct / LangGraph / FSM 都要有明确终止条件。

建议讲法：

```text
我会把 Agent 死循环当成状态机治理问题，而不是简单 prompt 问题。工程上先加硬预算：max steps、max tool calls、max retries、timeout、token/cost budget；再做软判断：如果连续多轮 action 和 observation 相同，或者状态没有新增信息，就提前终止并返回保守答案。复杂高风险任务可以进入 human-in-the-loop。所有循环路径要记录 trace，后续变成回归样本。
```

项目映射：

- `AGENTIC_MAX_RETRIES`：限制反思重试。
- `AGENTIC_MAX_AUGMENTED_QUERIES`：限制 query 扩展。
- `AGENTIC_MAX_RETRIEVAL_QUERIES`：限制检索查询数。
- `AGENTIC_MAX_RETRIEVED_CHUNKS`：限制上下文注入。
- `AGENTIC_MAX_WEB_SEARCH_RESULTS`：限制联网兜底。
- `AGENTIC_MAX_RERANK_TOP_N`：限制重排成本。
- `AGENTIC_MAX_AUTO_QUERY_LENGTH`：auto 模式超长问题回退 simple，避免把超大问题直接丢给 Agent。

### 11. Agent 调用外部工具的方式

必须能讲清楚：

- Function Calling / Tool Calling：模型输出结构化工具名和参数，由宿主执行。
- ReAct：模型按 Thought / Action / Observation 迭代，适合需要推理和多步工具调用的任务。
- MCP：把工具作为标准 server 暴露，Agent 通过 transport 发现和调用工具。
- LangChain Tool：在应用代码中把函数包装成模型可调用工具。
- HTTP API Tool：把外部 REST/RPC 能力包装成工具。
- Code Interpreter / Browser / File Tool：特殊工具，要有沙箱、权限和审计。

建议讲法：

```text
Agent 调工具不是让模型直接执行代码，而是模型选择工具和参数，宿主系统做 schema 校验、权限校验、超时、重试、幂等和审计。项目里既有 Bocha、Rerank、Speech 这类 API 工具，也有 MCP 这种标准化工具 server 接入。工具失败不能拖死主链路，要能降级或返回可解释错误。
```

容易踩坑：

- 不要说“Agent 自己调用接口”，应该说“模型提出工具调用，宿主执行”。
- 不要忽略参数校验和权限。
- 不要让工具调用无限重试。

### 12. Skill 与工具的关系

必须能讲清楚：

- Tool 是可执行能力，例如搜索、读文件、写数据库、调用 API。
- Skill 是可复用工作流，描述什么时候用、怎么用、用哪些工具、遵守什么步骤和边界。
- Skill 不等于 prompt，也不等于工具；它更像 Agent 的操作手册。
- Auto-coder Skill 通常包括：读项目规则、定位代码、制定方案、精准修改、运行验证、总结风险。

建议讲法：

```text
我会把 Tool 理解为能力，把 Skill 理解为经验封装。比如搜索工具只是能查资料，但“调试外部 API”这个 Skill 会规定先查官方文档或参考实现、逐字段比 headers/body、再一次性修复差异。Skill 的价值是把一次成功经验固化成可复用流程，让 Agent 不靠临场发挥。
```

项目映射：

- 项目里有 `skills/` 目录和 `SKILL.md` 加载能力。
- Skills 匹配支持本地 token 匹配和 Qwen Embedding 语义匹配。
- 无 key 或 embedding 失败时回退 token 匹配，不阻断系统。

### 13. 切片策略

必须能讲清楚：

- 切片不是只调 `chunkSize=1000`。
- 优先按文档结构切：标题、段落、列表、表格、代码块、条款。
- 保留 heading path、section id、clause id、table ref、source span。
- 父子 chunk 用于兼顾召回精度和上下文完整性。
- overlap 只解决边界信息丢失，不能替代结构化切分。
- PDF/表格/扫描件要特殊处理，不能和纯 Markdown 一样粗切。
- 版本号、生效期、来源权威要进入 metadata，否则制度类问答容易答旧版本。

建议讲法：

```text
我会先按结构切，再按 token 长度兜底。标题路径、条款编号、表格行列、source span、doc version、生效期这些 metadata 要跟 chunk 一起进索引。小 chunk 负责精准召回，parent chunk 负责补上下文。overlap 只解决跨边界丢信息，不能解决表格和制度条款的结构语义。
```

项目映射：

- `document_chunks` 保存父子 chunk、heading path、section/clause/table metadata。
- `sourceStart/sourceEnd` 支持回到原文定位。
- `docVersion/effectiveAt/expiredAt/sourceAuthority` 支持制度版本和来源权威治理。

### 14. 提高 RAG 召回准确率

必须能讲清楚：

- 数据侧：清洗、去重、结构化切片、metadata、版本治理。
- 查询侧：query normalize、同义词、缩写、错别字、query rewrite、query expansion。
- 检索侧：BM25/ES + 向量混合检索，按题型选择权重。
- 排序侧：Reranker、来源权威、时间有效性、用户权限过滤。
- 生成侧：低相关拒答、引用校验、claim 支撑校验。
- 评测侧：把失败样本沉淀成回归集。

建议讲法：

```text
提高召回准确率不是只换 embedding 模型。先把文档结构和 metadata 做对，再做 query normalize、同义词/缩写/错别字处理，然后用 BM25/ES 和向量混合召回，最后用 reranker、来源权威、生效期和权限过滤重排。每次失败都要进入评测集，否则优化只是拍脑袋。
```

### 15. Agent 与 Chatbot 的区别

必须能讲清楚：

- Chatbot 主要是对话界面和问答响应。
- Agent 是有目标、有状态、有工具、有规划、有执行、有反馈/反思的系统。
- Chatbot 可以没有工具，Agent 通常需要工具或环境交互。
- Agent 必须有终止条件、预算、权限和可观测。

建议讲法：

```text
Chatbot 更像一个对话入口，核心是生成回复；Agent 是能围绕目标规划步骤、调用工具、观察结果、更新状态并决定下一步的执行系统。企业里真正难的是让 Agent 可控：知道什么时候该停、能调用什么工具、失败怎么降级、过程怎么审计。
```

### 16. 为什么要加 Reranker

必须能讲清楚：

- 初召回追求 recall，宁愿多捞一些候选，会混入噪声。
- Reranker 追求 precision，把真正相关片段排到前面。
- 向量相似不等于业务相关，尤其是金额、版本、制度、否定条件。
- Reranker 可以降低无关 chunk 进入 prompt 的概率，节省上下文并减少幻觉。
- Reranker 也有成本，所以要限制 topN 和可配置开关。

建议讲法：

```text
召回阶段解决“有没有捞到”，Reranker 解决“谁应该排前面”。企业知识库里初召 topK 常常混入语义相似但事实不匹配的片段，比如旧版本制度或相似流程。Reranker 能把更符合 query 的 chunk 放到前面，减少 prompt 噪声，提高引用质量。但它不是免费午餐，所以项目里限制 rerank topN，并允许关闭。
```

### 17. 记忆方案选择

必须能讲清楚：

- 记忆不是一种东西，至少要分工作记忆、短期记忆、长期记忆、语义记忆、情节记忆。
- 工作记忆：当前 prompt/context，生命周期最短。
- 短期记忆：当前会话或最近几轮对话，适合 Redis / checkpointer。
- 长期记忆：跨会话用户偏好、稳定事实，适合 Mem0 / 数据库 / 向量库。
- 语义记忆：事实知识，例如“用户偏好 TypeScript”。
- 情节记忆：事件记录，例如“上次用户上传了某份制度文档并问过预算问题”。
- 记忆写入要有筛选，不是什么都存。
- 记忆读取要有权限、时效、置信度和可删除能力。

建议讲法：

```text
我不会把所有历史对话直接塞进上下文。当前轮用工作记忆；当前会话用 Redis Checkpointer 或 message history；跨会话稳定偏好和事实才进入长期记忆，例如 Mem0。写入前要判断是不是稳定事实，读取时要按用户、时间、相关性和置信度过滤。否则记忆会从增强能力变成污染源。
```

项目映射：

- Redis Checkpointer：保存 LangGraph 线程状态，支持恢复。
- ConversationEmbeddingService：把 QA 对向量化，用于相关历史检索。
- Mem0Provider / MemoryService：长期记忆 cloud/local/disabled 三种模式。
- 多租户隔离：记忆读取必须按 `userId` 过滤。

记忆方案选择：

| 场景 | 推荐方案 | 原因 |
|---|---|---|
| 当前一次推理里的中间状态 | LangGraph state / working memory | 生命周期短，直接参与当前决策 |
| 当前会话多轮追问 | Redis Checkpointer / message history | 快速恢复，适合线程级状态 |
| 跨会话用户偏好 | Mem0 / relational DB | 需要长期保存、可查询、可删除 |
| 历史问答相似召回 | 向量库 conversation chunks | 适合语义相关检索 |
| 审计和合规 | PostgreSQL event/log table | 需要可追踪、可回放、可治理 |

### 18. Context Engineering 与对话压缩

必须能讲清楚：

- 上下文不是越长越好，长上下文会带来噪声、成本和注意力稀释。
- 压缩不能只做摘要，要保留任务目标、约束、关键事实、未完成事项、用户偏好、引用来源。
- 压缩后最好带来源或可追溯标记，否则容易把旧 hallucination 固化成记忆。
- 多轮追问要做 threadId/sessionId 关联，而不是只靠最近 N 条。

建议讲法：

```text
跨会话压缩我会保留五类信息：用户目标、关键事实、约束边界、已完成/未完成状态、可追溯来源。不会简单把所有聊天记录总结成一段自然语言，因为摘要可能丢掉否定条件和版本信息。压缩结果进入长期记忆前还要过滤，避免把临时推测写成稳定事实。
```

### 19. LangChain 与 LangGraph 的区别

必须能讲清楚：

- LangChain 偏组件和链式编排：model、prompt、retriever、tool、chain。
- LangGraph 偏有状态图编排：节点、边、条件路由、循环、中断、恢复、checkpoint。
- 简单单向流程用 Chain 足够。
- 多步骤、可循环、可恢复、有人工审批的 Agent 更适合 Graph。

建议讲法：

```text
LangChain 更像组件库和链式流水线，适合 prompt -> retriever -> model 这种顺序流程。LangGraph 更像有状态工作流引擎，适合 Agent：有条件分支、循环、反思、工具调用、中断恢复和 checkpoint。我的项目里 simple RAG 更接近 chain，agentic RAG 用 LangGraph 表达状态机。
```

### 20. ReAct、Chain、Tool Use、FSM 怎么选

必须能讲清楚：

- Chain：固定步骤，确定性强，适合稳定主链路。
- Tool Use：单步或少量工具调用，适合明确 API 调用。
- ReAct：推理和行动交替，适合不确定步骤的探索任务。
- FSM / LangGraph：状态和边界明确，适合生产级 Agent 编排。

建议讲法：

```text
如果任务路径固定，我优先用 Chain；如果只是让模型选一个函数，我用 Tool Calling；如果问题需要边推理边查工具，可以用 ReAct；如果要上线到业务系统，我更倾向用 FSM/LangGraph 把状态、分支、重试、终止和人工审批显式建模。ReAct 灵活，但生产里不能只有 ReAct，没有边界就容易失控。
```

### 21. 多 Agent 框架设计

必须能讲清楚：

- 按能力拆：researcher、analyst、writer、critic、executor。
- 按领域拆：HR、Finance、Legal、IT、Sales。
- 按流程拆：planner、executor、reviewer、approver。
- 划分依据不是“名字好听”，而是工具权限、上下文需求、责任边界、输出格式不同。
- 多 Agent 会增加成本和不可控性，不是默认更高级。

建议讲法：

```text
我会按责任边界拆 Agent，而不是为了炫技。比如 researcher 负责检索，analyst 负责结构化分析，writer 负责组织答案，critic 负责校验引用和风险。不同 Agent 的工具权限和上下文不同。能用单 Agent 解决就不拆，多 Agent 的价值是隔离职责和权限，不是增加复杂度。
```

### 22. 可插拔 RAG 与工厂模式

必须能讲清楚：

- 可插拔不是热更新噱头，而是 provider 抽象。
- LLM、Embedding、VectorStore、Rerank、Speech、Search 都可以按接口切换实现。
- 工厂模式负责根据配置创建 provider。
- 一键切换要考虑 schema、维度、索引、数据迁移和兼容性，不能只切 env。

建议讲法：

```text
我会用 Provider 接口和工厂模式做可插拔。比如 LLMProvider、EmbeddingProvider、VectorStoreProvider，各实现只暴露统一方法。配置可以切换 provider，但真正上线不能只改一个 env，因为 embedding 维度、向量索引、metadata schema、重建索引都可能受影响。
```

### 23. 本地部署与配置管理

必须能讲清楚：

- 本地部署要看端口、服务依赖、数据卷、健康检查、启动顺序、资源限制。
- 配置管理至少分 `.env.example`、本地 `.env`、容器 env、生产 secret。
- 密钥不进代码、不进日志、不进 commit。
- 开发默认值不能阻塞核心链路。

建议讲法：

```text
本地部署我会用 Docker Compose 管 PostgreSQL、Redis、Milvus、Elasticsearch、Neo4j 等依赖，应用通过 env 读取配置。`.env.example` 只放模板，真实 `.env` 本地填写且不进 git。像 MCP、Bocha、Rerank 这种外部能力默认可以关闭或降级，不能因为缺 key 导致核心 RAG 启动失败。
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

### RAG 召回从哪些维度评测？

回答重点：

```text
我会分三层评测。第一层是 retrieval，看标准证据有没有进 topK，用 Recall@K、Hit Rate、MRR。第二层是排序，看 rerank 后目标证据是否更靠前，用 NDCG、MRR、Top1/Top3 命中。第三层是答案层，看 answer relevance、faithfulness、citation accuracy 和 claim support。企业场景还必须评拒答准确率和冲突处理，因为无答案题答得很流畅其实是事故。
```

### 碰到 Agent 死循环怎么处理？

回答重点：

```text
我会先把它当状态机失控处理。硬边界包括 max steps、max tool calls、max retries、timeout、token/cost budget；软边界包括检测重复 action-observation、状态没有新增信息就终止、工具连续失败就 fallback。高风险任务进入 human-in-the-loop。死循环路径要记录 trace，并沉淀成回归用例。
```

### Agent 调用外部工具有哪些方式？

回答重点：

```text
常见有 Function/Tool Calling、ReAct、MCP、LangChain Tool、HTTP API Tool、代码解释器、浏览器和文件工具。关键不是“能调”，而是宿主系统要做 schema 校验、权限控制、超时、重试、幂等、审计和降级。模型只负责提出工具调用意图和参数，真正执行必须由受控 runtime 完成。
```

### Skill 怎么调用工具？

回答重点：

```text
Skill 本身不是工具，它是可复用工作流。Tool 是具体能力，比如搜索、读文件、调用 API；Skill 规定什么时候用这些工具、按什么顺序用、遵守什么边界、如何验证结果。比如 Auto-coder Skill 会要求先读项目规则，再定位代码、修改、运行验证、总结风险。Skill 的价值是把经验固化，减少 Agent 临场乱发挥。
```

### 怎么做切片？

回答重点：

```text
我不会只按固定 token 数粗切。优先按文档结构切：标题、段落、条款、列表、表格、代码块；再用 token 长度兜底。每个 chunk 要带 heading path、section id、source span、doc version、生效期和来源权威。小 chunk 用于精准召回，parent chunk 用于补上下文。overlap 只能缓解边界丢失，不能替代结构化切片。
```

### 怎么提高 RAG 召回准确率？

回答重点：

```text
从数据、查询、检索、排序、生成、评测六层做。数据侧做清洗、结构化切片和 metadata；查询侧做 query normalize、同义词、缩写、错别字和 query expansion；检索侧做 BM25/ES + vector hybrid；排序侧做 reranker、来源权威、生效期和权限过滤；生成侧做低相关拒答和引用校验；最后把失败样本沉淀成回归集。
```

### 什么是 Agent，和 Chatbot 有什么区别？

回答重点：

```text
Chatbot 主要是对话入口，核心是根据上下文生成回复。Agent 是围绕目标工作的执行系统，它有状态、有规划、有工具、有观察结果、有下一步决策和终止条件。企业里 Agent 的关键不是“更聪明”，而是可控：知道能调用什么工具、什么时候停止、失败怎么降级、过程怎么审计。
```

### 为什么要加 Reranker 重排？

回答重点：

```text
初召回追求 recall，会把相似但不一定正确的 chunk 一起捞上来；reranker 追求 precision，把真正和 query 匹配的证据排到前面。企业知识库里金额、版本、生效期、否定条件很容易被向量相似误导，reranker 可以减少无关上下文进入 prompt，提高引用质量。但 rerank 有成本，所以要限制 topN，并做开关。
```

### 记忆模块的数据存在什么介质上？

回答重点：

```text
要按记忆类型选介质。当前推理状态放 LangGraph state；当前会话状态放 Redis Checkpointer 或 message history；跨会话稳定事实和偏好放 Mem0 或关系库；历史问答相似召回可以放向量库 conversation chunks；审计记录放 PostgreSQL。不能把所有聊天记录无脑塞进 prompt，也不能把临时推测写成长久记忆。
```

### 如何跨会话压缩对话并保留关键信息？

回答重点：

```text
压缩不是简单摘要。我会保留用户目标、关键事实、约束边界、已完成/未完成状态、用户偏好和来源。压缩结果要能追溯来源，最好带时间和置信度。进入长期记忆前还要过滤，只保存稳定事实，不保存临时猜测。否则压缩会把一次 hallucination 固化成长期污染。
```

### 为什么选择 ReAct，而不是纯 Chain 或 Tool Use？

回答重点：

```text
固定流程优先 Chain，明确单步 API 调用用 Tool Calling；如果任务路径不确定，需要边推理边调用工具，可以用 ReAct。但生产级不能只有 ReAct，我更倾向用 LangGraph/FSM 把 ReAct 放进有状态、有预算、有终止条件的框架里。灵活性要被工程边界约束住。
```

### 多 Agent 框架怎么设计？

回答重点：

```text
多 Agent 不是按名字堆角色，而是按责任边界、工具权限、上下文需求和输出格式拆。可以按能力拆 researcher、analyst、writer、critic，也可以按领域拆 HR、Finance、Legal。能用单 Agent 解决就不拆，多 Agent 的价值是隔离职责和权限，不是增加热闹。
```

### 可插拔 RAG 一键配置切换是不是热更新？

回答重点：

```text
我不会把它简单说成热更新。可插拔的核心是 Provider 抽象和工厂模式，比如 LLMProvider、EmbeddingProvider、VectorStoreProvider。配置可以切换实现，但向量维度、索引类型、metadata schema 和历史数据兼容都要考虑。真正线上切换需要灰度、重建索引和回滚方案。
```

### 本地部署要考虑什么？配置管理放在哪里？

回答重点：

```text
本地部署先看依赖服务、端口、数据卷、健康检查、启动顺序和资源限制。配置上 `.env.example` 只放模板，真实 `.env` 本地填写且不进 git；容器和生产用环境变量或 secret 注入。外部能力缺 key 时应该降级或跳过 smoke，不能阻塞核心 RAG 启动。
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

## 最新面试 7 问回答口径

> 场景：面试官连续追问 RAG 实现、向量/ES/图谱、多 Agent、工具调用、项目问题、情感分析、AI Coding 使用方式。回答原则是讲真实闭环，不把没做的模块硬说成做了。

### 1. 项目怎么做 RAG

可以这样答：

```text
这个项目是企业知识库 RAG，不是简单的“向量召回 + LLM 总结”。完整链路是文档上传、解析、结构化切片、Embedding、Milvus 向量索引、BM25/ES 关键词索引、查询归一化、混合检索、Rerank、生成回答、引用校验和低相关拒答。

我重点处理的是企业知识库里的可信问题：中文召回、引用支撑、低相关拒答、空库兜底、版本冲突、GraphRAG 关系检索和后台运营可观测。
```

更短版本：

```text
我们做的是 hybrid retrieval RAG。向量负责语义召回，BM25/ES 负责关键词和精确匹配，GraphRAG 负责关系型问题，最后通过 rerank、引用校验和拒答策略保证答案可信。
```

### 2. 向量、ES、图谱实现流程

向量流程：

- 文档解析后按标题、章节、条款、表格 metadata 做 chunk。
- chunk 调 embedding provider 生成向量。
- 向量写入 Milvus，并带上 `userId/docId/chunkId` 等隔离和溯源字段。
- 查询时 query 生成 embedding，Milvus 做相似度召回。
- 如果 embedding 或 Milvus 不可用，系统降级 BM25/ES，不返回假向量。

ES / BM25 流程：

- 同一份 chunk 同步进入关键词索引。
- 中文场景做 query normalize，包括错别字、同义表达、大小写和中英文混合。
- BM25/ES 解决向量检索不擅长的制度编号、产品名、金额、专有名词和精确条款问题。
- 最后把向量召回和关键词召回融合，再交给 reranker。

图谱流程：

- 文档入库时抽取实体、别名、关系和置信度。
- 数据写入 Neo4j，支持 schema、entities、relationships、search 等运营接口。
- 查询涉及“依赖、调用、支持、属于、影响、上下游”时触发 GraphRAG。
- 图谱结果主要作为检索线索，最终答案仍然要回到 chunk 引用上做支撑。

可以补一句：

```text
GraphRAG 不是让模型看一堆关系就直接回答，而是把实体关系变成可解释的检索线索，最后答案仍然要落回文档证据。
```

### 3. 多 Agent 怎么协调

不要说“多个 Agent 自己协作”。建议说：

```text
我这里的多 Agent 更准确地说是 LangGraph/状态机式编排，不是自由聊天式多 Agent。核心节点包括 routing、query augment、retrieval、sufficiency、web search、graph search、rerank、generate、citation、reflection 和 final。

每个节点只负责一个明确决策，通过共享 state 传递 query、候选文档、引用、置信度、路由结果和错误原因。这样好处是可观测、可回放、可限流，也方便给每个节点设置超时、重试和成本预算。
```

节点职责：

- `routing`：判断走 simple、auto 还是 agentic。
- `query_augment`：扩展查询、改写 query。
- `retrieval`：查向量、BM25/ES、Graph。
- `sufficiency`：判断证据是否足够。
- `web_search/graph_search`：知识库不足或关系型问题时增强。
- `rerank`：重排候选片段。
- `generate`：生成答案。
- `citation/reflection`：检查引用是否存在、关键 claim 是否被证据支撑。
- `final`：输出答案、引用和 trace。

### 4. 工具怎么调用

可以这样答：

```text
工具调用不是让模型直接执行代码，而是模型选择工具名和参数，宿主系统做 schema 校验、权限校验、超时、重试、幂等和审计后再执行。项目里有 vector search、BM25/ES search、graph search、rerank、citation check、Bocha Web Search、DashScope Rerank、ASR/TTS、MCP server 等工具。
```

触发方式：

- 普通问题默认走 hybrid retrieval，不额外调用复杂工具。
- 检索不足时才考虑 Web Search。
- 有明显实体关系时才考虑 Graph Search。
- 工具失败不能拖死主链路，要降级或返回明确错误。
- 所有工具调用都要进入 trace，方便定位一次回答慢在哪里、失败在哪里。

容易踩坑：

- 不要说“Agent 自己调用接口”，要说“模型提出工具调用，宿主执行”。
- 不要忽略参数校验和权限。
- 不要让工具无限重试。

### 5. 项目里实现 RAG 遇到什么问题

可以挑 4-5 个具体讲：

```text
第一个问题是中文召回不稳定。只靠向量时，制度编号、产品名、金额、专有名词容易漏，所以我做了 BM25/ES 混合召回、query normalize 和中文错别字修正。

第二个问题是召回片段语义相似，但不能支撑最终答案。解决方式是生成后做 citation 和 reflection，关键 claim 必须能被引用片段支撑。

第三个问题是空库或低相关时模型容易胡说。我的处理是低分拒答、检索不足标记，必要时模型兜底但不伪造引用。

第四个问题是 GraphRAG 的真实数据和可用态。Neo4j 不可用、图谱为空、接口错误、演示数据都必须区分，后台不能静默 mock。

第五个问题是 SSE/AG-UI 流式链路。真实 SSE 有多行 frame、代理超时、token 传递和断流问题，所以我改成 fetch stream 解析，并让 admin-backend 对 SSE 跳过普通 API 的 5 秒熔断。
```

总结句：

```text
RAG 最难的不是接 LLM，而是让检索证据、生成答案、引用、拒答和可观测形成闭环。
```

### 6. 项目里情感分析怎么实现，准确率是多少

这里不要硬编。项目当前没有独立通用情感分析模块，推荐这样答：

```text
这个项目没有单独做通用情感分析，因为业务重点是企业知识库问答，不是舆情或客服情绪识别。我们做的是 QA 运营质量分析：记录用户反馈、低置信度、无引用、引用失败、召回不足、拒答等信号，用这些指标判断回答质量问题。

所以这里没有“情感分析准确率”这个指标。我更关注的是引用支撑率、拒答准确性、召回命中率、无结果率、负反馈率和评测集通过率。
```

如果面试官追问“如果要加怎么做”，可以说：

```text
如果要加情感分析，我会先定义标签体系，比如正向、负向、中性、投诉、困惑、催促，再标注一批真实客服或问答数据。第一版可以用大模型分类加规则兜底，后续用标注集评估 precision、recall、F1，而不是只报 accuracy。因为情感数据类别通常不均衡，accuracy 容易虚高。
```

### 7. 用 AI Coding 怎么用，遇到什么问题

可以这样答：

```text
我把 AI Coding 当成高级协作工具，不是自动驾驶。我的流程是先写 CLAUDE/ROADMAP 规则，明确架构边界、红线、验证命令，再让 AI 按文档小步实现。每次改完必须跑 lint、build、test、接口联调，然后同步 ROADMAP。

AI 主要帮我做重复性代码、接口适配、测试补齐、文档同步和日志排查。但关键决策，比如服务边界、是否使用 mock、是否改 schema、是否部署生产、是否碰 env，我自己把控。
```

遇到的问题：

- AI 容易过度实现，写出需求之外的抽象。
- AI 容易静默 mock，让页面“看起来能跑”。
- AI 容易忽略项目真实约束，比如 Node 版本、已有 dev server、数据库迁移红线。
- AI 容易猜测外部 SDK/API 行为。
- 大项目上下文长，容易忘记 ROADMAP 的真实状态。

解决方式：

```text
我用项目级 CLAUDE.md 约束它，要求先读规则、按 ROADMAP 推进、禁止碰 env/schema/部署，所有完成项必须验证后才能写进已完成。对外部 API 问题要求先看官方文档或参考实现，不允许靠猜。
```

最后可以用这句话收束：

```text
我主要负责把 RAG 从 demo 做成可运营系统：包括文档入库、混合检索、GraphRAG、Agentic workflow、AG-UI 流式问答、后台运营、质量评测和工程验证。重点不是堆模型能力，而是把召回、生成、引用、拒答、观测和后台治理做成闭环。
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
