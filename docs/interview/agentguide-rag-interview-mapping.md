# AgentGuide RAG / Agent 面试对照与项目回答手册

更新时间：2026-07-09

## 结论

结合 AgentGuide 的 RAG、Agent、MCP、Memory、安全和评测面试文档来看，这个 RAG 项目已经能覆盖 **AI 应用开发 / RAG 工程 / Agent 开发** 的主干面试要求，尤其适合作为“游戏活动与官网营销 Agentic RAG 知识协同平台”写进简历。

但它还不能包装成完整一线大厂生产级 Agent 平台。真实生产 SLA、线上灰度 / A-B、真实 IAM / DLP / 合规系统、真实业务 API、大规模线上 task success 看板、A2A、SFT / RLHF / 模型训练、完整视觉向量和视频理解闭环，这些要明确说成“架构预留或待接入真实环境”，不能硬说已经完成。

面试定调可以这样说：

```text
这个项目不是简单 Chatbot，而是从文档入库、混合检索、Agentic 编排、GraphRAG、MCP 工具接入、Admin 运营、评测和安全边界一起做的企业知识库 AI 应用。我的定位是 AI 应用工程和前端负责人视角下的业务知识协同，不是底层模型训练或完整生产平台。
```

## AgentGuide 高频点覆盖度

| AgentGuide 高频主题 | 当前项目覆盖度 | 项目证据 | 面试边界 |
|---|---:|---|---|
| RAG 完整流水线 | 强 | 文档解析、切片、Embedding、Milvus、BM25/ES、RRF、生成、引用校验 | 可以讲完整工程链路，不要只说“接了向量库” |
| Chunking / 入库治理 | 中强 | 多格式上传、URL、官方文档同步、Obsidian/Karpathy 双链路 | 真实公司历史原件仍需继续替换当前仿真模板 |
| Embedding / 向量库 | 中强 | Milvus provider、向量召回、失败降级 BM25 | 本机 Milvus 压测和真实资源规格仍待做 |
| BM25 / Hybrid Search | 强 | BM25 + ES + Milvus + RRF 融合 | 这是项目简历里最稳的技术亮点之一 |
| Rerank | 中强 | DashScope Rerank 工具，失败降级 | 依赖外部 key，不要说任何环境都一定启用 |
| GraphRAG | 中强 | Neo4j provider、GraphOps、实体关系 seed、节点编辑 | 真实业务图谱数据源还没有完全接入 |
| Agentic RAG | 强 | LangGraph: query augment、retrieval、sufficiency、web search、rerank、generate、reflection | 这是“状态机式可控 Agentic”，不是 AutoGPT 式无限自治 |
| Deep Research | 中 | 有 Agentic RAG、多步检索、web search、reflection | 缺多源交叉验证、长报告、研究任务 benchmark |
| Multi-Agent | 中 | researcher / analyst / writer / critic / editor + Supervisor 路由 | 目前是顺序管线和领域路由，非 A2A，冲突仲裁还可增强 |
| ReAct / Tool Use | 中强 | Bocha、Rerank、Graph、MCP、Vision、ASR/TTS provider | 工具多为只读 / 检索型，真实业务写操作未接 |
| MCP | 强 | `tools/rag-mcp-server` 暴露 RAG、GraphRAG、Supervisor、游戏营销工具 | 可讲“给 Codex/Trae/Claude Code 自动取上下文”，不是平台插件独占 |
| Memory | 中强 | Redis 短期记忆、Mem0 长期记忆、Obsidian/Karpathy 知识编译 | 记忆衰退、合规留存、冲突消解还不是完整生产体系 |
| RAG 评测 | 中强 | 项目级评测、Prompt Injection、Agent task、游戏营销专项 96 问 | 当前是本地 / 仿真评测，不等同长期线上准确率 |
| Agent Evaluation Harness | 中 | eval 脚本、readiness gate、task 脚手架 | 缺完整 transcript 分析、step accuracy、线上看板、shadow/A-B |
| Prompt Injection / 安全 | 中强 | 检索片段检测和脱敏、prompt 边界、权限、审计基础 | 缺真实红队样本、DLP、IAM、审批流 |
| 记忆 / 缓存 / Token 优化 | 中强 | Redis 对话缓存、短期记忆摘要压缩、simple/auto/agentic 路由、topK/Rerank/抽取式回答 | 当前还缺完整语义缓存、租户级 token 预算和线上成本告警 |
| 召回优化 / 纠错机制 | 强 | Query Augment、Hybrid Search、RRF、Sufficiency、Web Search Fallback、Citation Gate、Reflection | 真实业务毒题和线上失败样本回流还要继续补 |
| 高并发 / 低延迟 | 中 | simple/auto/agentic 路由、SSE 首字优化、BullMQ、timeout/fallback | 缺真实压测 SLA、容量规划和线上成本预算平台 |
| 多模态 | 中 | Vision provider、OCR/图片理解脚手架、ASR/TTS、sidecar 样本 | 缺真实视觉向量、视频抽帧理解、以图搜图 |
| SFT / RLHF / A2A | 弱 / 未做 | 项目没有相关主线 | 直接说不是本项目目标，项目主线是应用工程 |

## AgentGuide 必会知识点方案选型表

这张表专门回答主人担心的那类追问：面试官不只问「你用了什么」，而是继续问「还有哪些方案、优缺点是什么、你为什么这么选」。

面试时按这句话开头：

```text
我一般不会先报技术名词，而是先看业务目标、数据形态、延迟成本、权限安全和评测指标，再决定方案。比如切片不是只调 chunkSize，检索也不是只用向量库，Agent 也不是越自治越好。
```

| AgentGuide 追问方向 | 常见方案 | 优点 | 缺点 | 当前项目 / 面试选择 |
|---|---|---|---|---|
| 文档解析 | 纯文本抽取、Unstructured / Docling / MinerU、OCR、通用视觉模型 | 能覆盖 Markdown、PDF、表格、扫描件 | 精度、成本、部署复杂度不同 | 普通文件走文本和结构解析；表格、OCR、多模态保留 sidecar 和 source span；真实扫描件还要接更强 OCR |
| Chunking | 固定长度、递归字符、结构化、Parent-child、语义、多模态切分 | 兼顾召回粒度和上下文完整性 | 结构解析成本高，语义切分不稳定 | 当前是 Markdown 结构感知 + 递归兜底 + metadata；企业制度优先结构切分 |
| Embedding | 通用、中文/领域、多语种、自训练 | 上手快或更贴业务 | 维度、价格、延迟、领域泛化要权衡 | 先用中文稳定模型做 baseline，用业务题库看 Recall@K/MRR，不只看公开榜单 |
| 向量库 | Milvus、Qdrant、FAISS、Chroma、pgvector、Pinecone | 大规模、单机、原型、托管各有优势 | 运维、过滤、事务、成本差异大 | 项目用 Milvus 主召回，失败可回退 BM25/ES；不要说本地已完成亿级压测 |
| BM25 / ES | BM25、本地倒排、Elasticsearch / OpenSearch | 专有名词、编号、埋点、接口名准确 | 不懂语义和同义词 | 项目保留 BM25/ES，因为企业知识里关键词召回非常关键 |
| Hybrid Search | 加权融合、RRF、分阶段召回、GraphRAG 融合 | 提升召回覆盖 | 去重、分数融合和延迟复杂 | 项目用 BM25/ES + Milvus + RRF，再接 Rerank 和 GraphRAG |
| Query 改写 | normalize、query rewrite、query expansion、多查询、问题拆解、HyDE | 解决短问句和复杂需求 | 增加 token，改错会带偏 | simple 少改写，agentic 才做 query augment 和复杂链路 |
| Rerank | Cross-encoder、LLM rerank、规则权重、来源权威 | 提高正确证据排序 | 外部 key、延迟和成本 | 项目接 DashScope Rerank，可失败降级；生产要控制 topN |
| 上下文组装 | topK 直塞、按文档聚合、parent 扩展、MMR、压缩摘要 | 决定模型最终依据 | 塞多污染，塞少漏条件 | 项目强调 references、citation 和 claim support，必要时补同章节上下文 |
| Lost in the Middle | 证据排序、减少 chunk、摘要压缩、map-reduce、核心证据置前 | 降低长上下文遗忘 | 压缩可能丢信息 | 不盲目依赖长上下文，优先让正确证据进 topK 并排前 |
| 幻觉治理 | 拒答、引用校验、claim support、reflection、事实冲突提示 | 输出可信可追溯 | 覆盖率下降 | 项目有低相关拒答、Citation Gate、Reflection 和抽取式 fallback |
| RAG 评测 | Recall@K、MRR、NDCG、Faithfulness、Citation Accuracy、业务回归集 | 能定位问题层级 | 要准备标注题和标准证据 | 项目有质量门禁、业务回归和游戏营销 96 问；线上长期指标不要硬说 |
| 数据更新 | 全量重建、增量索引、hash 去重、版本号、tombstone、队列 | 保证新旧知识一致 | 删除、回滚和多索引一致性复杂 | 项目有 content_hash、docVersion、生效期和索引清理口径 |
| 权限过滤 | 应用层、检索层、索引层、多租户隔离、ABAC/RBAC | 防止越权召回 | 权限维度越多越复杂 | 项目按 userId / metadata 隔离；真实企业 IAM/DLP 还要接入 |
| Memory | 短期窗口、摘要、长期向量记忆、图记忆、时间衰减 | 支持多轮和个性化 | 记忆污染、过期、隐私风险 | 项目把会话、短期记忆、长期记忆、业务知识分层，不全塞 prompt |
| Agent 架构 | Chain、Workflow、ReAct、Plan-and-Execute、LangGraph/FSM、多 Agent | 从稳定到灵活逐步增强 | 越自治越难控 | 项目是 simple/auto/agentic 分层，生产口径偏状态机可控 Agent |
| Tool Calling / MCP | Function Calling、HTTP Tool、MCP Server、浏览器/文件/代码工具 | 让模型能连接外部系统 | 注入、越权、超时、幂等风险 | 项目有 MCP server 和工具注册口径；强调宿主执行、权限和审计 |
| 多 Agent | 单 Agent、Supervisor、角色 Agent、评审 Agent、A2A | 复杂任务分工清楚 | 冲突仲裁和成本复杂 | 项目可讲 Supervisor + researcher/analyst/writer/critic/editor，A2A 只说后续方向 |
| 模型路由 | 单模型、多供应商、大小模型路由、fallback、成本路由 | 平衡效果、成本和稳定性 | 多模型配置和一致性复杂 | 当前 Admin 可切 Qwen / DeepSeek；默认和 token 一致性要靠配置治理 |
| Prompt / Context Engineering | prompt 模板、few-shot、结构化输出、检索上下文、工具列表裁剪 | 控制模型输入和输出 | 无版本管理会难回归 | 项目可讲 Prompt Registry、上下文压缩、工具输出不可信隔离 |
| 微调 vs RAG | Prompt、RAG、SFT/LoRA、RLHF/DPO | 分别解决行为、知识、格式、偏好 | 微调不能解决实时知识 | 当前项目主线是 RAG/Agent 应用工程，不做训练；不要硬说 RLHF |
| 推理性能 | Streaming、KV Cache、batching、量化、vLLM、自建模型 | 优化体验和吞吐 | 自建运维成本高 | 项目用 Provider API + SSE；应用岗讲懂原理和取舍即可 |
| 可观测性 | trace、step event、Prometheus、query log、成本日志、回放 | 能排障和做回归 | 埋点体系要持续建设 | 项目有 AG-UI 事件、metrics、query log，线上看板仍是后续 |
| 安全治理 | Prompt Injection、secret 脱敏、tool allowlist、human-in-the-loop、审计 | 降低泄露和误操作 | 会降低自动化程度 | 检索内容当不可信数据，高风险工具必须确认 |
| 多模态 RAG | OCR、ASR、图片 caption、表格解析、视频抽帧、视觉向量 | 覆盖 PDF/PPT/图音视频 | 成本高、证据定位难 | 项目已有 Vision/ASR/TTS 脚手架和 sidecar，真实视觉向量闭环不要硬说 |
| 成本 / 延迟 | fast path、缓存、topK/topN 预算、并行、降级、限流 | 能支撑体验和成本 | 过度节省会伤准确率 | 项目用 simple/auto/agentic 路由、SSE、timeout/fallback 和 token 估算 |

