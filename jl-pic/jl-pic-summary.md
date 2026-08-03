# jl-pic 图片素材全量总结

更新时间：2026-07-07

## 读取范围

- 已逐张阅读 `jl-pic` 下 57 张图片。
- 目录里另有本文件 `jl-pic-summary.md`，不计入图片数量。
- 这些图片主要由两类材料组成：AI 应用 / Agent / RAG 项目简历素材，以及一线公司面试追问清单。

## 总体结论

这批素材的核心共性不是“做了一个知识库问答”，而是把 AI 应用项目讲成一条可运营、可评测、可追责的工程链路：数据进入系统后如何解析、切分、索引、召回、重排、生成、引用、评测、回流优化，并且要能说明 Agent 怎么控流程、工具怎么接入、Memory 怎么参与、SSE 怎么流式输出、生产稳定性怎么兜底。

对当前 RAG 项目最有价值的提炼是：简历必须突出“企业级 Agentic RAG 知识治理与问答平台”，而不是只写“RAG 知识库”。亮点应聚焦 Hybrid Search、GraphRAG、LangGraph 编排、MCP/Tool Registry、AG-UI/SSE、权限过滤、引用校验、Prompt Injection、防幻觉、评测门禁、后台运营和 Karpathy + Obsidian fast path。

## 逐图索引摘要

