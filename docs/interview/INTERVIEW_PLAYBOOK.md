# RAG 项目简历与面试讲解手册

> 目标：把本项目讲成高级 Agent 工程师、高级 AI 应用开发工程师、高级前端开发工程师、前端负责人都能成立的代表项目。不要背功能清单，要讲清楚问题、取舍、架构、验证和边界。

> 简历可复制版本见 `docs/interview/resume/resume-rag-project.md`；JD 对照见 `docs/interview/jd/jd-requirements-project-mapping.md`；缺口状态见 `docs/interview/jd/jd-gap-implementation-status.md`；资深架构／Staff 岗位判断和真实数据补法见 `docs/interview/SENIOR_AGENT_INTERVIEW_READINESS.md`。

## 这份文件怎么用

不要从头背到尾，按场景看：

| 场景 | 看哪里 |
|---|---|
| 面试前 10 分钟 | 只看“面试先看：核心问题清晰回答版” |
| 面试前 30 分钟 | 先看“核心问题清晰回答版”，再看“最新面试 7 问回答口径” |
| 面试官连续深挖 RAG / Agent | 看“你必须真正弄懂的东西” |
| 面试官问大厂 / 金融 / 前端负责人视角 | 看“公开 JD 对照补强”和“还应该准备的追问” |
| 面试官问项目真实性和边界 | 看“面试时最好主动承认的边界” |

核心原则：

```text
前半部分用来回答，后半部分用来追问补充。不要把整份文档当背诵稿。
```

## 一句话定位

这是一个企业级统一 Hybrid RAG（混合检索增强生成）与 Agentic RAG（智能体式检索增强生成）知识库系统，核心不是“接了一个大模型接口”，而是围绕 **查得准、答得稳、引用能撑住、不会瞎编** 做完整工程闭环：文档解析、精确直答、混合检索、Agentic 编排、GraphRAG（图检索增强生成）、MCP（模型上下文协议）、语音、多租户隔离、观测、评测门禁和 Docker Compose（容器编排）部署。

简历上可以写：

```text
主导设计并实现企业级 Agentic RAG 知识库系统，基于 NestJS + React + LangGraph.js + Milvus + Elasticsearch + PostgreSQL + Redis + Neo4j，完成文档解析、混合检索、引用校验、Agentic 工作流、GraphRAG、MCP 工具调用、多租户隔离、Prometheus 指标和自动化评测门禁；本地工程成熟度门禁 93/100，项目级仿真实业务评测 28/28 通过。
```

不要写成：

```text
使用大模型实现了一个知识库问答系统。
```

这个说法太薄，像调 API 的。

## 面试先看：核心问题清晰回答版

这一节是面试现场优先背的版本。每个问题都按「一句话结论 -> 项目做法 -> 追问边界」组织，不要先讲一堆名词。

### 0. 被问「有哪些方案，怎么选」时的万能答法

一句话：

```text
我不会先报一个技术名词，而是先看业务目标、数据形态、准确率指标、延迟成本、权限安全和可观测性，再比较候选方案，最后用评测集证明选择是否有效。
```

现场可以按这 6 步说：

| 步骤   | 你要表达什么       | 例子                                   |
| ---- | ------------ | ------------------------------------ |
| 背景   | 这个问题服务什么业务目标 | 企业知识问答要准确、可引用、可拒答                    |
| 候选方案 | 至少说出 3 类方案   | 切片有固定长度、结构切分、Parent-child、语义切分       |
| 优缺点  | 不要只说好处       | 固定长度简单但容易切断语义，结构切分复杂但适合制度文档          |
| 选择依据 | 用指标和约束做判断    | 看 Recall@K、MRR、引用准确率、P95 延迟、token 成本 |
| 项目落地 | 说自己项目怎么做     | 当前用 Markdown 结构感知 + 递归兜底 + metadata  |
| 边界   | 不把没做的包装成已做   | 语义切分、多模态视觉向量是可优化方向，不说已完整生产化          |

AI 应用开发 / 大模型应用开发必会的横向方案：

| 方向 | 面试必须知道的方案 | 项目里怎么讲 |
|---|---|---|
| 文档解析 | 纯文本抽取、OCR/版面 Pipeline、文档模型、多模态大模型 | 当前先做文本和结构解析，复杂扫描件用 OCR/视觉能力扩展 |
| 切片策略 | 固定长度、递归字符、结构化、Parent-child、语义、多模态切分 | 当前是 Markdown 结构感知 + `500/50` 递归兜底，重点是 metadata |
| Embedding | 通用、中文/领域、多语种、自训练 | 用业务评测集看 Recall@K / MRR / 成本，不凭榜单盲选 |
| 检索 | 向量、BM25/ES、Hybrid、GraphRAG | Milvus 语义，BM25/ES 精确词，RRF 融合，图谱补关系 |
| Rerank | Cross-encoder、LLM rerank、规则权重、来源权威 | topK 多召回，topN rerank，失败可降级 |
| 上下文工程 | topK 直塞、parent 扩展、MMR、压缩摘要、证据排序 | 不盲塞长上下文，优先让高质量证据排前并能引用 |
| 幻觉控制 | 拒答、引用校验、claim support、reflection | 证据不足不确定回答，生成后检查引用和关键结论 |
| RAG 评测 | Recall@K、MRR、NDCG、Faithfulness、Citation Accuracy | 拆成检索、排序、生成、拒答、权限、成本延迟来评 |
| 数据更新 | 全量重建、增量索引、hash、版本、生效期、tombstone | 用 content hash、docVersion、effectiveAt、索引清理保证一致性 |
| 权限 | 应用层过滤、检索层过滤、索引隔离、ABAC/RBAC | 召回阶段就带 userId / metadata，不能生成后才过滤 |
| Memory | 短期窗口、摘要、长期向量记忆、图记忆、时间衰减 | 会话、短期记忆、长期记忆、业务知识分层，不全塞 prompt |
| Agent | Chain、Workflow、ReAct、Plan-and-Execute、LangGraph、多 Agent | simple/auto/agentic 分层，生产更偏可控状态机 |
| Tool / MCP | Function Calling、HTTP Tool、MCP、浏览器/代码工具 | 模型提调用意图，宿主做 schema、权限、超时、审计 |
| 模型路由 | 单模型、多供应商、大小模型、fallback、成本路由 | Qwen / DeepSeek 可配置切换，默认模型和 token 要统一治理 |
| 微调取舍 | Prompt、RAG、SFT/LoRA、RLHF/DPO | 企业知识优先 RAG，格式/风格稳定后才考虑微调 |
| 推理性能 | Streaming、KV Cache、batching、量化、vLLM | 项目用 Provider API + SSE，懂原理但不硬说自建推理平台 |
| 可观测 | trace、step event、metrics、query log、回放 | 能定位慢在检索、rerank、工具还是生成 |
| 安全 | Prompt injection、tool allowlist、secret 脱敏、人工确认 | 工具输出当不可信数据，高风险动作必须确认 |
| 多模态 | OCR、ASR、图片 caption、表格解析、视频抽帧、视觉向量 | 当前有脚手架和 sidecar，真实视觉向量闭环是后续方向 |
| 成本延迟 | fast path、缓存、topK/topN 预算、并行、降级 | 简单问题走 fast path，复杂问题才进 agentic |

### 1. 你的 RAG 项目到底是做什么的？

一句话：

```text
这是一个面向企业知识库和游戏活动 / 官网业务经验沉淀的 Agentic RAG 系统，目标不是替业务拍板，而是把分散资料变成可检索、可引用、可评测、可给 AI Coding 使用的知识协同平台。
```

项目做法：

```text
资料进来后会做解析、结构化切片、Embedding、多路索引和 metadata 治理；查询时按问题复杂度走 simple / auto / agentic，简单问题快速检索，复杂需求用 LangGraph 拆成方案、接口、埋点、风险和验收 checklist。后台负责知识治理、问答运营、图谱管理、权限审计和评测回归。
```

边界：

```text
我不会把它说成已经在大规模生产长期验证过。当前更准确是从 0 到 1 的企业级原型和试点建设，工程链路完整，真实业务效果还要随真实题库、真实活动数据和生产环境继续验证。
```

### 2. 项目怎么做 RAG？

一句话：

```text
不是纯向量问答，而是文档解析、结构化切片、Milvus 向量召回、BM25/ES 精确召回、RRF 融合、Rerank、引用校验和低相关拒答的一整条链路。
```

项目做法：