## 这个项目好的地方

1. **工程链路比较完整**：不只是“上传文档 + 问答”，而是把入库、检索、生成、引用、拒答、后台运营、评测、MCP、GraphOps 串起来了。
2. **检索路线合理**：Milvus 负责语义召回，BM25/ES 负责精确词，RRF 做融合，Rerank 做精排，GraphRAG 补关系，符合一线项目常见演进路线。
3. **Agentic 不是硬套概念**：simple / auto / agentic 分层，简单问题走 fast path，复杂问题才进 LangGraph，能解释“速度和效果怎么权衡”。
4. **业务包装贴合你的经历**：游戏活动、营销 H5、小程序、PC/H5 官网、台湾服 / 东南亚服 / 海外适配，比泛泛“企业知识库”更像真实业务项目。
5. **有 AI Coding 亮点**：MCP 让 Codex / Trae / Claude Code 在写代码前自动查内部组件、活动模板、埋点规范和地区适配经验，这个比单纯聊天更有差异化。
6. **知道边界**：文档里已经把真实数据、生产化、合规、多模态闭环、A2A、模型训练等缺口讲清楚，面试时不容易被追问穿。

## 目前缺的内容

### 简历上可以弱化的缺口

| 缺口 | 为什么弱化 | 面试说法 |
|---|---|---|
| 真实线上准确率 | 入职时间短，真实数据积累不足 | “先搭知识结构、链路和评测方法，后续随活动上线和复盘持续回流。” |
| 大规模线上流量 | 当前是试点建设，不是成熟平台 | “本地有性能和质量门禁，真实 SLA 要接生产环境压测。” |
| 金融合规 / DLP | 不是游戏营销主业务 | “有权限、审计、引用、拒答等落点，强合规要接公司 IAM/DLP。” |
| A2A | 多数 AI 应用开发岗不是强必需 | “当前用 Supervisor + 子 Agent 管线，A2A 是后续跨 Agent 平台化方向。” |
| SFT/RLHF | 你投前端负责人 / AI 应用岗，不是模型算法岗 | “本项目主线是 RAG/Agent 应用工程，不做模型训练。” |

### 后续真要补强的内容

1. **真实游戏业务知识包**：历史活动复盘、组件规范、埋点规范、接口规范、上线事故、地区适配文档。
2. **真实毒题集**：奖励概率、返利比例、预算、活动时间、地区合规、接口异常、埋点遗漏、客服投诉等 50-100 条。
3. **Agent 轨迹评测看板**：task success rate、step accuracy、tool success rate、首字延迟、总耗时、引用率、拒答率。
4. **Prompt / Tool 后台化**：Prompt Registry 和 Tool Registry 当前是代码级，后续可做版本管理、灰度、回放、回滚和审计入库。
5. **真实多模态闭环**：OCR、视频抽帧理解、视觉向量、文本搜图 / 以图搜图。
6. **生产化闭环**：灰度、A-B、监控告警、备份、回滚、容量压测、成本预算。

## 高级 Agent 开发查漏补缺矩阵

这一节只对齐 AI 应用开发 / 大模型应用开发 / 高级 Agent 开发，不展开底层算法训练。面试时要把自己定位成「能把模型能力工程化落地的人」，不是「预训练算法研究员」。

| AgentGuide 模块 | 高级 Agent 开发必须会什么 | 当前文档补强口径 | 项目边界 |
|---|---|---|---|
| 12-Factor Agent | 确定性代码控制流程，LLM 只做关键决策 | 自然语言转结构化 tool call、拥有 prompt / context / control flow、统一状态、暂停恢复、错误压缩、小 Agent、无状态 reducer | 项目是本地试点，不是完整 12-Factor 平台 |
| Agent Harness | Model + Loop + Tools + Memory + Policy + Channel + Heartbeat | Harness 决定产品上限，模型只是推理核心 | 当前有 provider、tools、memory、web/admin/CLI/MCP，但自驱层和多通道生产运营不完整 |
| Evaluation Harness | Task、Trial、Transcript、Outcome、Grader、Report | Agent 评测看事情有没有做成，不只看回答 | 当前有 eval 脚本和 task 脚手架，缺线上 shadow/A-B、完整 transcript dashboard |
| Agentic RAG | Naive / Advanced / Modular / Agentic 四代演进 | Agent 判断搜不搜、搜什么、搜够没有、是否二次检索 | 当前更接近受控 Agentic RAG，不是完整 Deep Research 平台 |
| Deep Research | 搜索规划、多源交叉验证、信息饱和、长报告 | Deep Research 是 Agentic RAG 的研究型增强 | 当前可讲设计思路，不说已做长周期研究 benchmark |
| Self-RAG / CRAG | 检索质量判断、反思、纠错搜索 | 工程上对应 sufficiency gate、web search fallback、reflection、extractive fallback | 没有训练 reflection token，不要说论文原版 Self-RAG |
| Skills / 程序性记忆 | Tool / Prompt / Memory / Skill 边界，渐进式披露 | Skill 是可复用 SOP，正文按需加载，减少 token 和 prompt cache 损失 | 项目有 Skills 匹配口径，但不是完整 Claude Code Skills 生态 |
| Skill 安全 | SkillAttack、BadSkill、供应链风险 | Skill 文件本身可能是 prompt injection 来源，需要来源审计、静态扫描、沙箱和权限 | 当前是面试知识补强，生产安全扫描还可继续做 |
| Memory 高级设计 | Working / Episodic / Semantic / Procedural、CoALA、MemGPT、冲突和遗忘 | 不同记忆不同存储和召回，过期不是删除而是退出 active retrieval | 当前有短期 / 长期 / RAG 知识分层，冲突修订和时序图记忆仍待加强 |
| 生产 Agent 数学现实 | 错误复合、上下文二次成本、工具工程占大头 | 限制步骤、拆小任务、预算、回滚点、人工确认、可验证操作 | 不吹全自主长流程，强调受限、可控、可评测 |
| Tool 工程 | AI 友好的工具反馈、分页、摘要、错误恢复 | 工具返回不能是原始 10MB JSON，要有 summary、topN、source id、next token | 真实业务写工具还没接，当前多是检索和只读 |
| Agent 框架选型 | LangGraph、LangChain、AutoGen、CrewAI、Swarm、Parlant、AgentScope | 按任务形态选框架，不按 star 数；生产更看重状态、权限、观测、评测和降级 | 当前项目主线是 LangGraph/FSM，不是多框架平台 |
| Parlant / 合规型 Agent | failure severity、Guidelines、Journeys、Strict Mode、ARQs | 高风险 Agent 要限制最坏失败，越权承诺比普通答错更危险 | 可讲合规设计理念，项目不是金融/医疗真实合规系统 |
| Agent 沙箱 | Docker、microVM/E2B、gVisor/Kata、OpenSandbox、Browser sandbox | 代码执行、本地文件、浏览器操作必须限制文件、网络、secret、资源和审计 | 当前项目主要是工具和 MCP 安全口径，未接完整沙箱平台 |
| 通道层 / 前端 | Web、CLI、IM、Webhook、Queue 共用 Agent Core | 前端要展示 thinking、tool call、citation、error、handoff 和 feedback | 当前主要是 Admin / MCP / CLI，IM/Email 通道未接 |
| 自驱层 | heartbeat、cron、monitor、queue worker | 自驱会放大成本和风险，必须等权限和 eval 成熟后再开 | 当前可讲 BullMQ / job 思路，不说全自主运营 |
| 上线门禁 | Offline diff、Shadow traffic、A/B、Phased rollout | guardrail 触发才 early stop，主指标不能 p-hacking | 当前没有真实线上灰度，只能讲方案和本地门禁 |
| 多模态 Agent | OCR、ASR、图片 caption、视频抽帧、视觉向量、多模态 memory | 多模态首要问题是证据定位和 source span | 当前有 Vision/ASR/TTS 脚手架，真实多模态闭环不足 |
| 多模态证据定位 | page、bbox、figure、table、caption、timestamp、ViDoRe | 多模态 RAG 不只是 OCR，要能回到原页、原图、原表、原时间点 | 当前可讲 page/source span 和 sidecar，bbox/视觉检索仍是增强方向 |
| 数据合成 / 评测集构建 | Self-Instruct、Evol-Instruct、AgenticRAGTracer、Dependency Irreducibility | 应用岗重点是冷启动评测集、边界 case 和失败样本回归；核心是验证，不是生成 | 项目有仿真评测集和失败回流口径，不能冒充真实线上业务集 |
| 企业 Agent 工作流落地 | workflow first、Agent onboarding、step trace、reusable components、human ownership | 先拆业务工作流，再判断规则、RAG、Agent、工具和人审分别放哪里 | 项目是知识协同试点，不是完整企业变革平台 |

### 高级 Agent 开发面试总回答