| 序号 | 文件 | 内容摘要 | 可借鉴点 |
|------|------|----------|----------|
| 01 | `微信图片_20260707162439_17_1.png` | 电商智能问答 RAG，覆盖多语种客服、Milvus、Qwen Embedding、OCR、FastAPI、RAGAS。 | 多语种、意图识别、混合检索、Rerank、LoRA、业务指标表达。 |
| 02 | `微信图片_20260707162501_18_1.png` | 跨境代购多 Agent 客服平台，LangChain/LangGraph、Milvus、ES、Redis、BGE-M3、Qwen3、Badcase 闭环。 | 主从 Agent、动态路由、反思重规划、LLM Judge、CI/CD 评测。 |
| 03 | `微信图片_20260707162510_19_1.png` | 企业知识库问答系统，LangGraph + FastAPI + ChromaDB + BGE + BM25 + CrossEncoder。 | 父子分块、Hybrid Search、质量评估、条件重试、SSE。 |
| 04 | `微信图片_20260707162637_20_1.jpg` | 多 Agent 知识库问答，DocParser/KnowledgeExtract/QA/KnowledgeUpdate，GraphRAG + CDC 增量更新。 | 多 Agent 分工、实体关系抽取、Neo4j MERGE、2-hop 图谱推理。 |
| 05 | `微信图片_20260707162645_21_1.jpg` | ICT 产品 RAG，意图树、Query Rewrite、多路召回、RAGAS、DAG 入库。 | 检索链路拆成理解、召回、重排、生成、评测。 |
| 06 | `微信图片_20260707162710_22_1.jpg` | 医疗智能问诊，ReAct + KG，多轮问诊、Mem0 长期记忆、Redis 短期记忆。 | ReAct 工具调用、KG 查询、长短期记忆边界。 |
| 07 | `微信图片_20260707162722_23_1.jpg` | 办事导办 Any2Any 多模态 RAG，Dots.OCR、Qwen3-VL、Milvus、RAGAS。 | 文本/图片统一向量空间、多模态检索、人工中断节点。 |
| 08 | `微信图片_20260707162733_24_1.jpg` | 建筑领域 BuildingRAG，Milvus、BM25、Sentence-BERT、Qwen3、vLLM、OCR、LoRA。 | 行业知识库、三级路由、TopK/RAGAS/延迟指标表达。 |
| 09 | `微信图片_20260707162737_25_1.jpg` | 集装箱物流多模态 RAG，OCR/VL embedding、dense/sparse、Rerank、RAGAS。 | 物流文档多模态、阈值按模态配置、跨模态检索。 |
| 10 | `微信图片_20260707162742_26_1.jpg` | 业财税记账智能体，LangGraph 节点、凭证生成、合规校验、SSE、LangFuse。 | 业务规则 + Agent 工作流 + 校验重试 + 工具链审计。 |
| 11 | `微信图片_20260707162746_27_1.jpg` | 本地化意图识别与 Agent 路由，Roberta 微调、多类别意图、置信度阈值。 | 意图分类可作为 Agent 路由前置，不确定时澄清/人工转接。 |
| 12 | `微信图片_20260707162757_28_1.jpg` | 医药企业知识库 RAG，FastAPI、React、MySQL、Redis、Milvus、BGE-M3、BM25。 | 轻量企业 RAG 模板、SSE、来源引用、检索不足兜底。 |
| 13 | `微信图片_20260707162801_29_1.jpg` | 医疗问答 ReAct Agent，Milvus + Neo4j + BM25 + RRF + Redis，Planner/Executor/Reflector/Memory。 | 反思、工具选择、医疗安全边界、专项评测。 |
| 14 | `微信图片_20260707162812_30_1.jpg` | 医美咨询与客户生命周期 Agent，GraphRAG、长期记忆、Lead Score、CRM。 | 用户画像、记忆分层、GraphRAG 多跳、CRM 闭环。 |
| 15 | `微信图片_20260707162816_31_1.jpg` | K12 多智能体对话系统，LangGraph、RabbitMQ、A2A、Milvus、Redis、OCR。 | 多 Agent 服务化通信、状态总线、异常容错。 |
| 16 | `微信图片_20260707162820_32_1.jpg` | K12 配套 RAG 检索平台，Milvus、Qwen Embedding/Reranker、题库关联。 | 题库检索、结构化查询 + 向量检索、降级。 |
| 17 | `微信图片_20260707162824_33_1.jpg` | K12 多智能体内容重复图。 | 同 15，强调多 Agent 与教育业务。 |
| 18 | `微信图片_20260707162830_34_1.jpg` | 企业知识库智能体，后台数据集、索引、问答、离线评估、阈值 sweep。 | 管理后台运营能力、RAGAS full/smoke、per-item trace。 |
| 19 | `微信图片_20260707162840_35_1.jpg` | 企业知识库智能体重复图。 | 同 18。 |
| 20 | `微信图片_20260707162844_36_1.jpg` | 法律长文档 RAG，PyMuPDF/PaddleOCR、层级分块、证据链、Redis、SSE。 | 长文档结构化、跨页证据、引用链。 |
| 21 | `微信图片_20260707162848_37_1.jpg` | 法律检索/案例分析 Agent，Milvus + ES + BM25/RRF/Rerank、任务分解、引用输出。 | 法律场景的证据约束、结构化输出、问答边界。 |
| 22 | `微信图片_20260707162852_38_1.jpg` | MultiMind 智能服务中枢，意图融合、RAG、多 Agent、MCP、Monitor、LLM-as-Judge。 | MCP、工具接入、三路意图融合、线上质量闭环。 |
| 23 | `微信图片_20260707162857_39_1.jpg` | 工业知识库 RAG-KG，MinerU/Docling、Milvus/OpenSearch/Neo4j/MinIO、多权限。 | 文档/表格/图片资产化、KG、权限过滤、证据生成。 |
| 24 | `微信图片_20260707162904_40_1.jpg` | 多模态素材中心，rag_assets 表、pgvector、人工维护 + OCR/VLM/ASR 增强。 | 多模态资源统一建模、人工路线和模型路线互补。 |
| 25 | `微信图片_20260707162908_41_1.jpg` | AI 实时语音客服，ASR/TTS、Prompt Pilot、KV/Prefix cache、限流和重排。 | 低延迟语音链路、缓存、token 控制。 |
| 26 | `微信图片_20260707162912_42_1.jpg` | 企业 AI 定制方案，售前到交付、POC、RAG Chatbot、预测、Prompt 优化。 | 方案型项目表达，突出业务闭环和交付价值。 |
| 27 | `微信图片_20260707162917_43_1.jpg` | Activity-AI，Eino、会话记忆、Query Rewrite、ES+Milvus、MCP server/client。 | 记忆摘要、父子字段、RRF、MCP 双端。 |
| 28 | `微信图片_20260707162921_44_1.jpg` | 企业 RAG 业务知识库，Wiki 抓取、语义分块、Milvus metadata/raw/sparse/dense。 | 企业内部知识抓取、结构化 chunk、TopK 和延迟指标。 |
| 29 | `微信图片_20260707162928_45_1.jpg` | 车联网 App 助手，LangGraph 主控 Agent、命令 Agent、数据查询 Agent、KB Agent、天气 Agent。 | 主控协调、多工具、多轮循环到 command/answer。 |
| 30 | `微信图片_20260707162934_46_1.jpg` | 企业 RAG 知识库重复图。 | 同 03。 |
| 31 | `微信图片_20260707162939_47_1.jpg` | MCP 多 Agent 共享服务集群，LLM/RAG/Memory/Prompt 四类 MCP server。 | MCP 服务化、TraceID、token budget、Prompt/Memory 共享。 |
| 32 | `微信图片_20260707162944_48_1.jpg` | 电商客服多模态 Agent，产品手册图片预处理、RAG loop、证据过滤、LangFuse。 | 图片资料预处理、证据补召回、线上日志和 Judge。 |
| 33 | `微信图片_20260707162948_49_1.jpg` | 部门知识平台，LangChain Agent、Chroma、Django、权限、日志、Celery。 | 业务案例推荐、知识复用、后台统计。 |
| 34 | `微信图片_20260707162953_50_1.jpg` | MultiMind 重复图。 | 同 22。 |
| 35 | `微信图片_20260707162959_51_1.jpg` | 合同风险审核 Agent，合同解析、BGE-Law、LangGraph、多 Agent 报告。 | 法律/商业风险 Agent 分工、风险分级、修改建议。 |
| 36 | `微信图片_20260707163004_52_1.jpg` | 工业 RAG-KG 重复图。 | 同 23。 |
| 37 | `微信图片_20260707163019_53_1.jpg` | 装修设计智能体，方案生成、预算核算、方案版本、材料清单、Docker 部署。 | 责任链预算核算、版本差异、材料替换、Prompt 输出约束。 |
| 38 | `微信图片_20260707165001_55_1.jpg` | 社招一面问题清单：Agent 项目、RAG 优化、Rerank、多路召回、记忆、多 Agent、MCP。 | 简历需要能回答这些核心追问。 |
| 39 | `微信图片_20260707165004_56_1.jpg` | 字节实习二面问题：因果评估、RAG 落地场景、Memory/RAG、Code Review Agent、规则沉淀。 | 补充评测方法论、Memory 边界、Agent 系统设计。 |
| 40 | `微信图片_20260707165007_57_1.jpg` | 腾讯社招二面问题：JS 依赖解析、SSE 流式、断线恢复、消息链路、MongoDB 大文档。 | 面试要准备流式链路、断点续传、消息一致性和前端基础。 |
| 41 | `微信图片_20260707165010_58_1.jpg` | 传音社招一面问题：架构沉淀、SSE vs WebSocket、Markdown/结构化渲染、Chunk、LangChain 坑。 | 强化 AG-UI/SSE、Markdown 富文本、Chunk 策略、工程化问题。 |
| 42 | `微信图片_20260707181047.png` | 车联网助手重复图。 | 同 29。 |
| 43 | `微信图片_20260707181054.png` | 企业 RAG 业务知识库重复图。 | 同 28。 |
| 44 | `微信图片_20260707181101.png` | Activity-AI 重复图。 | 同 27。 |
| 45 | `微信图片_20260707181105.png` | 企业 AI 定制方案重复图。 | 同 26。 |
| 46 | `微信图片_20260707181109.png` | AI 实时语音客服重复图。 | 同 25。 |
| 47 | `微信图片_20260707181113.png` | 多模态素材中心重复图。 | 同 24。 |
| 48 | `微信图片_20260707181120.png` | 法律检索/案例分析 Agent 重复图。 | 同 21。 |
| 49 | `微信图片_20260707181123.png` | 法律长文档 RAG 重复图。 | 同 20。 |
| 50 | `微信图片_20260707181127.png` | 企业知识库智能体重复图。 | 同 18。 |
| 51 | `微信图片_20260707181130.png` | 企业知识库智能体重复图。 | 同 18。 |
| 52 | `微信图片_20260707181139.png` | K12 多智能体重复图。 | 同 15。 |
| 53 | `微信图片_20260707181144.png` | K12 配套 RAG 检索平台重复图。 | 同 16。 |
| 54 | `微信图片_20260707181148.png` | K12 多智能体重复图。 | 同 15。 |
| 55 | `微信图片_20260707181156.png` | 企业知识库智能体重复图。 | 同 18。 |
| 56 | `微信图片_20260707181159.png` | 法律长文档 RAG 重复图。 | 同 20。 |
| 57 | `微信图片_20260707181205.png` | 法律检索/案例分析 Agent 重复图。 | 同 21。 |