```text
写入侧先把 PDF、DOCX、Markdown、URL、Obsidian 笔记等资料解析成 chunk，每个 chunk 带 docId、chunkId、userId、标题路径、来源、版本、权限等 metadata；再分别写入数据库、Milvus、BM25/ES 和 Obsidian/Karpathy 编译层。

查询侧先做 query normalize，再走向量召回和关键词召回，融合后 rerank，最后把证据交给 LLM 生成。生成后还要检查引用编号和关键 claim 是否能被证据支撑；证据不足就拒答或提示人工确认。
```

追问边界：

```text
RAG 的核心不是“模型会总结”，而是证据链能不能撑住回答。没有来源的活动规则、奖励比例、地区口径，不能让模型编成确定结论。
```

### 3. simple / auto / agentic 怎么分？

一句话：

```text
simple 解决低延迟简单问答，auto 先快后慢，agentic 只处理复杂需求。
```

项目做法：

```text
simple 先走 Direct Answer Gate（精确直答门禁），未命中后执行完整 Hybrid RAG（混合检索增强生成），适合查规范、查组件、查活动模板这类明确问题。

auto 先走 simple，如果 sufficiency gate 判断证据不足，再升级到复杂检索或 Agentic。

agentic 适合复杂活动方案，通过 LangGraph 做 routing、query augment、retrieval、sufficiency、graph/web search、rerank、generate、citation、reflection，最后输出结构化方案。
```

追问边界：

```text
不是所有问题都走 Agent。Agentic 会增加成本、延迟和不确定性，所以普通问题走稳定链路，复杂问题才升级。
```

### 4. 向量、ES、图谱分别解决什么？

一句话：

```text
向量解决语义相似，ES/BM25 解决精确词，GraphRAG 解决关系补全。
```

项目做法：

```text
Milvus 适合找语义相似的活动模板、规范片段和历史经验。
BM25/ES 适合查制度编号、组件名、接口名、埋点名、金额、版本、地区服这些精确词。
Neo4j / GraphRAG 用来建模活动类型、玩法、页面模块、接口、埋点、地区版本和风险项之间的关系，避免方案漏项。
```

追问边界：

```text
GraphRAG 不是替代向量检索，也不是用了图谱就一定更准。它适合关系型问题，最终答案仍然要回到文档 chunk 和引用证据上。
```

### 5. 为什么不用纯向量检索？

一句话：

```text
纯向量容易找“意思像”的内容，但企业知识库经常需要“事实准”的内容。
```

项目做法：

```text
比如制度编号、接口名、埋点字段、版本号、金额、地区口径、否定条件，向量相似不一定可靠。BM25/ES 能保证精确命中，向量能补语义泛化，RRF 和 Rerank 再把多路结果重新排序。
```

追问边界：

```text
我不会说向量比关键词高级。企业 RAG 里关键词检索非常重要，尤其是中文、缩写、专有名词和版本信息。
```

### 6. 召回不准怎么优化？

一句话：

```text
召回优化要分数据、查询、检索、排序、生成、评测六层，不是只换 embedding 模型。
```

项目做法：

```text
数据侧做清洗、去重、结构化切片、metadata 和版本治理。
查询侧做 normalize、同义词、缩写、错别字、query rewrite / expansion。
检索侧做 Milvus + BM25/ES 混合召回。
排序侧做 Rerank、来源权威、生效期和权限过滤。
生成侧做引用校验和低相关拒答。
评测侧把失败样本沉淀成回归集。
```

追问边界：

```text
不要只看最终答案，要拆 retrieval、rerank、generation 三段看；否则不知道问题到底出在没召回、排错了，还是生成乱编。
```

### 7. Rerank 为什么要加？

一句话：

```text
初召回解决“有没有捞到”，Rerank 解决“谁该排前面”。
```

项目做法：

```text
向量和 BM25 初召回会混入很多相似但不够准确的片段，比如旧版本制度、相似活动模板、同名字段说明。Rerank 放在召回之后、生成之前，把真正匹配 query 的证据排到前面，减少无关上下文进入 prompt，也减少幻觉。
```

追问边界：

```text
Rerank 有成本，所以不能无限重排。项目里会限制 rerank topN，失败时回退融合排序结果。
```

### 8. 记忆和缓存怎么做？

一句话：

```text
记忆按生命周期分层，缓存按链路热点分层，不能把所有历史都塞进 prompt。
```

项目做法：

```text
短期记忆放 Redis，按会话保留最近对话并做摘要压缩；长期记忆走 Mem0，用来保存跨会话稳定偏好和事实；Obsidian/Karpathy 更像 artifact memory，用来沉淀可复用知识产物。

缓存上，简单问题优先复用受治理直答与统一 Hybrid RAG 的检索结果；摘要、会话状态、Provider（能力提供方）状态都可以按 TTL（生存时间）和 userId（用户标识）缓存。权限变化、文档删除、版本更新时要让相关缓存和索引失效。
```

追问边界：

```text
记忆写入要筛选，不能把临时推测、错误答案、未确认规则写成长久记忆。缓存也不能绕过权限过滤。
```

### 9. Token 怎么节省？

一句话：

```text
Token 节省靠路由、检索裁剪、摘要压缩和结构化上下文，不是简单砍 max_tokens。
```

项目做法：

```text
简单问题走 fast path，不进入 Agentic；复杂问题限制 query expansion 数量、topK、rerank topN、web search 结果数和最大 chunk 数；多轮对话用摘要压缩保留目标、关键事实、约束、未完成事项和来源；进入 prompt 的证据要去重、分组、裁剪，并保留引用编号。
```

追问边界：

```text
上下文不是越多越好。塞太多会增加成本、降低首字速度，还会引入噪声，让模型注意力分散。
```

### 10. 怎么控制幻觉和错误回答？

一句话：

```text
不能保证模型永远不胡说，但可以通过证据、闸门、拒答和评测让错误概率降低，并且可发现。
```

项目做法：

```text
生成前做检索充分性判断和 Rerank；生成时要求引用证据；生成后做 citation gate 和 claim support；低相关、无权限、证据冲突、疑似 Prompt Injection 时拒答或提示人工确认；失败样本进入评测集回归。
```

追问边界：

```text
不要说“完全消除幻觉”。正确说法是：通过工程边界控制幻觉，并让没有证据的问题不要输出确定结论。
```

### 11. 多 Agent 怎么协调？

一句话：

```text
不是几个 Agent 自由聊天，而是 Supervisor + LangGraph 状态机式编排。
```

项目做法：

```text
Supervisor 根据领域和复杂度选择 researcher、analyst、writer、critic、editor 的子集。
researcher 负责查资料，analyst 负责拆结构和风险，writer 负责生成方案，critic 负责检查证据、风险和遗漏，editor 负责整理最终输出。
它们通过共享 state 传递 query、候选证据、图谱关系、引用、风险和错误原因。
```

追问边界：

```text
多 Agent 不是默认更高级。能用单链路解决的问题不拆，多 Agent 的价值是责任隔离、工具权限隔离和复杂任务分阶段检查。
```

### 12. 工具怎么调用？

一句话：

```text
模型只提出工具调用意图和参数，真正执行由宿主系统完成。
```

项目做法：

```text
工具包括 RAG search/context、Graph query、Rerank、Web Search、ASR/TTS、MCP、游戏活动方案生成等。每个工具都要有输入 schema、输出 schema、权限校验、超时、重试、幂等、审计和降级策略。工具失败不能拖死主链路，例如 Rerank 失败回退融合排序，Web Search 没 key 就跳过，Milvus 超时回退 BM25/ES。
```

追问边界：

```text
不要说“Agent 自己调接口”。要说模型选择工具，宿主系统受控执行。
```

### 13. MCP 和 CLI 分别干什么？

一句话：

```text
CLI 给人和脚本用，MCP 给 Agent 自动调用。
```

项目做法：

```text
CLI 适合批量导入、批量评测、手动 search/context/ask、CI 或脚本任务。
MCP 适合 Codex、Claude Code、Trae 在写代码前自动查内部组件、活动模板、埋点规范、地区适配和业务规则。
例如 Agent 要写一个活动页，可以先调用 rag_search 查规则，再调用 rag_game_plan 生成技术方案，然后再编码。
```

追问边界：

```text
MCP 不是替代后台，也不是替代 CLI。它是 Agent 工具协议，重点是标准化工具发现、参数 schema 和受控调用。
```

### 14. 评测怎么做？

一句话：

```text
RAG 评测要拆召回、排序、生成、拒答和业务专项，不只看 accuracy。
```