```text
我理解的高级 Agent 开发，不是把 ReAct prompt 和几个工具接起来，而是设计 Agent Harness：模型层能路由和降级，循环层有步数、超时和恢复，工具层有 schema、权限、幂等和审计，记忆层区分 working / episodic / semantic / procedural，策略层保证安全边界，通道层服务 Web / CLI / MCP 等入口，评测层用 Task / Trial / Transcript / Outcome / Grader 做回归。生产里我会限制全自主长链路，因为多步骤错误会复合，长上下文成本会放大，所以更偏受控状态机、可验证子任务和 human-in-the-loop。
```

### 面试官追问时的边界回答

```text
这部分我不会包装成底层算法训练经验。Self-RAG 的 reflection token、DeepResearch 的 Agentic 后训练、RLHF / DPO / GRPO 属于模型训练方向。我能讲清楚它们解决什么问题，以及在应用工程里怎么用 sufficiency gate、reflection、web search fallback、eval harness 做工程近似，但不会说自己训练了这类模型。
```

### 通用主干闭环说明

```text
到这里为止，高级 Agent 开发的通用面试主干已经覆盖：RAG、Agentic RAG、Deep Research 边界、Agent Harness、Evaluation Harness、Memory、Tool/MCP、Skills、框架选型、合规型 Agent、安全沙箱、多模态证据定位、数据合成 / 评测集构建、企业工作流落地和生产化边界。后续不再按通用知识无限扩展，只按具体公司 JD 和岗位方向做定制化补强。
```

## 优化追问专项

这部分是面试官最容易追问的“工程深水区”：记忆怎么存、缓存怎么做、召回怎么优化、token 怎么省、错了怎么纠错。

### 1. 记忆怎么做？

项目里不是把所有历史消息直接塞进 prompt，而是分层处理：

| 层级 | 存什么 | 怎么存 | 用途 |
|---|---|---|---|
| 对话持久层 | 全量 conversation / message | TypeORM 落 PostgreSQL / MySQL 兼容库 | 历史会话、审计、恢复上下文 |
| 对话缓存层 | 最近会话消息 | Redis `conv:messages:{userId}:{threadId}`，30 分钟 TTL，写入新消息后失效 | 减少频繁查库，提高历史会话读取速度 |
| 短期记忆层 | 最近 N 轮 + 更早摘要 | Redis ZSET `stm:{conversationId}:turns` + String `stm:{conversationId}:summary`，24 小时 TTL | 多轮问答时保留近期细节，把旧历史压缩成摘要 |
| 长期记忆层 | 用户偏好、跨会话事实 | Mem0 provider / MemoryService | 个性化和跨会话复用 |
| 长期知识层 | 文档、文章、官方文档、Obsidian notes | RAG 索引 + Karpathy/Obsidian compiled/index | 稳定知识检索，不混进用户短期对话噪声 |

面试回答：

```text
我的记忆不是一股脑塞上下文，而是按“会话历史、短期记忆、长期记忆、长期知识”分层。全量消息落库保证可追溯；Redis 缓存最近会话减少查库；短期记忆保留最近 N 轮，超出后用 LLM 摘要压缩；长期记忆存用户偏好和跨会话事实；真正稳定的业务知识放在 RAG/Karpathy/Obsidian 里。这样可以兼顾上下文连续性、token 成本和知识稳定性。
```

可指代码：

- `backend/src/modules/chat/conversation.service.ts`
- `backend/src/modules/memory/short-term-memory.service.ts`
- `backend/src/modules/memory/memory.service.ts`
- `backend/src/modules/obsidian/obsidian-knowledge.service.ts`

### 2. 缓存怎么做？

当前项目里缓存分三类：

| 缓存类型 | 当前做法 | 解决什么问题 | 失效策略 |
|---|---|---|---|
| 会话读取缓存 | Redis 缓存 conversation messages，TTL 30 分钟 | 历史会话列表 / 最近上下文读取不用每次查库 | addMessage / delete 时主动删除 |
| 短期记忆缓存 | Redis ZSET 保存 turn，String 保存摘要，TTL 24 小时 | 多轮对话不用每次从 DB 重新拼历史 | 超窗口裁剪 + 摘要压缩 |
| 索引快照缓存 | BM25 index 持久化到 `workspace/bm25-index.json` | 重启后不用从零构建关键词索引 | 文档上传 / 删除时更新 |

面试回答：

```text
缓存不是只为了快，也要避免脏读。对话消息用 Redis 读缓存，写消息后主动删缓存；短期记忆用 Redis ZSET 做滑动窗口，超出窗口裁剪并写摘要；BM25 索引做磁盘快照，服务重启后恢复关键词检索能力。真正要继续优化的话，可以加 query result cache 和 semantic cache，但要注意权限、用户隔离、文档更新失效和引用一致性。
```

后续可补但当前不要硬说已完成：

- Query result cache：同一用户、同一权限集合、同一 query fingerprint 命中缓存。
- Semantic cache：相似问题复用答案，但必须校验文档版本和权限。
- Embedding cache：相同 chunk hash 复用 embedding，降低入库成本。
- Rerank cache：query + chunk ids 相同复用 rerank 结果。

### 3. 召回怎么优化？

项目里召回优化分为“召回前、召回中、召回后”：

| 阶段 | 优化点 | 当前项目做法 |
|---|---|---|
| 召回前 | Query Normalize | 统一 query 清洗，减少格式噪声 |
| 召回前 | Query Augment | Agentic 模式下把复杂问题改写成多个互补检索问句 |
| 召回中 | Hybrid Search | BM25/ES 召回精确词，Milvus 召回语义相似 |
| 召回中 | 多路召回 topK * 2 | 先多召回，再融合，减少早期截断 |
| 召回中 | RRF 融合 | 不直接相加不同检索器分数，用 reciprocal rank 融合排名 |
| 召回中 | 权限过滤 | userId / ACL 限制，避免召回无权限文档 |
| 召回后 | Source Authority | 对来源权重做补偿，提升可信来源 |
| 召回后 | Rerank | DashScope Rerank 精排，失败不阻塞 |
| 召回后 | Sufficiency Gate | 判断证据是否足够回答，不够就 fallback |
| 召回后 | GraphRAG | 用图谱补活动、页面、接口、埋点、风险之间的关系 |

面试回答：

```text
我没有只做向量召回。召回前先做 query normalize 和 query augment；召回中用 BM25/ES + Milvus 多路召回，再用 RRF 融合，避免不同分数体系直接相加；召回后做来源权重、Rerank、充分性判断和引用校验。复杂业务问题还会用 GraphRAG 补关系，比如抽奖活动关联页面模块、接口、埋点和风险项。
```

如果被问 BM25 / RRF：

```text
BM25 解决精确词、专有名词、组件名、埋点名、制度编号这类向量容易模糊的问题。RRF 的好处是不依赖不同召回器的绝对分数可比，只看各自排名，把 BM25 和向量结果按排名融合，工程上更稳定。
```

可指代码：

- `backend/src/rag/karpathy/karpathy-rag.service.ts`
- `backend/src/rag/karpathy/bm25.util.ts`
- `backend/src/providers/elasticsearch/elasticsearch.provider.ts`
- `backend/src/tools/dashscope-rerank.service.ts`

### 4. Token 怎么节省？

项目里的 token 节省不是靠一个点，而是多层控制：

| 位置 | 节省方式 | 当前项目做法 |
|---|---|---|
| 路由层 | 简单问题不进复杂 Agent | `auto` 默认简单问题走 simple fast path |
| 检索层 | 控制候选数量 | `topK`、`maxRetrievedChunks`、`maxRerankTopN` 控制上下文规模 |
| 多查询层 | 控制 query augment 数量 | `maxAugmentedQueries`、`maxRetrievalQueries` |
| 记忆层 | 历史摘要压缩 | 最近 N 轮保留原文，更早历史压缩成 100 字摘要 |
| 上下文层 | 片段截断 | sufficiency / reflection 只取片段前 500/800 字做判断 |
| 生成层 | 抽取式兜底 | 明确事实题可直接抽取，不一定都让 LLM 长篇生成 |
| 工具层 | 失败降级 | Rerank/Web Search/key 缺失不阻塞主链路 |
| 可观测层 | token 估算 | Prometheus / QA cost summary 记录估算 token |

面试回答：

```text
Token 优化我主要从路由、上下文和记忆三层做。路由上 simple/auto/agentic 分层，简单问题不走复杂 Agent；上下文上控制 topK、maxRetrievedChunks、Rerank topN，只把高质量片段放进 prompt；记忆上保留最近 N 轮，旧历史摘要压缩，避免全量历史塞进去。对于明确事实题，还会优先抽取式回答，避免让模型长篇生成。
```

如果继续追问怎么量化：

```text
项目里有 query log / cost summary 和 Prometheus token 估算指标。更完整的生产方案是按用户、租户、模式统计 input/output token、首字延迟、总耗时、召回数量、rerank 数量和失败率，再用这些数据反推 simple/auto/agentic 的路由阈值。
```

可指代码：

- `backend/src/modules/memory/short-term-memory.service.ts`
- `backend/src/rag/agentic/agentic-rag.service.ts`
- `backend/src/modules/metrics/metrics.service.ts`
- `backend/src/modules/rag-admin/query-log.service.ts`

### 5. 纠错机制怎么做？

项目里的纠错不是“生成错了再让模型道歉”，而是前中后多道闸门：

| 位置 | 纠错点 | 当前项目做法 |
|---|---|---|
| 检索不足 | Sufficiency Gate | 证据不足时不直接生成确定答案 |
| 检索失败 | BM25 fallback | Milvus 失败时回退 BM25/ES |
| 外部工具失败 | Tool fallback | Bocha / Rerank 缺 key 或失败时降级，不阻塞 |
| 证据不足 | Web Search Fallback | 本地证据不足时可联网补充 |
| 引用不足 | Citation Gate | 答案没有片段引用时回退抽取式回答或拒答 |
| 事实冲突 | Version Conflict Notice | 发现版本冲突时提示用户注意 |
| 生成质量 | Reflection | 对答案置信度、完整性、引用支撑做二次评估 |
| 安全攻击 | Prompt Injection Guard | 检索片段有注入风险时脱敏并隔离 |

面试回答：

```text
我把纠错拆在链路里，而不是只靠最后再问一次模型。检索阶段有 sufficiency gate，不够就 web search fallback 或拒答；Milvus / Rerank / Web Search 失败都有降级；生成后做 citation gate，如果答案没有引用支撑，会回退为片段抽取式回答或给出无法可靠回答；Agentic 模式还有 reflection 判断置信度和是否重试。这样比单纯 prompt 里写“请不要胡编”更稳。
```