## 项目类型聚类

### 企业知识库 / 行业 RAG

覆盖企业知识库、ICT、建筑、医药、工业、法律、电商、物流、教育等场景。共同链路是：

```text
文档解析 -> 清洗/结构化 -> 分块/metadata -> Embedding -> 向量召回 -> BM25/ES 关键词召回 -> RRF 融合 -> Rerank -> 生成 -> 引用/拒答 -> 评测回流
```

当前 RAG 项目已经能对应的能力：文档解析、Milvus、ES/BM25、RRF、Rerank、引用校验、低相关拒答、评测门禁、后台运营。

### Agent / Multi-Agent 编排

图片里的 Agent 都强调“可控”，不是让模型自由发挥。常见设计是主控 Agent 负责路由和状态，业务 Agent 或工具 Agent 负责具体动作，最后由汇总/反思节点统一输出。

当前 RAG 项目可对应：`simple / auto / agentic` 分层路由、LangGraph 节点、工具注册、预算参数、超时降级、human approval、AG-UI 事件流。

### GraphRAG / KG

多张图使用 Neo4j 抽取实体关系，做 2-hop 关系查询、实体路径推理、社区摘要或行业知识图谱。价值在于补足“向量检索只会相似，不会关系推理”的短板。

当前 RAG 项目可对应：GraphOps、Neo4j provider、实体/关系/别名、GraphRAG seed、图谱查询、节点编辑。