项目做法：

```text
召回层看 Recall@K、Hit Rate、MRR；排序层看 NDCG、Top1/Top3 命中；生成层看 Answer Relevance、Faithfulness、Citation Accuracy、Claim Support；拒答题看 False Positive / False Negative。

业务专项上，游戏活动 / 官网营销看玩法识别、页面模块覆盖、接口清单、埋点覆盖、风险项召回、地区适配和拒答正确率。项目里有本地工程成熟度、项目级仿真实业务评测和专项评测集，但真实业务分要等真实题库验证。
```

追问边界：

```text
28/28 和 93/100 是本地工程和仿真评测结果，不等于生产 SLA，也不等于真实业务准确率。
```

### 15. 权限和数据隔离怎么做？

一句话：

```text
权限不能靠 prompt，必须在索引、检索、引用和缓存层都做隔离。
```

项目做法：

```text
文档入库时带 userId、docId、权限主体、部门、角色、来源和可见范围；检索时 PostgreSQL、Milvus metadata、BM25/ES 查询和后置过滤都要带权限条件；答案引用只能来自当前用户可见片段。文档删除、权限变更、版本过期时，要同步清理或失效数据库、向量、ES/BM25、图谱和缓存。
```

追问边界：

```text
如果向量库过滤能力不足，也要召回后用 active docId 和权限表做二次过滤，不能把权限交给模型自己判断。
```

### 16. 项目里遇到哪些问题？

一句话：

```text
主要问题集中在中文召回、引用支撑、低相关拒答、流式输出、索引一致性、延迟和真实数据不足。
```

项目做法：

```text
中文召回用 Hybrid Search、query normalize 和 Rerank 优化。
引用支撑用 citation gate、claim support 和低相关拒答控制。
流式输出用 AG-UI/SSE，让 RUN_STARTED 和 TEXT_MESSAGE_START 提前发，避免用户一直等。
索引一致性用 content_hash、rag_doc_id、userId 和补偿写入处理。
真实数据不足时只说仿真评测和试点建设，不硬报真实业务准确率。
```

追问边界：

```text
最难的不是调 LLM，而是让检索证据、生成答案、引用、拒答、观测和评测形成闭环。
```

### 17. 情感分析怎么做，准确率多少？

一句话：

```text
这个项目没有单独做通用情感分析，不能硬报准确率。
```

项目做法：

```text
当前做的是 QA 运营质量分析，比如低置信度、无引用、引用失败、召回不足、拒答、负反馈、无结果率等信号，用来判断问答质量问题。
```

如果要扩展：

```text
如果业务需要情感分析，我会先定义标签体系，比如正向、负向、中性、投诉、困惑、催促，再标注真实客服或问答数据。第一版可以用大模型分类加规则兜底，评估 precision、recall、F1，而不是只看 accuracy，因为情绪类别通常不均衡。
```

### 18. 你怎么用 AI Coding？

一句话：

```text
我把 AI Coding 当协作工具，不当自动驾驶。
```

项目做法：

```text
先写 CLAUDE.md、ROADMAP.md 和模块边界，让 AI 明确红线、验证命令和当前进度；编码前先检索项目上下文，复杂需求先产出计划；实现后跑 lint、build、接口 smoke 或评测脚本；完成后同步 ROADMAP。

为了避免手动复制资料，我通过 MCP 把 RAG 能力接给 Codex / Claude Code / Trae，让 Agent 写代码前能自动查内部组件、活动模板和业务规范。
```

追问边界：

```text
AI 容易过度实现、静默 mock、猜外部 API、忘记项目真实状态，所以必须用规则、验证、ROADMAP 和 MCP 上下文约束它。
```

### 19. 这个项目和你前端经历有什么关系？

一句话：

```text
它不是泛泛知识库，而是把游戏活动、官网、前置页、活动页、小程序/H5 的业务经验串起来，服务产品、UI、测试、前端和业务负责人。
```

项目做法：

```text
稳定沉淀的是活动类型、玩法模式、页面模块、接口模式、埋点规范、地区适配、上线检查和复盘经验；每次变化的奖励数值、概率、预算不作为长期固定答案，而是标记待产品/运营确认。
```

追问边界：

```text
RAG 负责快速理解业务和生成技术方案初稿，不替代业务负责人最终决策。
```

### 20. 如果上线到一线大厂，还差什么？

一句话：

```text
工程主链路已经具备企业级原型基础，但生产级还差真实数据、真实权限、真实压测、安全合规和运维体系。
```

项目做法：

```text
当前可以说已完成本地工程闭环、Admin 运营、MCP、评测脚手架和模拟数据包。不能说已经满足金融/大厂生产要求。真正上线需要接入真实私有题库、组织权限系统、真实 GraphRAG 数据源、真实多模态样本、生产 Milvus/ES 压测、SLA、灰度、备份、监控、审计、DLP 和密钥治理。
```

追问边界：

```text
这个回答要主动讲，反而更可信。大厂面试看重你知道边界，不是把本地 demo 包装成生产系统。
```

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
我做了两层评测：一层是内置业务回归集，覆盖 claim、citation、refusal、conflict；另一层是项目级仿真实业务评测，会真实启动后端，上传模拟业务文档，分别用 simple 和 auto 提问，再评分并清理。现在本地工程成熟度是 93/100，项目级仿真实业务评测 28/28 通过。但我不会把它吹成生产业务 90 分，因为还缺公司真实私有题库和真实标准答案。
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
- `AGENTIC_MAX_AUTO_QUERY_LENGTH`：仅保留配置兼容，不再单独决定 auto 路由；长问题通过子问题数、上下文、Token（令牌）、时间和成本预算约束，证据不足或复杂时仍可升级 Agentic。

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

面试官真正想听的不是参数，而是你怎么在「召回精度、上下文完整性、成本、可追溯」之间做取舍。

建议讲法：

```text
我不会一上来就说 chunkSize 设多少，而是先看文档类型和业务问题。制度、合同、活动方案这类文档，最重要的是不要把标题、条款、表格和版本信息切散，所以我会先按结构切，再按长度兜底。小 chunk 用来精准召回，parent chunk 或同章节上下文用来补完整语义；overlap 只解决跨边界丢信息，不能替代结构化切分。每个 chunk 还要带 heading path、clause id、table ref、source span、doc version、生效期、来源权威和权限信息，保证回答能回到原文、版本和用户权限。
```

如果被追问「有哪些切法」，按这个顺序讲：

| 方案 | 适合场景 | 优点 | 缺点 | 面试取舍 |
|------|----------|------|------|----------|
| 固定长度切分 | 简单纯文本、快速原型 | 实现简单、吞吐稳定 | 容易切断标题、条款、表格 | 只能做 baseline，不适合企业制度主链路 |
| 递归字符切分 | 通用文本、Markdown、FAQ | 先按段落/句子切，最后长度兜底 | 不理解业务结构 | 可以作为兜底层，不作为唯一策略 |
| 结构化切分 | 制度、合同、技术文档、活动方案 | 保留标题、条款、表格、列表语义 | 解析逻辑更复杂 | 企业 RAG 优先选择 |
| Parent-child chunk | 长章节、说明文、跨段问题 | 小块召回准，大块补上下文 | 存储和上下文组装更复杂 | 适合面试重点讲，体现工程取舍 |
| 语义切分 | 长文章、主题跳转明显的材料 | 按语义边界切，阅读感更好 | 成本高、依赖模型、稳定性差 | 可作为优化项，不建议首版全量依赖 |
| 表格/多模态专用切分 | 表格、扫描件、PPT、图片、音视频 | 能保留行列、页码、OCR、时间轴 | 需要按模态单独处理 | 企业知识库必须补，不能粗暴当纯文本 |

当前项目落地口径：

```text
项目里当前实现的是 Markdown 结构感知 + RecursiveCharacterTextSplitter。先识别 Markdown 标题形成 headingPath；表格会转成“表格列 / 表格行”的键值语义；制度条款会抽出 clauseId；最后按段落、换行、中文句号、英文句号、空格递归兜底，默认 chunkSize=500、overlap=50。落库时保存 parentChunkId、sectionId、clauseId、tableRef、sourceStart/sourceEnd、docVersion、effectiveAt、expiredAt、sourceAuthority。这样不是追求切得最细，而是让检索、引用、版本治理、权限过滤都能用同一套证据单元。
```

为什么不是越大越好：