如果被追问 Self-RAG / CRAG：

```text
严格论文意义上的 Self-RAG 会在生成过程中插入 reflection tokens；我的项目没有训练这种 token，但工程上实现了类似的 gate：先判断是否需要复杂链路，再判断检索是否充分，生成后判断引用是否支撑，最后 reflection 决定是否通过。CRAG 的思想是检索质量差时纠错，我这里对应的是 sufficiency gate + web search fallback + rerank + extractive fallback。
```

可指代码：

- `backend/src/rag/agentic/agentic-rag.service.ts`
- `backend/src/rag/prompts/agentic.prompts.ts`
- `backend/src/rag/prompts/prompt-injection.guard.ts`
- `backend/src/tools/tool-registry.ts`

### 6. 数据更新和索引一致性怎么做？

RAG 面试经常会问：文档更新、删除、重建索引时怎么保证不搜到旧数据。

当前项目已有基础：

| 问题 | 当前做法 | 面试边界 |
|---|---|---|
| 文档新增 | 上传后解析 chunk，写 DB / Milvus / BM25 / ES / Karpathy / Obsidian | 本地链路完整，生产要加异步状态和补偿重试 |
| 文档删除 | BM25 按 docId 重建用户索引，检索时按 userId / active 过滤 | 向量库和 ES 的删除一致性要靠任务状态校验 |
| 重复入库 | Obsidian `content_hash + rag_doc_id` 复用，减少重复写入 | 真实生产还要做 chunk hash 和 embedding cache |
| 官方文档更新 | 按 URL 内容 hash 判断新增 / 修改 | 当前是官方文档同步，业务文档还要接真实源系统 |
| 索引重建 | BM25 有磁盘快照，服务重启后恢复 | Milvus / ES 重建需要生产级任务编排和进度看板 |

面试回答：

```text
我把文档状态和索引状态分开看。文档进入系统后先落库，再解析 chunk，最后同步到 Milvus、BM25/ES、Karpathy/Obsidian。新增、删除和更新都要围绕 docId、userId、content_hash 做幂等控制。删除时不能只删 DB，还要清理关键词索引、向量索引和缓存；如果某个索引失败，文档任务状态要标出来，后续补偿重试。当前项目已有 BM25 快照、content_hash 去重和异步队列基础，生产上还要补完整索引状态机和失败重放。
```

可指代码：

- `backend/src/modules/document/document.service.ts`
- `backend/src/rag/karpathy/karpathy-rag.service.ts`
- `backend/src/modules/obsidian/obsidian-knowledge.service.ts`
- `backend/src/modules/official-docs-sync/official-docs-sync.service.ts`

### 7. 权限过滤怎么做？

企业 RAG 很容易被问：检索阶段怎么保证用户看不到无权限文档。

面试回答：

```text
权限过滤不能只在前端做，也不能只在生成后做脱敏。我的设计是检索前和检索中都带 userId / ACL：文档有 public、user、role、department 等权限维度，检索时按 userId 过滤候选 docId，Milvus、BM25/ES、文档详情都要保持同一套用户边界。缓存也要带 userId，避免 A 用户的缓存被 B 用户复用。真正生产落地还要接公司 IAM、组织树、部门继承和审计。
```

可指代码：

- `backend/src/modules/document/document-permission.service.ts`
- `backend/src/rag/karpathy/karpathy-rag.service.ts`
- `backend/src/modules/chat/conversation.service.ts`

不要硬说：

```text
已经满足金融级权限合规。
```

更稳说法：

```text
项目有基础 ACL 和 userId 隔离，生产级权限需要接真实组织系统、IAM、DLP 和审计口径。
```

### 8. 噪声文档和低质量内容怎么处理？

RAG 不是文档越多越好，噪声会拖垮召回和生成。

当前项目处理点：

| 噪声类型 | 处理思路 |
|---|---|
| 无关文档 | 检索质量 gate，不够则拒答 / fallback |
| 低质量片段 | Rerank、source authority、引用校验 |
| Prompt injection | 检索片段 sanitize，不可信证据隔离 |
| 重复资料 | content_hash / Obsidian 去重 |
| 版本冲突 | version conflict notice / fact conflict 评测 |
| 具体规则缺依据 | 低相关拒答，标记待确认 |

面试回答：

```text
RAG 里的噪声我会分两类：一类是检索噪声，靠 hybrid search、rerank、source authority 和 sufficiency gate 控制；另一类是内容风险，比如旧版本、冲突规则、prompt injection、无来源的具体数值，这类靠引用校验、版本冲突提示和拒答策略处理。游戏活动场景里尤其不能让模型编概率、预算和活动时间，所以没有依据的具体规则必须标记待确认。
```

### 9. 时效性和新旧知识冲突怎么处理？

面试官可能会问：旧文档和新文档冲突，模型该信谁？

面试回答：

```text
我会从 metadata 和回答策略两层处理。入库时保留 source、createdAt、updatedAt、version、业务分类等 metadata；检索后如果发现同一事实存在多个版本，不能直接混在一起回答，要提示版本冲突，优先选择更新时间更近、来源更权威、业务状态更明确的文档。对于活动规则、奖励概率、地区口径这种强时效内容，如果没有明确来源和版本，就不输出确定结论。
```

当前项目可以讲：

- 项目评测里有 conflict 类问题。
- `addVersionConflictNotice` 会给版本冲突加提示。
- Obsidian compiled 层有版本 / 语义冲突信号基础检查。

可指代码：

- `backend/src/rag/karpathy/karpathy-rag.service.ts`
- `backend/scripts/eval-rag-project.mjs`
- `backend/src/modules/obsidian/obsidian-knowledge.service.ts`

### 10. Chunk 策略怎么设计？

这是 RAG 基础但常被问深。

面试回答：

```text
Chunk 不是固定切 500 字就完事。我会根据文档类型做策略：制度类和 FAQ 保留完整条款；技术文档按标题层级切；表格和清单尽量保留行列语义；游戏活动方案要让玩法、页面模块、接口、埋点和风险项不要被切断。chunk 太小会丢上下文，太大会影响召回精度和 token 成本，所以要结合命中率、引用率、拒答率和人工 bad case 调。
```

可扩展说法：

```text
后续可以做 parent-child chunk：小 chunk 用于召回，大 parent chunk 用于回答；也可以保留 sourceStart/sourceEnd，方便引用定位和 UI 高亮。
```

项目现状：

- 已有结构化 chunk/source span 成熟度检查。
- 文档解析和 chunk 入库链路已完成。
- 生产还需要用真实 bad case 调 chunk size、overlap 和 parent-child 策略。

### 11. 高并发和低延迟怎么优化？

面试官常问：为什么回答慢，怎么优化首字延迟和总耗时。

面试回答：

```text
我会先分首字延迟和总耗时。首字延迟主要受路由、记忆检索、检索、rerank、LLM 首 token 影响；总耗时主要受生成长度和工具调用影响。项目里做了 simple/auto/agentic 路由，简单问题不进复杂链路；SSE 真实流式输出，先让用户看到首 token；长期记忆检索设置超时，不阻塞回答；Rerank / Web Search 都可降级；异步文档处理走 BullMQ，避免上传解析阻塞主请求。
```

可继续补：

```text
生产上还会做连接池、向量库 warmup、索引预加载、query cache、embedding cache、模型超时、熔断、队列削峰和限流。优化顺序不是拍脑袋，要看 trace 里每个节点的耗时占比。
```

可指代码：

- `backend/src/rag/agentic/agentic-rag.service.ts`
- `backend/src/modules/agui/agui.service.ts`
- `backend/src/modules/metrics/metrics.service.ts`
- `backend/src/modules/document-queue/`

### 12. 成本治理怎么做？

成本问题通常从 token、外部工具、模型路由三个角度问。

面试回答：

```text
成本治理不是只换便宜模型。第一层是路由，简单问题走 simple，复杂问题才走 agentic；第二层是上下文控制，topK、maxRetrievedChunks、rerankTopN、历史摘要压缩；第三层是工具预算，web search、rerank、query augment 都有数量上限；第四层是可观测，按模式统计 token、调用次数、失败率和延迟。生产上再加租户级 quota、告警和成本报表。
```

项目现状：

- 有 `maxAugmentedQueries`、`maxRetrievalQueries`、`maxRetrievedChunks`、`maxWebSearchResults`、`maxRerankTopN`。
- 有 query log / cost summary 和 Prometheus token 估算。
- 还没有完整租户级成本预算平台。

### 13. 工具调用失败怎么处理？

面试官问 Tool Use，经常会追问失败、超时、权限和回滚。

面试回答：

```text
我的原则是工具失败不能拖垮主链路。每个工具要有风险等级、权限、超时、审计和 fallback。比如 Rerank 失败就用 RRF 融合结果，Bocha 没 key 就跳过联网搜索，GraphRAG 不可用就回退文档证据，MCP server 不可用就禁用对应工具。对写操作或高风险工具，生产上必须 human-in-the-loop，不能让模型直接执行。
```

可指代码：

- `backend/src/tools/tool-registry.ts`
- `backend/src/tools/dashscope-rerank.service.ts`
- `backend/src/tools/bocha-search.service.ts`
- `backend/src/providers/mcp/mcp.provider.ts`

### 14. 可观测和问题定位怎么做？

面试官可能问：用户说答错了，你怎么定位？

面试回答：

```text
我会把一次回答拆成可追踪链路：query、route、retrieved chunks、BM25/向量分数、RRF/Rerank 结果、sufficiency 判断、web search、生成答案、citation gate、reflection、token 和 latency。用户说答错时，先看是不是没召回、召回了但排序错、证据够但生成错、引用不足、还是权限过滤导致证据缺失。没有 trace 的 RAG 很难运营。
```

项目现状：

- AG-UI/SSE 有节点事件。
- Prometheus 记录检索、LLM、token 估算等指标。
- LangFuse / LangSmith 有可选接入和评测导出。
- 还缺完整线上 trace 看板和 bad case 回流闭环。

可指代码：

- `backend/src/modules/agui/agui.service.ts`
- `backend/src/modules/metrics/metrics.service.ts`
- `backend/src/providers/observability/langfuse.provider.ts`
- `backend/scripts/eval-rag-langsmith.mjs`

### 15. 评测、灰度和上线门禁怎么做？

只说“我本地测过”不够，大厂会问上线怎么防回归。

面试回答：