### 多模态

素材里的成熟方案通常把图片、表格、音频、视频都做成可治理资产：原文件、OCR/ASR/VLM 结果、人工标签、向量、回链、权限、片段引用分开管理。

当前 RAG 项目可对应：多模态资源登记、OCR/ASR/Vision Provider 脚手架、sidecar 样本、元数据 Markdown、对象存储思路。真实视觉向量和视频理解要等模型 key 和样本。

### 评测 / Badcase / 运营后台

优秀素材反复出现 RAGAS、LLM-as-Judge、正负样本、Recall@K、MRR、AnswerRelevancy、Faithfulness、NoiseRate、Badcase 回流、阈值 sweep、per-item trace。

当前 RAG 项目可对应：项目级仿真评测、业务回归集、成熟度评分、Prompt Injection 检测、Agent 任务评测脚手架、后台问答运营和审计。

## 面试反推必须准备的问题

- Agent 项目整体架构是什么，主控 Agent、工具、状态、终止条件怎么设计。
- RAG 检索效果怎么优化，文档解析、Chunk、Embedding、召回、Rerank、Prompt 分别怎么排查。
- Rerank 用在哪里，解决召回多但排序不准的问题，如何权衡成本和延迟。
- 多路召回怎么融合，向量、关键词、规则、历史会话、图谱如何合并和去重。
- Memory 和 RAG 的边界是什么，短期记忆、长期记忆、知识库事实分别解决什么。
- MCP 在项目里解决什么，是工具接入、权限控制、上下文传递还是系统集成。
- SSE 为什么不用 WebSocket，断线重连、消息缓冲、状态一致性怎么处理。
- Markdown、代码块、图片、表格、业务卡片等结构化输出怎么渲染。
- Chunk 怎么切，如何兼顾语义完整、召回效果、上下文窗口和引用准确性。
- LangChain/LangGraph 工程化坑有哪些，如何处理链路不可控、调试成本、抽象过重和超时降级。

## 对 RAG 项目简历的修改原则

1. 项目名用“企业级 Agentic RAG 知识治理与问答平台”，不要只写“知识库问答系统”。
2. 第一条写业务目标：解决企业知识检索、引用可信、权限安全、评测运营和 Agent 工具治理。
3. 主链路按“数据接入 -> 索引 -> 检索 -> 生成 -> 引用 -> 评测 -> 后台运营”表达。
4. 检索亮点必须写 Hybrid Search：Milvus + BM25/ES + RRF + Rerank + 阈值拒答。
5. Agent 亮点写 LangGraph、simple/auto/agentic、query augment、sufficiency、reflection、human approval、预算/超时/降级。
6. 工具亮点写 MCP/Tool Registry、Bocha、Rerank、Graph Search、Vision/ASR/TTS 脚手架和工具审计。
7. 评测亮点写真实本项目指标：成熟度 93/100、项目级仿真实业务评测 28/28、业务回归集 120+、Prompt Injection 7/7。
8. 多模态只能写“资源登记、Provider 脚手架和样本 sidecar 已具备”，不能夸成真实视觉检索生产闭环。
9. 其他图片里的业务指标、融资/中标/降本数据、行业指标不能写成本项目结果。

## 不应直接照搬的内容

- 其他项目的时间线、公司名、业务指标和行业场景不能直接迁移。
- “Top5 92%”“TTFT 15s 到 2s”“人工成本降低 65%”“中标 300 万”等只能作为表达参考，除非当前项目有同口径验证。
- 医疗、法律、金融等高风险行业能力不能冒充真实生产落地；可以说项目有技术框架，真实业务需要合规数据和审核流程。
- 多模态项目里的 OCR/VLM/ASR 准确率不要写到当前项目，当前项目只能写脚手架、样本、降级和待接真实 key。