- chunk 太大：召回粒度粗，topK 容易被长文本稀释，prompt 成本高，引用不精准。
- chunk 太小：事实被拆散，模型拿不到上下文，容易把半句话当完整规则。
- overlap 太大：召回重复、成本上升、prompt 噪声变多。
- overlap 太小：跨段定义、条件和例外条款容易丢。

面试可以给一个具体例子：

```text
比如一份差旅制度，如果只按 500 字硬切，可能“住宿上限 650 元”和“仅适用于一线城市”被切到不同块里，模型就容易答漏条件。所以我会让 chunk 带章节路径“财务制度 > 差旅报销”，保留“第一条”这种条款编号，表格按行列转成键值，必要时召回 leaf chunk 后再补同 section 的 parent 上下文。这样回答不只是命中一个金额，还能带上适用条件、版本和来源。
```

如果被问「怎么评估切片好不好」：

- 看检索层：标准答案证据是否进入 topK，指标用 Hit Rate、Recall@K、MRR。
- 看排序层：正确证据是否排在前面，指标用 NDCG、rerank 后 MRR。
- 看生成层：答案 claim 是否被引用 chunk 支撑，引用是否能回到原文 source span。
- 看运营层：无结果率、引用失败率、用户负反馈、重复 chunk 比例、平均 prompt token。
- 看专项 case：表格、条款、版本冲突、权限隔离、跨章节条件、无答案拒答。

不要这么说：

- 「我们就是按 1000 token 切一下。」
- 「chunk 越大越完整，所以越大越好。」
- 「overlap 开大就能解决上下文问题。」
- 「用了语义切分就一定比规则切分准。」

项目映射：

- `document_chunks` 保存父子 chunk、heading path、section/clause/table metadata。
- `sourceStart/sourceEnd` 支持回到原文定位。
- `docVersion/effectiveAt/expiredAt/sourceAuthority` 支持制度版本和来源权威治理。
- `MarkdownChunker` 当前默认 `500/50`，但参数不是核心，核心是结构 metadata 和检索后的上下文组装。

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
我不用主观 demo 证明。项目里有 eval:rag:quality 质量门禁，包括 smoke、业务回归集、项目级仿真实业务评测和成熟度评分。项目级评测会真实上传模拟业务文档，用 simple 和 auto 提问，评分后清理。目前 28/28 通过，本地工程成熟度 93/100。但我也明确承认，没有真实私有业务题库前，不能宣称真实生产业务 90 分。
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
- 项目级仿真实业务评测 `28/28` 通过。
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

质量上，项目不是靠 demo 证明，而是有 eval:rag:quality 门禁，包含 120 条业务回归集、项目级仿真实业务评测和成熟度评分。当前本地工程成熟度是 93/100，项目级仿真实业务评测 28/28 通过。但我也明确区分工程分和真实业务分，真正生产级还需要接入公司真实私有题库和生产环境材料。
```

## 讲项目的 30 秒版本

```text
我做了一个企业级 Agentic RAG 知识库系统，后端 NestJS，前端 React，检索层结合 Milvus、BM25、Elasticsearch 和 Rerank，复杂问题走 LangGraph Agentic 工作流，普通问题走稳定 simple RAG。系统重点解决企业知识库里的召回准确性、引用支撑、拒答边界、多租户隔离、外部依赖降级和评测门禁。本地工程成熟度 93/100，项目级仿真实业务评测 28/28 通过。
```

## 最新面试 7 问回答口径

> 场景：面试官连续追问 RAG 实现、向量/ES/图谱、多 Agent、工具调用、项目问题、情感分析、AI Coding 使用方式。回答原则是讲真实闭环，不把没做的模块硬说成做了。

### 面试先记这一页

这 7 个问题本质上都在考同一件事：你是不是只会调 LLM，还是能把 AI 应用做成可验证、可运维、可解释的工程系统。

回答骨架固定用这 6 层：

```text
输入资料
  -> 解析/清洗/切片/metadata
  -> 多路索引：Milvus 向量 + BM25/ES 关键词 + Neo4j 图谱 + Obsidian/Karpathy 编译层
  -> 查询路由：simple / auto / agentic
  -> 检索增强：query normalize、hybrid retrieval、GraphRAG、Web Search、Rerank
  -> 生成治理：引用校验、claim support、低相关拒答、reflection
  -> 运营闭环：日志、指标、评测集、失败样本、ROADMAP
```

面试现场优先讲这几个判断：

- 企业 RAG 的关键不是“能回答”，而是“证据能撑住”。
- 向量不是万能，中文企业知识库一定要关键词检索、metadata 和 rerank。
- Agentic 不是默认路径，普通问题走稳定链路，复杂问题才升级。
- 工具调用不是模型直接执行，必须由宿主系统做 schema、权限、超时、审计。
- 没有真实业务题库，不要报真实业务准确率。
- 情感分析没做就直说没做，转到 QA 质量分析和可扩展方案。
- AI Coding 不是自动驾驶，必须靠规则、验证和边界控制。

### 30 秒总回答

```text
这个项目是企业级统一 Hybrid RAG 与 Agentic RAG 知识库系统。我做的不是单纯向量问答，而是完整的知识工程链路：文档解析、结构化切片、Direct Answer Gate（精确直答门禁）、Milvus（向量数据库）、BM25／Elasticsearch 中文关键词索引、Neo4j GraphRAG、Obsidian 编译知识、Rerank（重排）、引用校验和低相关拒答。Karpathy 本地知识保留为受治理直答与降级资产，不是独立在线路由。

简单问题走 simple，也就是稳定 hybrid retrieval；复杂问题走 auto/agentic，由 LangGraph 状态机编排 query augment、retrieval、sufficiency、web search、rerank、generate、reflection。工程上有多租户隔离、AG-UI/SSE 流式输出、后台运营、Prometheus 指标和评测门禁。本地工程成熟度 93/100，项目级仿真实业务评测 28/28，但我不会把它说成真实生产准确率，因为还需要公司真实题库和生产环境验证。
```

### 2 分钟展开版

```text
这个项目从架构上分成两条互补链路。

第一条是传统企业 RAG 链路：文件或 URL 进入系统后，先做解析、清洗、结构化切片，切片会带 docId、chunkId、userId、章节、来源、生效期、权限等 metadata。之后同一份 chunk 同步进入 Milvus 向量索引、BM25/Elasticsearch 关键词索引和数据库元数据。查询时先做 query normalize，再做向量召回和关键词召回，用融合排序和 rerank 选证据，最后生成答案并做引用校验、claim support 和拒答判断。

第二条是知识编译与统一检索链路。URL、文件、手动输入、官方文档同步会按文档适用性并发构建关键词、向量和 Obsidian 编译知识。simple 与 auto 都先过 Direct Answer Gate，未命中后执行完整 Hybrid RAG；auto 在证据不足或问题复杂时升级 agentic。Karpathy 本地知识只负责受治理直答和降级，Obsidian 候选进入统一证据融合，不再表述成两条独立 fast path。

复杂问题会进入 LangGraph 编排，但我没有让所有问题默认走 Agent。Agentic 节点包括 routing、query augment、retrieval、sufficiency、web search、rerank、generate、citation、reflection、final，每个节点都有状态、预算和可观测事件。这样能控制成本，也能定位慢在哪里、错在哪里。

质量上，我用 eval:rag:quality、eval:rag:project、eval:rag:maturity 做门禁。本地工程成熟度 93/100，项目级仿真实业务评测 28/28。这个分数说明工程闭环成熟，但不是生产 SLA，也不是公司真实业务准确率。真实生产还需要真实私有题库、真实组织权限、真实图谱数据源、真实 Milvus/ES 压测和生产运维材料。
```

### 1. 项目怎么做 RAG

可以这样答：

```text
这个项目是企业知识库 RAG，不是简单的“向量召回 + LLM 总结”。完整链路是文档上传、URL 抓取或手动输入，进入解析、清洗、结构化切片、metadata 补全，然后同一份 chunk 同步进入 PostgreSQL 元数据、Milvus 向量索引、BM25/ES 关键词索引和 Karpathy/Obsidian 知识层。查询时先做 query normalize，再做混合检索、Rerank、生成回答、引用校验和低相关拒答。