```text
我会把评测分成离线和线上两层。离线有固定评测集，覆盖关键词命中、引用、拒答、冲突、prompt injection、工具降级和游戏营销专项问题；每次改 prompt、retrieval、rerank、chunk 策略都要跑 gate。线上则看 bad case、人工反馈、引用点击、拒答率、满意度、首字延迟和工具失败率。灰度上可以先 shadow traffic，再小流量 A/B，最后全量。
```

项目现状：

- 已有 `eval:rag:project`、`eval:prompt-injection`、`eval:agent-tasks`、`eval:game-marketing`、`enterprise:readiness`。
- 还没有真实线上 shadow traffic / A-B 实验平台。

### 16. 多 Agent 冲突怎么处理？

如果你讲多 Agent，面试官很容易追问：两个 Agent 结论不一致怎么办？

面试回答：

```text
我不会让多个 Agent 自由争论到最后。当前项目是 Supervisor 选择领域和 Agent 子集，researcher、analyst、writer、critic、editor 顺序执行。冲突处理主要靠 critic 检查遗漏、引用和风险，editor 合并输出。后续如果做更复杂的多 Agent，可以引入结构化中间结果、置信度、证据引用、投票或仲裁器；但企业场景我更倾向可控管线，而不是完全自治聊天。
```

当前边界：

- 有多 Agent 管线和 Supervisor。
- 没有 A2A。
- 没有复杂冲突投票和仲裁器。

### 17. GraphRAG 图谱怎么更新？

GraphRAG 不是建完就不动，面试会问实体关系怎么维护。

面试回答：

```text
GraphRAG 更新分三步：先定义 schema，包括实体类型、关系类型和别名规则；再从文档、活动模板、Obsidian entities/topics/tags 里抽取实体关系；最后通过 GraphOps 做运营校正。查询时向量检索找相似模板，图谱负责补全关系链和遗漏项。生产上还要解决实体合并、别名消歧、冲突关系、来源追踪和人工审核。
```

项目现状：

- 有 Neo4j provider、Graph service、GraphOps、种子数据和节点编辑。
- Obsidian 可以导出 GraphRAG seed。
- 真实业务图谱数据源还需要接公司历史活动和规范文档。

可指代码：

- `backend/src/modules/graph/graph.service.ts`
- `backend/src/providers/neo4j/neo4j.provider.ts`
- `admin/src/pages/graph-ops/index.tsx`
- `backend/src/modules/obsidian/obsidian-knowledge.service.ts`

### 18. 如果问“还能怎么优化？”

不要说“都做完了”，更好的回答是：

```text
下一步我会补五类优化：第一，语义缓存、embedding cache、rerank cache，降低重复问题和重复文档入库成本；第二，把 Agent 轨迹指标产品化，统计 task success rate、step accuracy、tool success rate、引用率、拒答率和首字延迟；第三，把 Prompt Registry / Tool Registry 后台化，支持版本、灰度、回放、回滚和危险工具二次确认；第四，接真实活动复盘和线上问题，形成失败样本回流，让召回、拒答和 GraphRAG 关系持续校准；第五，补真实生产的灰度、A-B、监控告警、成本预算和容量压测。
```

## 优化追问速答卡片

这一节可以直接当面试背诵卡。前面是展开方案，这里是面试官问到时的短答案。

### Q1：你的记忆系统怎么设计？

```text
我把记忆分成四层：第一层是全量对话落库，保证历史可追溯；第二层是 Redis 会话缓存，提升最近会话读取速度；第三层是短期记忆，用 Redis ZSET 保存最近 N 轮，更早历史用 LLM 压缩成摘要；第四层是长期记忆和长期知识，用户偏好进 Mem0，稳定业务知识进 RAG/Karpathy/Obsidian。这样不会把所有历史都塞进 prompt，可以兼顾连续对话、token 成本和知识稳定性。
```

### Q2：缓存怎么做？怎么避免缓存脏数据？

```text
项目里主要有三类缓存：会话消息 Redis 缓存、短期记忆 Redis 缓存、BM25 索引快照。会话缓存的 key 带 userId 和 threadId，TTL 30 分钟，写入新消息或删除会话时主动失效，避免脏读。短期记忆用 ZSET 保存 turn，超窗口后裁剪并摘要。BM25 持久化到本地快照，服务重启后恢复关键词索引。后续如果做 query cache 或 semantic cache，必须把用户权限、文档版本和 content hash 放进 cache key，否则容易越权或引用旧答案。
```

### Q3：召回优化你做了哪些？

```text
我按召回前、召回中、召回后来做。召回前做 query normalize 和 query augment，把复杂问题拆成多个互补检索问句；召回中用 BM25/ES 召回精确词，用 Milvus 召回语义相似，再用 RRF 融合排名；召回后做 source authority、rerank、sufficiency gate 和引用校验。业务关系类问题再用 GraphRAG 补玩法、页面模块、接口、埋点和风险项之间的关系。
```

### Q4：为什么不用纯向量检索？

```text
纯向量适合语义相似，但容易漏组件名、埋点名、地区名、制度编号、接口字段这类精确词。游戏活动和官网营销场景里，很多问题必须命中精确名称，所以我用 BM25/ES 补关键词召回，用向量召回相似经验，再用 RRF 融合。这样既能找相似模板，也能保证关键名词不漏。
```

### Q5：RRF 是什么，为什么用它？

```text
RRF 是 Reciprocal Rank Fusion，它不直接比较 BM25 分数和向量相似度分数，因为这两个分数体系不一样，直接相加不稳定。RRF 更关注每个召回器里的排名，把不同召回源的排名融合起来。工程上它比手调权重更稳，特别适合 BM25、ES、Milvus 多路召回。
```

### Q6：Token 怎么省？

```text
我主要从路由、上下文和记忆三层省 token。路由上 simple/auto/agentic 分层，简单问题不走复杂 Agent；上下文上限制 topK、maxRetrievedChunks、rerankTopN，只把高质量片段放进 prompt；记忆上只保留最近 N 轮原文，更早历史压缩成摘要。明确事实题能抽取就抽取，不让模型长篇生成。项目里也有 token 估算和 cost summary，后续可以按租户做预算和告警。
```

### Q7：回答错了怎么纠错？

```text
我不是只在 prompt 里写“不要胡编”，而是在链路里加闸门。检索阶段有 sufficiency gate，证据不足不直接生成；Milvus 失败会回退 BM25/ES；Rerank 和 Web Search 失败不阻塞主链路；生成后做 citation gate，如果答案没有引用支撑，会回退为抽取式回答或拒答；Agentic 模式最后还有 reflection 判断置信度和是否需要重试。
```

### Q8：Self-RAG / CRAG 你项目里有吗？

```text
严格论文意义上的 Self-RAG 需要模型在生成过程中输出 reflection tokens，我这个项目没有训练这种 token，所以不能硬说实现了原版 Self-RAG。但工程思想是类似的：先判断是否需要复杂链路，再判断检索是否充分，生成后判断引用是否支撑，最后 reflection 做质量检查。CRAG 的核心是检索质量差时纠错，我这里对应的是 sufficiency gate + web search fallback + rerank + extractive fallback。
```

### Q9：文档更新后怎么保证索引一致？

```text
我会围绕 docId、userId、content_hash 做幂等。文档先落库，再解析 chunk，之后同步 Milvus、BM25/ES、Karpathy/Obsidian。新增、更新、删除都要更新索引状态；删除不能只删 DB，还要清理关键词索引、向量索引和缓存。当前项目已有 BM25 快照、content_hash 去重和异步队列基础，生产上还要补完整索引状态机、失败补偿和重放机制。
```

### Q10：权限过滤怎么做？

```text
权限过滤不能只在前端做，也不能等生成后再脱敏。我的设计是检索阶段就带 userId 和 ACL，文档按 public、user、role、department 等维度授权，Milvus、BM25/ES、文档详情和缓存都要绑定用户边界。缓存 key 也要带 userId，避免 A 用户命中 B 用户的结果。当前项目有基础 ACL 和 userId 隔离，生产要接真实 IAM、组织树、部门继承和审计。
```

### Q11：噪声文档怎么处理？

```text
噪声分两类：检索噪声和内容风险。检索噪声靠 hybrid search、rerank、source authority、sufficiency gate 控制；内容风险比如旧版本、冲突规则、prompt injection、无来源的概率和预算，靠引用校验、版本冲突提示、prompt injection guard 和拒答策略处理。游戏活动场景尤其不能编具体规则，没有依据的具体数值必须标记待确认。
```

### Q12：新旧知识冲突怎么办？

```text
我会优先看 metadata，包括来源、更新时间、版本、业务状态和权威程度。如果同一事实存在多个版本，不能混在一起直接回答，要提示版本冲突，优先采用更新时间更新、来源更权威、状态更明确的文档。对于活动时间、奖励概率、预算、地区合规这类强时效内容，如果没有明确来源和版本，就不要输出确定结论。
```

### Q13：Chunk 策略怎么设计？

```text
Chunk 不是固定切多少字。制度类和 FAQ 要保留完整条款，技术文档按标题层级切，表格和清单要保留行列语义，游戏活动方案要避免把玩法、接口、埋点、风险项切断。chunk 太小会丢上下文，太大会影响召回精度和 token 成本。后续可以做 parent-child chunk：小 chunk 用于召回，大 parent chunk 用于回答，并保留 sourceStart/sourceEnd 做引用定位。
```

### Q14：高并发和低延迟怎么优化？

```text
我会分首字延迟和总耗时看。首字延迟受路由、记忆检索、检索、rerank、LLM 首 token 影响；总耗时受生成长度和工具调用影响。项目里 simple/auto/agentic 分层，简单问题不进复杂链路；SSE 做真实流式输出；记忆检索设置超时，不阻塞回答；rerank、web search 都可降级；文档解析入库走 BullMQ 异步队列。生产上还要做连接池、向量库 warmup、query cache、限流、熔断和容量压测。
```

### Q15：成本治理怎么做？

```text
成本治理不是只换便宜模型。第一层是路由，简单问题走 simple，复杂问题才走 agentic；第二层是上下文控制，限制 topK、maxRetrievedChunks、rerankTopN；第三层是工具预算，限制 query augment、web search、rerank 数量；第四层是可观测，统计不同模式下的 token、调用次数、失败率和延迟。生产上再加租户级 quota、告警和成本报表。
```

### Q16：工具调用失败怎么办？

```text
每个工具都要有风险等级、权限、超时、审计和 fallback。Rerank 失败就用 RRF 结果，Bocha 没 key 就跳过联网搜索，GraphRAG 不可用就回退文档证据，MCP server 不可用就禁用对应工具。对写操作、删数据、发消息、付款这类高风险工具，生产上必须 human-in-the-loop，不能让模型直接执行。
```