我重点处理的是企业知识库里的可信问题：中文召回、引用支撑、低相关拒答、空库兜底、版本冲突、GraphRAG 关系检索和后台运营可观测。
```

更短版本：

```text
我们做的是 hybrid retrieval RAG。向量负责语义召回，BM25/ES 负责关键词和精确匹配，GraphRAG 负责关系型问题，最后通过 rerank、引用校验和拒答策略保证答案可信。
```

面试官追问“为什么不直接用向量库”时：

```text
因为企业知识库里很多问题依赖精确词，比如制度编号、金额、版本号、系统名、部门名、缩写和否定条件。纯向量容易找语义相近但事实不对的片段。向量负责语义泛化，BM25/ES 负责精确命中，metadata 负责权限和版本，rerank 负责把真正相关的证据排到前面。
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

可以补一张脑内流程图：

```text
写入侧：
Document -> Chunk -> Embedding -> Milvus
                 -> BM25/ES
                 -> Entity/Relation -> Neo4j
                 -> Raw/Note/Compiled -> Obsidian

查询侧：
Query -> normalize -> vector recall + keyword recall + graph hints
      -> fusion/rerank -> evidence pack -> LLM
      -> citation/claim check -> answer/refusal
```

### 3. 多 Agent 怎么协调

不要说“多个 Agent 自己协作”。建议说：

```text
我这里的多 Agent 更准确地说是 LangGraph/状态机式编排，不是自由聊天式多 Agent。它不是让几个 Agent 随便聊天，而是把复杂 RAG 拆成确定节点：routing、query augment、retrieval、sufficiency、web search、graph search、rerank、generate、citation、reflection 和 final。

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

追问“怎么避免 Agent 失控”时：

```text
我主要靠状态机和预算控制，而不是只靠 prompt。比如限制 query 扩展数量、检索查询数、web search 结果数、rerank topN、最大重试次数、最大上下文 chunk 数；如果检索不足或引用撑不住，就拒答或回退片段抽取式回答。Agentic 是增强路径，不是默认黑盒路径。
```

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

再补一层工程细节：

```text
每个工具都要定义输入 schema、输出 schema、超时、错误码和降级策略。比如 Web Search 没 key 就跳过，不阻塞主链路；Rerank 失败就用融合排序结果；Milvus 超时就走 BM25/ES 回退；MCP server 未启用时不能影响后端启动。
```

容易踩坑：

- 不要说“Agent 自己调用接口”，要说“模型提出工具调用，宿主执行”。
- 不要忽略参数校验和权限。
- 不要让工具无限重试。

### 5. 项目里实现 RAG 遇到什么问题

可以挑 4-5 个具体讲：

```text
第一个问题是中文召回不稳定。只靠向量时，制度编号、产品名、金额、专有名词容易漏，所以我做了 BM25/ES 混合召回、query normalize 和中文错别字修正。

第二个问题是召回片段语义相似，但不能支撑最终答案。解决方式是生成后做 citation 和 reflection，关键 claim 必须能被引用片段支撑。

第三个问题是空库或低相关时模型容易胡说。我的处理是低分拒答、检索不足标记和受控联网补证；本地与网页都没有可靠证据时明确拒答，不用模型常识自由补齐，也不伪造引用。

第四个问题是 GraphRAG 的真实数据和可用态。Neo4j 不可用、图谱为空、接口错误、演示数据都必须区分，后台不能静默 mock。

第五个问题是 SSE/AG-UI 流式链路。真实 SSE 有多行 frame、代理超时、token 传递和断流问题，所以我改成 fetch stream 解析，并让 admin-backend 对 SSE 跳过普通 API 的 5 秒熔断。

第六个问题是索引一致性。同一份资料会进入数据库、Milvus、ES/BM25、Neo4j 和 Obsidian，如果重复入库、删除、权限变更不同步，就会出现“搜得到但不该看”或“Obsidian 有但 RAG 没有”的问题。所以我用 content_hash、rag_doc_id、userId 和补偿写入逻辑保证 RAG 索引层和 Obsidian 知识层互补而不是互相吞数据。
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

如果面试官强行问“那你们页面上的负反馈算不算情感分析”，可以这样答：

```text
不算。负反馈、无引用、低置信度、无结果率是运营质量信号，不等于情绪分类。它们能帮助我们定位回答质量问题，但不能直接推导用户情绪。如果要做情绪识别，必须单独定义标签、标注数据、做评测。
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

### 7 问压缩成背诵卡片

| 问题 | 一句话回答 | 追问时展开 |
|---|---|---|
| RAG 怎么做 | 不是纯向量问答，是解析、切片、多路索引、混合检索、rerank、引用校验、拒答闭环 | chunk metadata、query normalize、citation/claim check |
| 向量/ES/图谱 | 向量管语义，ES/BM25 管精确词，图谱管关系型问题 | Milvus + ES/BM25 + Neo4j + Obsidian，各自职责清楚 |
| 多 Agent | 更准确是 LangGraph 状态机编排，不是自由聊天 | routing/query augment/retrieval/sufficiency/rerank/generate/reflection |
| 工具调用 | 模型提工具名和参数，宿主做校验、权限、超时、审计后执行 | Web Search、Rerank、Graph、MCP、ASR/TTS 都要可降级 |
| RAG 问题 | 难点是中文召回、引用支撑、低相关拒答、索引一致性、流式链路 | 用 hybrid、rerank、claim check、content_hash、SSE 解析解决 |
| 情感分析 | 没做独立情感分析，做的是 QA 运营质量分析 | 不报准确率；若要加，用标注集评 precision/recall/F1 |
| AI Coding | 当协作工具，不当自动驾驶 | CLAUDE/ROADMAP 约束、红线、验证、文档同步 |

## 还应该准备的追问

下面这些不是每场都会问，但一旦问到，能明显拉开“做过 demo”和“做过工程闭环”的差距。

### 1. 为什么选 NestJS，而不是 Python/FastAPI？

```text
这个项目有管理后台、权限、任务队列、审计、运营 API、SSE、gRPC、定时任务和多模块边界，NestJS 的模块化、依赖注入、Guard/Interceptor/Pipe、TypeORM 集成更适合做企业后台工程。Python 在模型实验和数据处理上更强，但这个项目不是算法训练平台，而是长期运行的企业应用服务。

如果团队是算法团队主导，FastAPI 也成立；但我这里更看重工程结构、权限治理、前后端 TypeScript 协作和可维护性，所以选 NestJS。
```

追问时补一句：

```text
模型能力通过 Provider 抽象接入，后端语言不绑定模型生态。真正重要的是服务边界、可观测、评测和降级，而不是某个框架天然更 AI。
```

### 2. 为什么不用现成 Dify / Coze / LangFlow？

```text
Dify/Coze 适合快速搭应用和验证流程，但企业知识库落地时会遇到权限隔离、索引一致性、引用支撑、评测门禁、后台运营、私有部署、定制 GraphRAG 和工程调试的问题。这个项目的目标不是快速搭一个 bot，而是掌握核心链路并能按业务要求深度定制。

我会把这类平台当参考或内部效率工具，但核心知识库系统还是自己控制索引、权限、评测和运维边界。
```

边界：

- 不要贬低 Dify/Coze。
- 要说“适用场景不同”，不是“平台不行”。

### 3. 怎么做权限过滤？

```text
权限不能只在前端或 controller 层做。文档入库时要带 userId、部门、角色、权限主体、来源和可见范围；检索时在 PostgreSQL 元数据、Milvus metadata、BM25/ES 查询和后台 API 都要带权限条件。答案引用也只能来自当前用户可见片段。

权限变更或文档删除后，要同步让向量、ES/BM25、图谱和缓存失效；否则会出现用户看不到文档但还能通过 RAG 问出来的问题。
```

面试官追问“向量库怎么做权限”：

```text
向量记录 metadata 里带 userId/docId/permission scope，检索时加过滤条件；如果向量库过滤能力不足，也要在召回后基于 active docId 和权限表做二次过滤。不能把权限押在 prompt 上。
```

### 4. 怎么处理文档更新、删除和索引一致性？

```text
企业知识库最怕旧版本残留。我的处理是每个文档有 docId、version、content_hash、effectiveAt、expiredAt、sourceAuthority。更新时要么生成新版本，要么触发 reindex；删除时清理元数据、chunk、BM25/ES、Milvus 和图谱关联，并在检索阶段用 active docId 过滤残留。

Obsidian/Karpathy 链路里也用 content_hash 和 rag_doc_id 做去重和补偿，避免 Obsidian 已经有笔记但当前用户 RAG 索引没写入，或者重复资料反复入库。
```

可以说的取舍：

```text
一致性上我优先选择最终一致。因为向量库、ES、图谱、Obsidian 都是不同介质，不现实每次都做强事务。工程上要有任务状态、失败重试、对账脚本和后台可见状态。
```

### 5. 怎么做性能优化？

```text
我会先拆链路耗时，而不是盲目换模型。RAG 的耗时通常来自解析、embedding、向量检索、ES 检索、rerank、LLM 首 token、流式代理。系统里通过 SSE 事件、Prometheus 指标和 traceparent 把阶段拆开。