### Q17：用户说答错了，你怎么定位？

```text
我会按链路排查：先看 route 是 simple 还是 agentic，再看 retrieved chunks 有没有召回正确证据，再看 BM25/向量/RRF/Rerank 分数和排序，再看 sufficiency 判断、web search、citation gate、reflection。答错通常分几类：没召回、召回了但排序错、证据够但生成错、引用不足、权限过滤导致证据缺失、或者知识本身过期。没有 trace 的 RAG 很难运营，所以项目里保留 AG-UI 事件、Prometheus 指标和可选 LangFuse/LangSmith。
```

### Q18：评测和上线门禁怎么做？

```text
我会分离线评测和线上监控。离线评测覆盖关键词命中、引用、拒答、冲突、prompt injection、工具降级和游戏营销专项问题；每次改 prompt、retrieval、rerank、chunk 策略都要跑 gate。线上看 bad case、人工反馈、引用点击、拒答率、满意度、首字延迟和工具失败率。灰度上可以先 shadow traffic，再小流量 A/B，最后全量。
```

### Q19：多 Agent 冲突怎么处理？

```text
我不会让多个 Agent 自由争论到最后。当前项目是 Supervisor 选择领域和 Agent 子集，researcher、analyst、writer、critic、editor 顺序执行。冲突主要由 critic 检查遗漏、引用和风险，editor 做最终合并。后续如果做复杂多 Agent，可以让每个 Agent 输出结构化结论、证据和置信度，再由仲裁器合并；但企业场景我更倾向可控管线，而不是完全自治聊天。
```

### Q20：GraphRAG 图谱怎么更新？

```text
GraphRAG 先要定义 schema，包括实体类型、关系类型和别名规则；然后从活动模板、文档、Obsidian entities/topics/tags 中抽取实体关系；最后通过 GraphOps 做人工校正。查询时向量检索找相似模板，图谱负责补齐活动玩法、页面模块、接口、埋点、风险和地区之间的关系。生产上还要解决实体合并、别名消歧、冲突关系、来源追踪和人工审核。
```

### Q21：如果数据量继续变大，你怎么扩展？

```text
我会从数据、索引、服务三层扩展。数据层做分租户、分业务域、冷热数据分层；索引层做分 collection、分 shard、定期 compact 和离线重建；服务层做异步入库、队列削峰、检索超时、降级和缓存。评测上要持续看召回率、引用率、拒答率、延迟和成本，不是数据越多越好，噪声数据反而会降低质量。
```

### Q22：这个项目最大的技术难点是什么？

```text
最大的难点不是接模型，而是把“不稳定的业务规则”和“稳定的业务模式”分开。游戏活动每次奖励、概率、预算都变，不能让 RAG 编具体规则；但活动类型、营销玩法、页面模块、接口、埋点、地区适配和验收清单是稳定可沉淀的。所以我用 Hybrid Search 找相似模板，用 GraphRAG 补关系，用 Agentic Workflow 组织方案，用引用校验和拒答控制幻觉。
```

## 具体落地方案

这一节回答“方案具体怎么做”。面试时可以先讲上一节速答，如果面试官继续追问，再展开这里。

### 方案 1：记忆系统落地方案

目标：既能支持多轮对话，又不把全部历史塞进 prompt。

流程：

```text
用户提问
  -> 根据 threadId / userId 读取最近会话
  -> Redis 读取短期记忆 summary + 最近 N 轮 turns
  -> Mem0 搜索长期用户偏好 / 历史事实
  -> RAG / Obsidian 搜索稳定业务知识
  -> 拼 prompt：system policy + memory summary + recent turns + retrieved evidence
  -> 回答后写入 DB + Redis 短期记忆
  -> 满足条件时抽取长期记忆写入 Mem0
```

数据结构：

```text
conversation_messages:
  id / conversationId / userId / role / content / createdAt

Redis:
  conv:messages:{userId}:{threadId} -> conversation json, TTL 30min
  stm:{conversationId}:turns -> ZSET, score=timestamp, value={role,content,ts}
  stm:{conversationId}:summary -> string, TTL 24h

Long memory:
  userId / sessionId / type / content / confidence / source / createdAt
```

关键策略：

- 最近 N 轮保留原文，保证追问上下文准确。
- 超过窗口的旧消息压缩成摘要，降低 token。
- 长期记忆只存稳定偏好、事实、决策，不存临时寒暄。
- 企业知识不混进用户记忆，放 RAG / Obsidian。
- Redis 不可用时降级，不阻断问答。

面试答案：

```text
我的记忆系统按生命周期分层：全量对话落 DB，保证可追溯；最近会话用 Redis 缓存，提升读取速度；短期记忆用 Redis ZSET 保存最近 N 轮，旧历史摘要压缩；长期记忆用 Mem0 存用户偏好和跨会话事实；稳定业务知识放 RAG/Obsidian。这样不会把所有历史塞进 prompt，也避免用户临时上下文污染企业知识库。
```

当前项目状态：

- 已有：DB 会话、Redis 会话缓存、短期记忆摘要、Mem0 provider、Obsidian/Karpathy。
- 未完整：记忆衰退、记忆冲突消解、用户可编辑记忆审核流。

### 方案 2：缓存系统落地方案

目标：降低重复查询、减少 DB / LLM / Embedding 成本，同时不越权、不返回旧答案。

缓存分层：

```text
L1 会话缓存：
  key = conv:messages:{userId}:{threadId}
  value = conversation json
  TTL = 30min
  失效：addMessage/deleteConversation

L2 短期记忆缓存：
  key = stm:{conversationId}:turns / summary
  TTL = 24h
  失效：clearConversation / 超窗口裁剪

L3 索引缓存：
  BM25 snapshot = workspace/bm25-index.json
  失效：document upload/delete 后更新

L4 可扩展查询缓存：
  key = hash(userId + aclVersion + queryFingerprint + indexVersion + mode)
  value = answer + references + retrieval metadata
  TTL = 5-30min
```

关键点：

- cache key 必须带 userId / ACL 版本，避免越权。
- 答案缓存必须带 indexVersion / docVersion，避免文档更新后返回旧答案。
- 对生成答案做缓存要保留 references，不能只缓存纯文本。
- 语义缓存适合 FAQ 类问题，不适合强时效问题。

面试答案：

```text
缓存我不会只按 query 做 key，因为企业 RAG 有权限和文档版本问题。当前项目已经有会话缓存、短期记忆缓存和 BM25 索引快照。后续做 query cache 时，key 会包含 userId、权限版本、query fingerprint、索引版本和模式；value 里必须包含答案、引用和检索元数据。文档更新或权限变化时，要通过版本号或主动失效避免返回旧答案和越权答案。
```

当前项目状态：

- 已有：conversation Redis cache、short-term memory Redis、BM25 snapshot。
- 待补：query result cache、semantic cache、embedding cache、rerank cache。

### 方案 3：召回优化落地方案

目标：提高 recall，同时控制噪声和成本。

完整链路：

```text
query
  -> normalize
  -> intent/domain detect
  -> simple: 单 query 检索
  -> agentic: query augment 生成 2-4 个互补问句
  -> BM25/ES keyword recall topK*2
  -> Milvus vector recall topK*2
  -> ACL filter / active doc filter
  -> RRF fusion
  -> source authority boost
  -> rerank topN
  -> sufficiency gate
  -> GraphRAG relation expansion
  -> final evidence chunks
```

关键策略：

- BM25/ES 负责精确词：组件名、埋点、地区、接口字段。
- Milvus 负责语义相似：相似活动模板、相似技术方案。
- RRF 融合排名，避免不同分数体系硬相加。
- Rerank 精排，但失败不阻断。
- GraphRAG 用于补关系，不替代文档证据。
- Sufficiency gate 判断证据是否足够，不够则 fallback 或拒答。

面试答案：

```text
召回优化我用多路召回加质量闸门。先 normalize query，复杂问题做 query augment；然后 BM25/ES 和 Milvus 并行召回，BM25 保证精确词，向量保证语义相似；再用 RRF 融合排名，避免分数不可比；之后 rerank、source authority 和 sufficiency gate 控制质量。对于活动玩法、页面模块、接口、埋点之间的关系，再用 GraphRAG 做关系补全。
```

当前项目状态：

- 已有：BM25/ES、Milvus、RRF、Rerank、Sufficiency、GraphRAG。
- 待补：真实 bad case 回流、真实 GraphRAG 数据源、按业务域动态 topK。

### 方案 4：Token 节省落地方案

目标：降低成本，同时保持答案质量。

控制点：

```text
请求入口：
  mode=auto
  简单问题 -> simple fast path
  复杂问题 -> agentic

检索阶段：
  maxAugmentedQueries
  maxRetrievalQueries
  maxRetrievedChunks
  maxRerankTopN

记忆阶段：
  recent turns 原文保留
  old turns 摘要压缩

上下文阶段：
  chunk content 截断
  去重相似 chunk
  只传 evidence，不传完整文档

生成阶段：
  明确事实 -> extractive answer
  复杂方案 -> structured generation
```

可量化指标：

```text
input tokens / output tokens
首字延迟 / 总耗时
平均 retrieved chunks
rerank topN
simple/auto/agentic 占比
每次回答成本
```

面试答案：

```text
Token 节省不是简单截断 prompt，而是从路由、检索、记忆和生成四层控制。入口默认 auto，简单问题走 simple，复杂问题才进 agentic；检索层限制 query augment 数、topK、rerankTopN；记忆层只保留最近 N 轮，旧历史摘要；上下文只传高质量 evidence chunk；明确事实题用抽取式回答，避免长篇生成。最后用 token 估算和 cost summary 反推阈值。
```

当前项目状态：

- 已有：auto 路由、topK 参数、摘要压缩、片段截断、抽取式 fallback、token 估算。
- 待补：租户级 quota、成本告警、模型路由成本策略。

### 方案 5：纠错机制落地方案

目标：不要把低质量检索或无依据生成当成确定答案。

链路：

```text
retrieve
  -> no chunks: fallback / refuse
  -> low local score: insufficient
  -> sufficiency LLM judge
  -> insufficient:
       web search fallback if enabled
       else model fallback with uncertainty
  -> generate with evidence
  -> citation gate
       no citation: extractive fallback
       still unsupported: unsupported answer
  -> reflection
       low confidence: retry retrieval if budget allows
       pass: final
```

纠错类型：