优化策略上，写入侧异步化，上传后进 BullMQ；检索侧限制 topK、rerank topN、query 扩展数量和 web search 结果数；生成侧尽早流式输出；外部依赖如 Milvus、Rerank、Web Search 都要有 timeout 和降级。
```

追问“为什么之前觉得慢”：

```text
之前 admin 问答兜底场景首字慢，是因为会话创建、记忆检索、质量闸门和兜底生成串行阻塞。我做过优化：RUN_STARTED/TEXT_MESSAGE_START 提前发，长期记忆检索最多等 600ms，检索不足时跳过不必要 query augment，空 token 不下发。优化后首字从用户感知约 5-11 秒降到约 2 秒量级。
```

### 6. 怎么保证答案不会乱编？

```text
不能保证模型永远不乱编，只能通过工程边界降低概率并让错误可发现。我的策略是检索质量闸门、低相关拒答、引用编号校验、claim support 检查、引用不足时回退片段抽取式回答，以及把失败样本进入评测集。

核心原则是：没有证据就不做确定性回答；有答案也必须能回到 chunk 证据。
```

不要说：

- “完全消除幻觉。”
- “我们 prompt 写得好，所以不会胡说。”

### 7. 如果上线到大公司，还差什么？

```text
技术架构已经具备企业级原型基础，但进一线大厂生产还差真实材料和组织流程，不是再堆几个模型。主要差真实私有业务题库、真实组织权限系统、真实 GraphRAG 数据源、真实多模态样本、真实 Milvus/ES 压测、生产域名证书备份监控、安全合规审计和发布回滚流程。

所以我会把当前状态定义为本地工程成熟度 93/100，而不是生产 SLA。生产化要用真实业务数据和真实运行环境重新打分。
```

这段非常重要，能体现你不虚吹。

### 8. 前端负责人怎么讲这个项目？

```text
如果从前端负责人视角讲，我的重点不是“写了几个页面”，而是把 AI 能力产品化和运营化。用户侧要解决上传、问答、引用、流式输出、错误态和语音交互；管理后台要解决文档治理、搜索运营、问答运营、图谱运营、用户权限、审计日志和系统配置。

AI 问答页面不是普通 chat UI，它要支持 AG-UI/SSE 真实流式事件、Markdown/代码块/表格/图片输出、引用展示、路由状态、检索充分性、错误兜底和历史会话。图谱页面要支持节点管理、关系检索、图谱统计和图上编辑，同时不能把 demo 数据伪装成真实数据。
```

追问“前端难点是什么”：

```text
难点在异步状态和可信表达。AI 输出是流式的，可能有 token、final、error、custom event、media event；页面要边流式渲染边保持 Markdown 结构、图片尺寸、代码块样式和事件轨迹。另一个难点是不要让用户误以为兜底答案或 demo 图谱是真实结果，所以 UI 要明确展示 route、retrievalSufficient、demo meta 和错误来源。
```

### 9. 怎么设计管理后台指标？

```text
我会把后台指标分成四类。第一类是知识资产：文档数、chunk 数、解析失败率、索引状态、权限覆盖。第二类是检索质量：无结果率、召回问题、热门 query、rerank 命中、引用失败。第三类是问答质量：负反馈、拒答率、引用支撑率、成本和延迟。第四类是系统健康：Milvus/ES/Redis/Neo4j/LLM provider 状态、队列堆积、外部工具失败率。
```

一句话：

```text
管理后台不是摆数据大屏，而是让失败样本能被发现、被定位、被回流到评测集。
```

### 10. 怎么做评测集建设？

```text
评测集不能只有“能答出来”的正例。企业 RAG 至少要覆盖事实题、版本题、别名题、跨文档题、冲突题、权限题、多轮追问和无答案拒答题。每条题目要有标准答案、来源文档、期望引用、expectedClaims 和是否应该拒答。

上线后每次线上失败都应该进入回归集，形成持续评测，而不是项目上线时测一次就结束。
```

追问“为什么不用 accuracy”：

```text
RAG 不能只看 accuracy。召回层看 Recall@K、Hit Rate、MRR；排序层看 NDCG/MRR；答案层看 faithfulness、citation accuracy、claim support；拒答题看 false positive/false negative。单一 accuracy 会掩盖“答对但没证据”和“无答案乱答”的风险。
```

### 11. 怎么讲一个真实排障案例？

准备这个 STAR 版本：

```text
背景：Admin AI 问答回答输出一开始很丑，后来接 AG-UI/SSE 后又出现事件轨迹重复、历史会话消失和首字延迟过高。

动作：我没有只改 UI，而是沿链路排查：admin 页面 -> admin-backend SSE proxy -> rag-backend AG-UI stream -> RAG 生成链路。输出格式上改成 Markdown/代码块/图片结构化渲染；事件轨迹上把连续 TEXT_MESSAGE_CONTENT 折叠成 EVENT x N；历史会话问题修正 admin-backend 对 conversations 返回结构的解包；首字延迟则把 RUN_STARTED/TEXT_MESSAGE_START 前置，记忆检索设置 600ms 上限，检索不足时跳过不必要 query augment。

结果：页面输出从纯文本堆叠变成类 ChatGPT/DeepSeek/Codex 的结构化回答，事件轨迹不再刷屏，历史会话恢复，兜底问题首字延迟从用户感知约 5-11 秒降到约 2 秒量级。
```

这个案例适合回答：

- “你遇到过最难的问题是什么？”
- “你怎么排查线上问题？”
- “你怎么优化 AI 应用体验？”

### 12. 怎么反问面试官？

可以准备这些问题，显得你真的懂落地：

- 你们现在 RAG 的主要问题是召回不准、答案幻觉、权限过滤，还是评测体系不足？
- 你们有没有真实业务题库和标准答案？失败样本会不会进入回归集？
- 现在知识库索引是纯向量，还是 hybrid retrieval？
- 文档权限变更后，向量索引和 ES 索引怎么同步失效？
- 线上是否有 citation accuracy、refusal accuracy、无结果率、负反馈率这些指标？
- Agent 工具调用有没有权限、超时、审计和成本预算？
- 多模态是真实 OCR/视觉向量检索，还是只把图片转成文本 metadata？

## 公开 JD 对照补强

> 2026-07-06 抽样看了字节、百度、美团、腾讯，以及公开 AI Agent / 大模型应用开发 JD。BOSS 直聘类页面有登录和反爬限制，所以这里按可公开访问 JD 和搜索结果摘要归纳，不把单个 JD 当完整行业结论。

公开样本：[字节 AI Agent 研发](https://jobs.bytedance.com/experienced/m/position/detail/7428873140916554010?recomId=c3d5e497-1e0c-11f1-9ed4-fa163e47e78a&sourceJobId=7263011409558210874&utm_source=ld246.com)、[美团 AI Agent 应用架构](https://zhaopin.meituan.com/web/position/detail?highlightType=social&jobUnionId=4428189649)、[百度 AIDU 智能体算法/Agent 应用全栈](https://talent.baidu.com/jobs/list?recommendCode=IS96J8&recruitType=GRADUATE)、[腾讯 LLM Application Engineer](https://www.linkedin.com/jobs/view/sr-llm-application-engineer-ai-agents-at-tencent-4414642626)、[阿里 AI Agent 优化](https://campus-talent.alibaba.com/campus/position/199907160001)、[BOSS 美团相关摘要](https://www.zhipin.com/zhaopin/f754f635db6b33f81ndz3NS_Fw~~/)。

### 大厂 JD 共性要求

| JD 高频要求 | 面试官实际想确认 | 你项目里的对应点 | 还要怎么讲 |
|---|---|---|---|
| RAG / Agent 融合 | 不是只会调接口，而是能让知识理解和任务执行结合 | simple / auto / agentic 三模式，RAG 证据不足再升级 Agentic | 强调 Agentic 不是默认路径，复杂任务才升级 |
| Planning / Acting / Reflection | 会不会设计 Agent 执行闭环 | LangGraph 节点：routing、query augment、retrieval、sufficiency、generate、reflection | 不要说“Agent 自己想办法”，要说状态机 + 预算 |
| Tool Calling / MCP / Function Calling | 工具调用是否安全、可控、可观测 | Web Search、Rerank、Graph、MCP、ASR/TTS 接入和降级 | 重点讲 schema、权限、超时、审计、降级 |
| Memory（记忆）长短期记忆 | Agent 是否能跨轮次、跨任务沉淀上下文 | 会话记忆、摘要、长期语义记忆与 Obsidian 编译知识 | 区分 conversation memory（会话记忆）、semantic memory（语义记忆）、artifact memory（产物记忆） |
| Eval / Benchmark | 能不能证明效果，而不是只演示 | eval:rag:quality、project eval、maturity gate、失败样本回流 | 讲 Recall@K、citation accuracy、tool success、latency、cost |
| Observability | 出错能不能定位 | SSE 事件、traceparent、Prometheus、后台运营状态 | 讲一次回答可追踪到检索、rerank、LLM、工具 |
| 多模态 | 文档、图片、音频、视频是否能进入知识库 | 已有 OCR/ASR/视频 sidecar 和元数据链路 | 诚实说真实视觉向量和视频理解要等模型 key/样本 |
| 生产工程 | 高可用、低延迟、容器化、监控、灰度、限流 | Docker Compose、本地服务、timeout、fallback、队列化写入 | 不把本地工程分说成生产 SLA |
| 成本与延迟 | 能不能商业化运营 | topK/topN、query expand、web search、rerank、首字优化 | 讲 token budget、cache、routing、fallback |
| 数据合规 / 私有化 | 企业客户能不能用 | 多租户隔离、权限 metadata、引用过滤、红线不碰生产配置 | 金融/证券岗位要主动讲审计、留痕、权限和合规边界 |

### 按公司类型怎么调整讲法

#### 阿里 / 腾讯 / 百度 / 字节 / 美团

```text
这些公司更看重规模化落地，不只问你 RAG 怎么跑，还会追问 Agent 成功率、延迟、成本、工具调用可靠性、评测体系和业务闭环。