| 错误 | 处理 |
|---|---|
| 没召回 | fallback / web search / 拒答 |
| 召回错 | rerank / sufficiency gate |
| 生成编造 | citation gate / extractive fallback |
| 版本冲突 | conflict notice |
| 工具失败 | tool fallback |
| prompt injection | sanitize + ignore injected instruction |

面试答案：

```text
纠错我分检索纠错和生成纠错。检索阶段先判断 chunks 是否足够，不够就 web search fallback 或拒答；Milvus、Rerank、Web Search 失败都有降级；生成阶段要求答案有片段引用，引用不足就回退抽取式回答，仍不支撑就输出 unsupported answer；最后 reflection 评估完整性和置信度，预算允许时重试。这样比只靠 prompt 约束稳定。
```

当前项目状态：

- 已有：sufficiency、web search fallback、rerank fallback、citation gate、extractive fallback、reflection。
- 待补：线上失败样本自动回流、人工标注闭环、step-level 错误统计看板。

### 方案 6：权限过滤落地方案

目标：用户只能检索和引用自己有权限的文档。

流程：

```text
用户请求
  -> auth 解析 userId / role / department
  -> DocumentPermissionService 计算 allowed docIds
  -> BM25/ES/Milvus 检索时带 userId / ACL filter
  -> retrieved chunks 再次校验 doc permission
  -> references 只返回 allowed docs
  -> cache key 带 userId / aclVersion
```

权限模型：

```text
public: 所有人可见
user: 指定用户可见
role: 指定角色可见
department: 指定部门可见
private: owner only
```

面试答案：

```text
权限过滤必须前置到检索阶段，不能生成后再脱敏。我的方案是文档写入时带 owner、role、department、public 等 ACL，查询时根据 userId 计算 allowed docIds，并在 BM25/ES/Milvus 检索和文档详情返回时都做过滤。缓存 key 也带 userId 和权限版本，避免跨用户复用。生产上还要接真实 IAM、组织树和审计系统。
```

当前项目状态：

- 已有：基础 ACL、userId 隔离、权限回显样例。
- 待补：真实组织系统、部门继承、DLP、审批审计。

### 方案 7：索引一致性落地方案

目标：文档新增、更新、删除后，DB / Milvus / ES / BM25 / Obsidian 状态一致。

状态机：

```text
uploaded
  -> parsing
  -> chunked
  -> embedding
  -> indexed_vector
  -> indexed_keyword
  -> indexed_graph_optional
  -> ready
  -> failed_retryable / failed_final
```

关键机制：

- 每个文档有 docId、contentHash、indexVersion。
- chunk 有 chunkId、docId、chunkIndex、sourceStart、sourceEnd。
- 各索引写入要幂等，失败可重试。
- 删除走 tombstone，先标记不可检索，再异步清理各索引。
- 检索时过滤 inactive / deleted 文档。

面试答案：

```text
索引一致性我会用状态机和幂等写入解决。文档上传后不是直接认为可检索，而是经历 parsing、chunking、embedding、vector index、keyword index、ready 等状态；每一步失败都记录，可补偿重试。删除时先把文档标记为不可检索，再异步清理 Milvus、ES、BM25 和缓存，检索层也过滤 inactive 文档。这样不会因为某个索引失败就返回半成品或旧数据。
```

当前项目状态：

- 已有：异步队列基础、BM25 删除重建、content_hash 去重、active 过滤。
- 待补：完整可视化索引状态机、失败重放 UI、生产级补偿任务。

### 方案 8：可观测和排障落地方案

目标：用户说“答错了”时能定位是哪一层错。

Trace 字段：

```text
requestId / traceId
userId / conversationId
mode / route
query / normalizedQuery / augmentedQueries
retrievedChunkIds
bm25Score / cosineScore / rrfScore / rerankScore
sufficiency result
webSearch count
prompt version
model name
input/output token estimate
latency by stage
answer / references
citation gate result
reflection result
```

排障顺序：

```text
1. route 是否正确
2. 是否召回正确 chunk
3. 排序是否把正确 chunk 放前面
4. sufficiency 是否误判
5. prompt / model 是否生成错
6. citation gate 是否拦住
7. 权限是否过滤掉正确文档
8. 文档本身是否过期或冲突
```

面试答案：

```text
RAG 没有 trace 很难运营。我会把一次回答拆成 route、retrieve、rerank、sufficiency、generate、citation、reflection 几段记录。用户说答错时，先看有没有召回正确证据，再看排序和 rerank，再看生成是否偏离证据，最后看引用和权限。项目里已有 AG-UI 事件、Prometheus 指标和可选 LangFuse/LangSmith，生产上会继续做 bad case 回流和线上看板。
```

当前项目状态：

- 已有：AG-UI 事件、metrics、query log、LangFuse optional、LangSmith eval export。
- 待补：完整 trace UI、bad case 标注回流、线上 step accuracy 看板。

### 方案 9：评测和灰度落地方案

目标：改 prompt / retriever / chunk 后不回归。

评测集分层：

```text
基础 RAG：
  关键词命中 / 引用 / 拒答

业务专项：
  游戏活动 / 官网营销 / 地区适配 / 埋点 / 风险

安全专项：
  prompt injection / 越权访问 / 敏感信息

Agent 专项：
  retrieval / refusal / conflict / citation / tool_degrade

线上反馈：
  bad case / 人工标注 / 用户反馈 / 引用点击
```

上线流程：

```text
离线 eval gate
  -> shadow traffic
  -> 小流量 A/B
  -> 指标观察
  -> 全量
  -> bad case 回流评测集
```

面试答案：

```text
我不会只靠感觉调 RAG。每次改 prompt、chunk、retrieval、rerank 都要跑离线评测，覆盖引用、拒答、冲突、prompt injection、工具降级和游戏营销专项问题。上线时先 shadow traffic，再小流量 A/B，观察准确率、引用率、拒答率、首字延迟、工具失败率和用户反馈。失败样本要回流到评测集，形成持续迭代。
```

当前项目状态：

- 已有：项目级评测、prompt injection、agent task、game marketing dataset、readiness gate。
- 待补：真实线上 shadow/A-B、人工标注平台、线上反馈闭环。

### 方案 10：GraphRAG 落地方案

目标：补足向量检索不擅长的关系推理和遗漏项补全。

图谱建模：

```text
Entity:
  ActivityType / Playbook / PageModule / ApiContract
  TrackingEvent / Region / RiskItem / Checklist / Component

Relationship:
  uses / requires / emits / calls / has_risk
  adapts_to / constrains / verifies / depends_on
```

更新流程：

```text
文档 / Obsidian note
  -> 抽取 topics/entities/tags
  -> alias normalize
  -> entity merge
  -> relationship extract
  -> source link
  -> GraphOps 人工校正
  -> query graph
```

使用方式：

```text
用户问：东南亚服新角色抽奖 H5 怎么做？
  -> 向量检索找到相似活动模板
  -> GraphRAG 找到抽奖活动关联的页面模块、接口、埋点、风险、地区适配
  -> Agentic Workflow 组织成技术方案和 checklist
```

面试答案：

```text
GraphRAG 我不会拿来替代向量检索，而是补关系。向量检索负责找相似模板，图谱负责回答“这个玩法还关联哪些页面、接口、埋点、风险和地区差异”。比如新角色抽奖活动，图谱能从 ActivityType 找到抽奖 Playbook，再关联奖池、概率公示、抽奖接口、中奖记录、埋点、客服 FAQ 和地区支付差异，避免方案漏项。
```

当前项目状态：

- 已有：Neo4j provider、Graph service、GraphOps、Graph seed、Obsidian graph seed。
- 待补：真实业务图谱数据源、实体消歧、冲突合并、审核流。

## 面试回答模板

### 1. 你的 RAG 项目怎么做的？

```text
我这个项目不是单纯向量库问答，主链路是：文档/URL/Obsidian/官方文档进入系统后做解析、结构化切片和 metadata 标注，然后写入 Milvus、BM25/ES、Karpathy/Obsidian 索引层。查询时先根据模式走 simple / auto / agentic：普通问题走 fast path，复杂问题进入 LangGraph Agentic RAG。检索阶段用 Milvus 做语义召回，BM25/ES 做关键词召回，RRF 融合后可选 Rerank，最后生成回答时做引用校验和低相关拒答。

业务上我把它收敛到游戏活动和官网营销场景，不沉淀每次变化的具体奖励规则，而是沉淀活动类型、营销玩法、页面模块、接口模式、埋点规范、地区适配和上线验收清单。
```

可指代码：

- `backend/src/rag/karpathy/karpathy-rag.service.ts`
- `backend/src/rag/agentic/agentic-rag.service.ts`
- `backend/src/modules/obsidian/obsidian-knowledge.service.ts`

### 2. 向量、ES、图谱的流程怎么配合？

```text
我没有把向量库当唯一入口。向量召回适合语义相似，比如“新角色抽奖 H5 怎么拆”；BM25/ES 适合精确词，比如组件名、埋点名、制度编号、地区名；GraphRAG 适合关系型补全，比如抽奖活动会关联页面模块、接口、埋点、风险和地区适配。最终用 RRF 融合召回结果，再通过 rerank 和引用校验控制质量。

所以它的分工是：Milvus 找相似经验，BM25/ES 保证关键词不漏，Neo4j 补业务关系，LLM 只负责基于证据组织答案。
```

可指代码：

- `backend/src/providers/vector-store/milvus.vector-store.ts`
- `backend/src/providers/elasticsearch/elasticsearch.provider.ts`
- `backend/src/modules/graph/graph.service.ts`
- `admin/src/pages/graph-ops/index.tsx`

### 3. Agentic RAG 和传统 RAG 有什么区别？

```text
传统 RAG 通常是固定 pipeline：检索一次，把 top-k 塞进 prompt，然后生成。Agentic RAG 的差异是检索过程有决策：是否需要检索、要不要 query augment、证据够不够、要不要 web search fallback、要不要 rerank、生成后要不要 reflection。

我的项目里用 LangGraph 把这些节点做成状态机，而不是让 Agent 无限自由执行。这样好处是可控、可观测、可降级；坏处是灵活性不如完全自治 Agent，但企业场景更需要稳定。
```

可指代码：

- `backend/src/rag/agentic/agentic-rag.service.ts`
- `backend/src/rag/agentic/agentic-rag.state.ts`

### 4. 多 Agent 是怎么协同的？

```text
项目里有 researcher、analyst、writer、critic、editor 五个子 Agent。researcher 负责查资料，analyst 把需求拆成玩法、页面、接口、状态机和风险，writer 生成方案，critic 检查遗漏和引用边界，editor 做最终整理。Supervisor 会根据任务领域选择不同 Agent 子集执行。

我会把它讲成“可控的多 Agent 管线”，不是 A2A 或多个 Agent 自由对话。它适合复杂活动方案整理和遗漏项检查，最终规则、预算、概率、法务口径仍由业务负责人确认。
```

可指代码：

- `backend/src/modules/supervisor/supervisor.service.ts`
- `backend/src/rag/agents/agent-pipeline.service.ts`
- `backend/src/rag/agents/*.agent.ts`

### 5. MCP 和工具怎么调用？

```text
Function Calling 解决的是模型用什么格式表达“我要调用工具”，MCP 解决的是工具和上下文怎么被不同 Host 统一发现、描述和调用。我的项目把 RAG 能力封装成 MCP server，暴露 rag_search、rag_context、rag_ask、rag_graph_query、rag_agent_pipeline、rag_game_plan 等工具。

实际用法是 Codex/Trae/Claude Code 写代码前先调用 rag_context 或 rag_game_plan，拿到内部组件、活动模板、埋点规范、接口约定和地区适配上下文，再根据当前仓库编码。这样不用人工复制粘贴资料，也减少模型瞎猜内部规范。
```

可指代码：

- `tools/rag-mcp-server/src/server.ts`
- `tools/rag-mcp-server/README.md`
- `backend/src/providers/mcp/mcp.provider.ts`
- `backend/src/tools/tool-registry.ts`

### 6. Memory 怎么设计？

```text
我分了几层：全量对话消息落库保证可追溯；Redis 缓存最近会话，减少查库；短期记忆用 Redis ZSET 保存最近 N 轮，超出窗口后用 LLM 摘要压缩；长期记忆用 Mem0 provider 存用户偏好和跨会话事实；Obsidian/Karpathy 更像知识编译层，沉淀文章、官方文档、项目决策和业务模板。

边界是：当前有分层、缓存和摘要压缩，但还没做很完整的记忆衰退、合规留存、冲突消解和租户级记忆策略。
```

可指代码：

- `backend/src/modules/chat/conversation.service.ts`
- `backend/src/modules/memory/short-term-memory.service.ts`
- `backend/src/modules/memory/memory.service.ts`
- `backend/src/modules/obsidian/obsidian-knowledge.service.ts`

### 6.1 缓存和 token 节省怎么做？

```text
缓存上，我主要做了会话缓存、短期记忆缓存和索引快照。会话消息读取走 Redis，写入新消息后主动失效，避免脏读；短期记忆用 Redis 滑动窗口 + 摘要；BM25 索引持久化，重启后可恢复关键词召回。

Token 节省上，先通过 simple/auto/agentic 路由避免所有问题都走复杂 Agent；再通过 topK、maxRetrievedChunks、maxRerankTopN 控制上下文；历史对话只保留最近 N 轮，旧历史摘要压缩；明确事实题能抽取就抽取，不让模型长篇发挥。
```

可指代码：

- `backend/src/modules/chat/conversation.service.ts`
- `backend/src/modules/memory/short-term-memory.service.ts`
- `backend/src/rag/agentic/agentic-rag.service.ts`
- `backend/src/modules/metrics/metrics.service.ts`

### 6.2 召回优化和纠错怎么做？

```text
召回优化我分三段：召回前做 query normalize 和 query augment；召回中做 BM25/ES + Milvus 多路召回，再用 RRF 融合；召回后做来源权重、Rerank、Sufficiency Gate、GraphRAG 补关系和引用校验。

纠错机制也不是只靠 prompt。Milvus 失败回退 BM25/ES，证据不足走 web search fallback 或拒答，Rerank 失败不阻塞，生成后 citation gate 检查引用支撑，不够就回退抽取式回答或 unsupported answer，Agentic 模式最后还有 reflection 判断是否通过。
```

可指代码：

- `backend/src/rag/karpathy/karpathy-rag.service.ts`
- `backend/src/rag/agentic/agentic-rag.service.ts`
- `backend/src/tools/dashscope-rerank.service.ts`
- `backend/src/tools/tool-registry.ts`

### 7. RAG 评测怎么做？

```text
我没有只靠主观体验调 prompt，而是做了多层评测：项目级仿真实业务评测验证 simple/auto 链路，Prompt Injection 专项评测验证安全边界，Agent task 脚手架覆盖 retrieval/refusal/conflict/citation/tool_degrade，游戏活动/官网营销专项评测覆盖 8 类业务模板和 96 条问题。

但我会明确说这些是本地和仿真评测，不能冒充真实线上准确率。真实效果需要接入历史活动复盘、线上问题、用户反馈和长期数据回流。
```

可指命令：

```bash
cd backend
npm run eval:rag:project
npm run eval:prompt-injection
npm run eval:agent-tasks
npm run eval:game-marketing
npm run enterprise:readiness
```

### 8. Prompt Injection 和安全怎么做？

```text
我的原则是：检索内容和工具返回都是不可信数据，不能让它覆盖系统规则。项目里对检索片段做本地注入检测和高风险行脱敏，prompt 里明确把证据片段当引用材料而不是指令。同时有文档权限、审计、低相关拒答和 Prompt Injection 专项样本。

边界是：这不是完整安全平台。生产环境还要接真实 IAM、DLP、数据分级、审批流、审计留痕和红队样本。
```

可指代码：

- `backend/src/rag/prompts/prompt-injection.guard.ts`
- `backend/eval/prompt-injection.dataset.json`
- `backend/src/modules/document/document-permission.service.ts`
- `admin-backend/src/modules/audit-logs/audit-logs.service.ts`

### 9. 项目遇到过什么问题？

```text
第一个问题是只靠向量检索会漏精确词，所以引入 BM25/ES 和 RRF。第二个问题是复杂问题一次检索不够，所以做 query augment、sufficiency 和 web search fallback。第三个问题是 AI 容易编具体活动规则，所以做引用校验、低相关拒答和“具体概率/预算/时间待确认”的边界。第四个问题是 AI Coding 工具不知道内部组件和埋点规范，所以做 MCP，让编码前自动取上下文。
```

可以展开 STAR：

```text
场景：游戏活动规则变化快，但活动类型和交付流程稳定。
任务：让系统辅助输出技术方案初稿，而不是生成最终活动规则。
动作：沉淀活动类型、玩法模板、页面模块、接口、埋点、地区适配和风险检查；用 Hybrid Search + GraphRAG + Agentic Workflow 串起来。
结果：形成可评审、可编码、可验收的方案初稿；真实效果后续通过活动复盘和用户反馈持续校准。
```

### 10. 入职时间短、数据不多怎么讲？

```text
我不会把它包装成多年线上验证的平台。更准确地说，这是任职期间结合当前业务链路做的从 0 到 1 试点建设：先把知识框架、检索链路、Agentic 编排、MCP 接入和评测方法搭起来。真实活动数据和长期效果还在积累，所以我用脱敏/仿真样本先验证链路和边界，后续每次活动上线、测试遗漏、线上问题和复盘都会回流到知识库。
```

这句话很重要：**别吹线上准确率，讲“框架、链路、方法、可持续回流”。**

## 简历写法建议

### 推荐写进简历的关键词

```text
Agentic RAG、Hybrid Search、Milvus、Elasticsearch/BM25、RRF、Rerank、GraphRAG、LangGraph、MCP、Prompt Injection、Evaluation、Admin Ops、游戏活动/官网营销
```

### 不建议写进简历的内容

| 不建议写 | 原因 |
|---|---|
| “线上准确率 xx%” | 当前没有真实长期线上数据支撑 |
| “完全替代产品/运营写活动规则” | 活动规则、概率、预算、法务口径必须业务确认 |
| “已满足金融级合规” | 项目不是金融真实生产合规系统 |
| “完整 Deep Research 平台” | 当前更接近 Agentic RAG，不是长报告多源交叉验证平台 |
| “实现 A2A / RLHF / SFT” | 项目没有这些主线 |

### 简历项目一句话

```text
面向游戏活动、营销 H5、小程序活动页和 PC/H5 官网业务线，从 0 到 1 建设 Agentic RAG 知识协同平台，基于 Hybrid Search、GraphRAG、LangGraph 和 MCP，把活动玩法、页面模块、接口、埋点、地区适配和上线验收知识转成可评审、可编码、可验收的技术方案初稿。
```

## 面试前复习顺序

1. 先看 `docs/interview/resume/resume-rag-project-game-marketing.md`：确定简历上怎么写。
2. 再看本文件：把 AgentGuide 高频题和你的项目对齐。
3. 追问实现细节时看 `docs/interview/jd/jd-requirements-project-mapping.md`：按 JD 找代码位置。
4. 被问“还有什么没做”时看 `docs/interview/jd/jd-gap-implementation-status.md`：避免吹过头。
5. 被问业务真实性时看 `docs/interview/resume/game-marketing-rag-evidence.md`：解释早期建设、仿真评测和后续回流。

## 代码与文档索引

| 内容 | 路径 |
|---|---|
| 游戏营销简历稿 | `docs/interview/resume/resume-rag-project-game-marketing.md` |
| 游戏营销证据说明 | `docs/interview/resume/game-marketing-rag-evidence.md` |
| JD 与项目代码对照 | `docs/interview/jd/jd-requirements-project-mapping.md` |
| JD 差距状态 | `docs/interview/jd/jd-gap-implementation-status.md` |
| Karpathy RAG 主链路 | `backend/src/rag/karpathy/karpathy-rag.service.ts` |
| Agentic RAG 状态机 | `backend/src/rag/agentic/agentic-rag.service.ts` |
| 多 Agent Supervisor | `backend/src/modules/supervisor/supervisor.service.ts` |
| 子 Agent 管线 | `backend/src/rag/agents/agent-pipeline.service.ts` |
| MCP Server | `tools/rag-mcp-server/src/server.ts` |
| MCP 使用说明 | `tools/rag-mcp-server/README.md` |
| Tool Registry | `backend/src/tools/tool-registry.ts` |
| Prompt Registry | `backend/src/rag/prompts/prompt-registry.ts` |
| Prompt Injection 防护 | `backend/src/rag/prompts/prompt-injection.guard.ts` |
| 游戏营销评测集 | `backend/eval/game-marketing-regression.dataset.json` |
| 对话缓存 | `backend/src/modules/chat/conversation.service.ts` |
| 短期记忆摘要压缩 | `backend/src/modules/memory/short-term-memory.service.ts` |
| BM25 中文分词 | `backend/src/rag/karpathy/bm25.util.ts` |
| 指标与 token 估算 | `backend/src/modules/metrics/metrics.service.ts` |