我的讲法是：项目不是 demo bot，而是有 simple/auto/agentic 路由、混合检索、GraphRAG、工具调用、流式输出、评测门禁和后台运营的完整系统。普通问题走稳定链路，复杂任务才走 Agentic；每个节点有 timeout、降级、指标和 trace。
```

可以主动补：

- 百度类 JD 会问感知-决策-执行闭环、长期记忆、推理机制、Agent 评测。
- 字节类 JD 会问 RAG、MCP、HTTP/WebSocket、LangChain/LangGraph、后端高可用。
- 美团类 JD 会问任务规划、Tool Use/MCP、记忆管理、多 Agent 协同。
- 腾讯游戏/内容生产类 JD 会问 Agent 如何嵌入研发、策划、美术、测试、运营流程。

#### 小米 / 大疆 / 高德

```text
这类岗位常把 AI Agent 和具体业务系统结合得更深。小米可能更偏智能硬件、IoT、用户助手；大疆可能更偏多模态、设备、视觉、低延迟和边缘场景；高德可能更偏地图、出行、POI、路径规划、实时数据和位置服务。

我的项目可以迁移的部分是：RAG 负责私域知识，Agent 负责任务编排，工具层对接业务 API，评测层衡量任务成功率和延迟。真正要补的是接入它们的真实业务 API、实时数据和领域评测集。
```

回答时别硬说做过车载、无人机或地图生产系统。可以说：

```text
我没把这个项目部署到硬件或地图生产链路里，但 Agent 架构上的任务规划、工具调用、权限、观测、评测和降级是可迁移的。区别在于业务工具、实时数据、端侧约束和评测集要重新建设。
```

#### 微信 / DeepSeek

```text
微信类场景更关注超大用户规模、消息链路、权限边界、内容安全、插件生态和用户体验；DeepSeek 类公司更关注模型理解、推理效率、训练/推理基础、评测方法和模型能力边界。

我的优势更偏 AI 应用工程和 Agent/RAG 系统落地。遇到模型底层岗位时，要承认我不是训练算法主责，但能讲清楚模型 API 接入、RAG/Agent 架构、评测、推理成本、流式体验和工程可观测。
```

#### 中信 / 平安 / 证券公司

```text
金融类 AI 应用最核心不是“炫技”，而是安全、合规、可审计、可解释、权限隔离和结果可追溯。RAG 系统必须做到用户只能检索自己有权限的资料，答案必须有引用，工具调用必须有审计，敏感数据不能进日志，模型输出要能拒答。

我的项目里可以重点讲多租户隔离、metadata 权限过滤、引用校验、拒答、评测门禁、失败样本回流和后台审计思路。不能说已经满足金融生产合规，只能说架构上预留了合规落地点，真实落地要接入公司的 IAM、DLP、审计、脱敏和审批流程。
```

金融面试最容易问：

- 如果制度文档有新旧版本冲突，怎么回答？
- 如果用户没权限看某份材料，向量库已经召回了怎么办？
- 如果模型调用外部 API，会不会泄露客户信息？
- 如果投资建议答错，责任边界怎么控制？
- 怎么保留审计日志，又不把敏感内容写进日志？

建议回答：

```text
金融场景里我不会让模型直接给确定性投资建议。RAG 只能回答制度、流程、产品说明、已授权知识；涉及投资建议、风控结论、客户隐私和监管敏感内容，要进入拒答、转人工或审批工作流。
```

### 还要补的知识点

这些不一定都要编码进项目，但面试前要能讲清楚：

1. **Agent Memory 分类**

```text
短期记忆是当前会话上下文，长期记忆是跨会话沉淀的用户偏好、业务事实或项目资产，工具记忆是外部系统返回的结构化结果，artifact memory 是 Obsidian/Karpathy 这种可复用知识产物。记忆必须可过期、可删除、可追溯，不能把所有聊天记录无限塞上下文。
```

2. **Agent 任务成功率怎么评估**

```text
Agent 不只看答案对不对，还要看任务是否完成、工具调用是否成功、步骤是否合理、是否越权、是否超预算、是否需要人工介入。指标包括 task success rate、tool success rate、step accuracy、latency、cost、human handoff rate、unsafe action rate。
```

3. **MCP / A2A / Function Calling 区别**

```text
Function Calling 是模型输出结构化函数调用意图，宿主执行；MCP 更像统一工具和上下文接入协议，让模型应用用标准方式连接外部工具和资源；A2A 更偏 Agent 之间的通信与协作协议。面试里不要把它们混成一个概念。
```

4. **Agent 安全护栏**

```text
工具白名单、参数 schema、权限校验、敏感字段脱敏、速率限制、预算控制、危险动作二次确认、审计日志、输出安全检查、prompt injection 检测。尤其是工具调用不能只靠 prompt 约束。
```

5. **Prompt 工程版本化**

```text
Prompt 不是临时字符串，要有版本、适用场景、输入输出契约、评测集、回滚策略和变更记录。一次 prompt 修改应该能通过离线评测再上线。
```

6. **模型路由**

```text
不是所有问题都用最强模型。简单 FAQ 用快模型或本地知识编译结果，复杂推理用强模型，需要工具的走 Agentic，敏感问题走拒答或人工。模型路由要同时看质量、延迟、成本和安全。
```

7. **上下文工程**

```text
上下文工程不是把资料越塞越多，而是选择哪些证据、按什么顺序、用什么结构交给模型。要控制 token、去重、压缩、分组、保留来源和冲突信息。
```

8. **Prompt Injection 防护**

```text
RAG 文档里可能包含“忽略之前指令”这类恶意内容。防护上要把 system/developer 指令和检索内容隔离，检索内容只当证据，不当指令；工具调用前再做权限和参数校验。
```

9. **Human-in-the-loop**

```text
高风险动作不能全自动。比如金融建议、审批、删除数据、外部系统写操作，都应该有人工确认、审批流或只读预演。Agent 的价值是辅助决策和执行低风险步骤，不是替代所有责任边界。
```

10. **从前端负责人角度补一句**

```text
AI 应用的前端不是聊天框，而是状态机可视化、人机协同界面和可信输出界面。要把 thinking、tool call、evidence、citation、error、handoff、history、media output 都设计成用户能理解的产品状态。
```

### JD 对照后的简历补强句

可以在简历或面试开场里换成这个版本：

```text
主导企业级统一 Hybrid RAG 与 Agentic RAG 知识库系统，覆盖文档解析、Direct Answer Gate（精确直答门禁）、Hybrid Search（混合检索）、GraphRAG、Obsidian 知识编译、LangGraph Agentic Workflow（智能体工作流）、Tool Calling（工具调用）／MCP 接入、AG-UI／SSE（服务端事件）流式输出、权限过滤、引用校验、拒答策略、评测门禁和后台运营。项目对齐 AI 应用开发、Agent 开发和企业知识库落地场景，重点解决 Agent 成功率、检索可信度、工具调用安全、延迟成本和可观测问题。
```

## 面试时最好主动承认的边界

主动说这些，反而显得懂行：

- 93/100 是本地工程成熟度，不是生产 SLA。
- 仿真实业务题不能替代公司真实私有题库。
- Milvus 本机 Docker search warning 已降级，但还值得从容器版本、segment、资源配置继续治理。
- GraphRAG 和 MCP 的工程入口已有，但真实业务价值取决于数据源和工具质量。
- AI 应用不是一次性交付，必须持续积累评测集和失败样本。

## 高级 Agent 开发最后速背页

这部分专门对齐高级 Agent 开发，不讲底层算法训练细节。面试官问「你怎么理解 Agent 工程」时，优先从这里答。

### 1. 高级 Agent 开发到底高级在哪？

```text
高级 Agent 开发不是让模型更自由，而是让模型在真实业务系统里更可控。我的理解是：用模型处理自然语言、规划和生成，用工程系统处理状态、权限、工具执行、错误恢复、评测、成本和审计。真正的 Agent 产品是 Model + Harness，不是 LLM API + prompt。
```

### 2. Agent Harness 七层

| 层 | 面试关键词 |
|---|---|
| 模型层 | provider 抽象、模型路由、fallback、token / latency |
| 循环层 | max steps、timeout、stop condition、interrupt / resume |
| 工具层 | registry、schema、权限、幂等、审计、结构化返回 |
| 记忆层 | working、episodic、semantic、procedural |
| 策略层 | prompt / policy / permission / persona 版本化 |
| 通道层 | Web、CLI、MCP、IM、Webhook、Queue 和 core 解耦 |
| 自驱层 | cron、heartbeat、monitor，必须有预算和告警 |

### 3. 12-Factor Agent 一句话

```text
我不会让 LLM 控制所有流程，而是让它在确定性代码框架内做结构化决策。Prompt、Context、Control Flow、State、Tool、Error、Human Approval 都应该由应用系统拥有和治理。
```

### 4. Agent 评测怎么说？

```text
LLM 评测看答得对不对，Agent 评测看事情有没有做成。要定义 Task、Trial、Transcript、Outcome、Grader 和 Report；Transcript 记录模型说了什么和调了什么工具，Outcome 验证数据库、文件、API 状态是否真的变化。能用 code-based grader 的先用确定性评分，开放质量再用 LLM judge，人审用于校准和高风险决策。
```

### 5. Agentic RAG 怎么说？

```text
Naive RAG 是搜一次就答，Advanced RAG 加 query rewrite、hybrid search 和 rerank，Modular RAG 让组件可替换，Agentic RAG 让 Agent 判断要不要搜、搜什么、够不够、是否二次检索。生产里不能让它无限搜，要用状态机、预算、sufficiency gate 和 citation gate 管住。
```

### 6. Deep Research 怎么说？

```text
Deep Research 是 Agentic RAG 在研究场景下的增强形态，核心是搜索规划、多轮检索、多源交叉验证、信息饱和判断和结构化长报告。我的项目可以讲 Agentic RAG 和 web search fallback，但不会包装成完整 Deep Research 平台。
```

### 7. Skill / 程序性记忆怎么说？

```text
Tool 是能力，Skill 是使用能力的流程。Prompt 是这一次怎么做，Memory 是知道了什么，Skill 是以后遇到这类任务应该怎么做。成熟 Skill 系统要做渐进式披露：系统里只常驻 name + description，正文和 references 按需加载，避免 token 爆炸和 prompt cache 失效。
```

### 8. Memory 高级设计怎么说？

```text
Memory 要分 working、episodic、semantic、procedural。当前任务状态是 working memory，过去发生过的事件是 episodic memory，稳定事实是 semantic memory，可复用 SOP 是 procedural memory。过期记忆不一定删除，而是退出 active retrieval，保留 archival index 供审计。
```

### 9. 生产 Agent 最大的坑

| 坑 | 高级回答 |
|---|---|
| 多步骤错误复合 | 每步 95% 可靠，20 步整体只有约 36%，所以要限制步骤和拆小任务 |
| 长上下文成本 | 不能无限累积历史，要做检索、摘要、压缩、外部状态 |
| 工具工程被低估 | 工具返回要给模型可理解的摘要、状态、错误和恢复建议 |
| 全自主风险 | 写操作、删除、付款、审批必须 human-in-the-loop |
| 只看最终回复 | Agent 评测必须验证 Outcome，不只看 Transcript |

### 10. Agent 框架选型怎么说？

```text
我不按 star 数选 Agent 框架，而按任务形态选。快速 RAG 原型可以用 LangChain，生产级状态机更适合 LangGraph，多 Agent 原型可以看 AutoGen / CrewAI，高合规客服类场景可以关注 Parlant，学习原理可以看 Swarm。我的项目选 LangGraph/FSM 思路，是因为企业 Agent 更需要状态、分支、预算、恢复和可观测，而不是完全自治。
```

### 11. 合规型 Agent 怎么说？

```text
高风险 Agent 不只看失败频率，更要看失败严重程度。一个偶尔越权退款、泄露账户信息或承诺医疗建议的 Agent，即使总体准确率高，也不能上线。金融、医疗、客服、审批类 Agent 要用 guidelines、journeys、strict mode、权限分级和人工确认，把最坏失败限制住。
```

### 12. 沙箱怎么说？

```text
代码执行、浏览器自动化、本地文件访问都不能给 Agent 裸权限。低风险本地任务可以用 Docker 或 OS sandbox；不可信代码要用 microVM / E2B 这类强隔离；企业多租户可以看 K8s + gVisor / Kata / OpenSandbox。关键是限制文件系统、网络出站、CPU/内存、执行时间、可写目录和 secret 可见性，并记录审计日志。
```

### 13. 多模态证据定位怎么说？

```text
多模态 RAG 不是 OCR 完就结束，而是要保留 page、bbox、figure、table、caption、timestamp、section。用户问图表、扫描件、视频片段时，答案必须能回到原页、原表、原图或原时间点，否则就不可验证。ColPali / ColQwen / ViDoRe 可以作为视觉文档检索了解项。
```

### 14. 数据合成 / 评测集构建怎么说？

```text
高级 Agent 开发里的数据合成重点不是训练算法，而是评测集冷启动和失败回归。生产日志、用户投诉、业务 SOP、人工客服升级、线上失败样本都可以变成测试 case；冷启动时可以用 Self-Instruct 扩展问题，用 Evol-Instruct 增加复杂度，但核心是验证：格式、语义、约束、多样性、去污染都要过。合成数据只能补覆盖，不能冒充真实业务效果。
```

### 15. 企业落地为什么工作流优先？

```text
我不会为了 Agent 而 Agent。企业落地要先拆工作流：低变化、高标准化步骤用规则或普通自动化；明确知识问答用 RAG；复杂信息聚合和工具调用才用 Agent；写操作、审批、合规决策必须人审。Agent 像新员工，需要岗位说明、可用工具、权限边界、评测标准、反馈回流和持续改进。
```

### 16. 通用主干是否已经补齐？

```text
高级 Agent 开发通用主干已经闭环：RAG、Agentic RAG、Harness、Eval、Memory、Tool/MCP、Skill、框架选型、合规、安全沙箱、多模态、数据合成、工作流落地、生产化边界。后续只需要按具体公司 JD 做定制，不需要再无限补通用知识点。
```

### 17. 不要吹过头

- 不说做了完整 RLHF / DPO / GRPO / Agentic 后训练。
- 不说普通 Agentic RAG 等于 Deep Research。
- 不说有 MCP 就天然安全。
- 不说 Skill 可以从社区拿来直接信任。
- 不说本地 eval 等于线上 SLA。
- 不说用了某个 Agent 框架就天然生产级。
- 不说有 OCR 就等于完整多模态 RAG。
- 不说 Docker 沙箱就能覆盖所有不可信代码风险。
- 不说合成评测集等于真实线上业务集。
- 不说 Agent 能替代整个工作流和最终责任人。

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
2. 再读 `../architecture/ARCHITECTURE.md`，掌握模块边界和技术取舍。
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
