# 一线大厂 AI 应用 / Agent 岗位要求与项目实现对照

更新时间：2026-07-06

## 结论先行

这个 RAG 项目对 **AI 应用开发 / Agent 开发 / 企业知识库 RAG** 岗位的主干要求是对得上的，尤其是：

- RAG 主链路：文档解析、切片、Embedding、向量/关键词混合检索、引用、拒答。
- Agentic 编排：LangGraph 状态机、Query Augment、Retrieval、Sufficiency、Web Search、Rerank、Generate、Reflection。
- 工具调用：Bocha Web Search、DashScope Rerank、Graph Search、MCP Provider、ASR/TTS、Vision Provider 脚手架。
- 工程化：NestJS 模块化、SSE/AG-UI、Prometheus 指标、LangFuse 可选 Trace、评测脚本、后台运营。
- 企业落地：多租户隔离、文档权限、审计日志、GraphOps、QA Ops、CLI、Obsidian/Karpathy 知识编译。

但不要把它说成“一线大厂生产系统已经完整具备”。目前比较明显的差距是：

- 真实生产环境 SLA、灰度、备份、证书、监控接入没有做。
- 真实 IAM / DLP / 合规审批 / 金融审计系统没有接。
- 真实视觉向量、视频理解、以图搜图没有完整落地。
- Prompt Registry、Prompt Injection 检测和工具治理已有本地基础版，但还不是后台化/线上灰度/审计入库平台。
- Agent Task Success Rate / Step Accuracy / Tool Success Rate 看板还没有完整产品化。
- A2A 协议没有接入。
- 真实业务系统 API、地图/硬件/金融核心系统 API 没有接入。

面试时建议用这句话定调：

```text
这个项目已经覆盖大厂 AI 应用开发和 Agent 开发的主干工程能力：RAG、Agentic Workflow、Tool Calling、Memory、Eval、Observability 和后台运营都有真实实现。但生产 SLA、真实组织权限、真实业务 API、金融合规和多模态模型闭环，需要接入公司真实环境后才能算完整生产化。
```

## 招聘要求来源

公开招聘页可访问性会变化，BOSS 直聘等页面存在登录和反爬限制。本文件按可公开访问 JD、公司招聘页和岗位摘要归纳共性，不把任一单个 JD 当行业全量结论。

公开样本：

- 字节：AI Agent 研发，常见要求覆盖 AI 应用全流程、Agent、RAG、MCP、多模态、工程化。
  - https://jobs.bytedance.com/experienced/m/position/detail/7428873140916554010
- 美团：AI Agent 应用架构，常见要求覆盖 Agent 框架、Prompt 管理、工具注册、链路追踪、效果评估、灰度和成本。
  - https://zhaopin.meituan.com/web/position/detail?highlightType=social&jobUnionId=4428189649
- 百度：AIDU 智能体算法 / Agent 应用全栈，公开 JD 明确出现感知-决策-执行闭环、多智能体、长期记忆、工具/API 调用、RAG+Agent、Eval、成本/延迟/体验。
  - https://talent.baidu.com/jobs/list?recommendCode=IS96J8&recruitType=GRADUATE
- 腾讯：LLM Application Engineer / AI Agents，常见要求覆盖 LLM 应用、Agent 架构、RAG 优化、标准化工具协议、企业协作场景。
  - https://www.linkedin.com/jobs/view/sr-llm-application-engineer-ai-agents-at-tencent-4414642626
- 阿里：AI Agent 优化，常见要求覆盖 Agent 能力优化、场景落地、效果评估。
  - https://campus-talent.alibaba.com/campus/position/199907160001

BOSS/公开 JD 补充观察：

- BOSS 直聘搜索页可见多个 AI 应用/Agent/RAG 岗位摘要，但详情页经常需要登录或动态渲染；本文件只提炼可见摘要里的共性，不写成某家公司逐字 JD。
- 阿里/腾讯/百度/字节/美团这类平台型岗位更常看：Agent 平台架构、RAG+MCP、工具调用治理、Prompt/上下文工程、链路追踪、评测、灰度、成本和低延迟。
- 小米/大疆/高德这类业务结合更深的岗位更常看：多模态、端侧/设备/实时数据、业务 API 工具化、地图/硬件/IoT 场景推理。
- 微信/DeepSeek 相关方向更常看：高并发产品体验、消息/协作生态、模型能力边界、推理效率、评测方法和安全边界。
- 中信/平安/证券公司更常看：金融知识库、投研/客服/合规场景、向量检索、Prompt 工程、私有化部署、数据安全、审计、权限和可解释引用。

## 公司 / 行业要求对照

| 公司 / 行业 | 招聘侧高频要求 | 本项目可对齐内容 | 当前缺口 | 面试讲法 |
|---|---|---|---|---|
| 阿里 | AI Agent 优化、场景落地、Prompt/工具/效果评估 | Agentic RAG、Tool Calling、Eval、Admin 运营 | 没有接阿里真实业务场景和内部平台 | 讲“Agent 工程闭环和效果评估”，不讲阿里内部落地 |
| 腾讯 / 微信 | LLM 应用、Agent 架构、RAG 优化、企业协作、消息体验、标准化工具协议 | AG-UI/SSE、会话历史、MCP、RAG/Agent 路由、后台运营 | 没有微信生态、企业微信真实工具、超大规模消息链路 | 讲流式体验、工具协议、协作知识库，不冒充微信生态经验 |
| 百度 | 感知-决策-执行闭环、多智能体、长期记忆、Tool/API、RAG+Agent、Eval、成本/延迟/体验 | LangGraph 节点、Memory、工具调用、评测、预算参数、首字优化 | 多智能体更偏状态机；缺完整 task success 看板 | 主动说“我这里是可控状态机式 Agentic，不是自由自治 Agent” |
| 字节 | AI 应用全流程、RAG、MCP、多模态、低延迟、工程化 | RAG 主链路、MCP Provider、Vision/Speech 脚手架、SSE、Metrics | 真实多模态理解和生产压测未完整 | 讲工程全链路和降级，不夸真实多模态 |
| 美团 | Agent 应用架构、Prompt 管理、工具注册、链路追踪、效果评估、灰度、成本 | Tool 模块、AG-UI trace、Prometheus/LangFuse、Eval、成本估算 | Prompt Registry、灰度发布、租户级成本平台不足 | 讲已有基础和下一步补齐路径 |
| 小米 | 智能硬件/IoT/用户助手、多模态、端侧约束、设备 API | Agent 工具调用、Vision/Speech、RAG 知识库 | 没有真实设备 API、端侧模型和硬件链路 | 讲架构可迁移，不说做过硬件 Agent |
| 高德 | 地图/出行/POI/路径规划、实时数据、业务 API、位置服务 | 工具调用、GraphRAG、RAG+业务 API 架构思路 | 没有地图数据、实时路况、路径规划工具 | 讲“把地图 API 工具化后可纳入 Agent”，不说已实现 |
| 大疆 | 视觉、多模态、设备、边缘场景、低延迟 | Vision Provider、OCR/图片理解、ASR/TTS、多模态样本 | 视频理解、视觉向量、设备/边缘推理未完整 | 讲多模态入口和 provider 抽象，承认真实视觉闭环不足 |
| DeepSeek | 模型能力、推理效率、评测、模型边界、应用工程 | RAG/Agent 应用工程、评测、成本/延迟、引用拒答 | 不做模型训练/底层推理框架 | 讲应用工程，不把自己包装成训练算法 |
| 中信 / 平安 / 证券 | 金融知识库、投研/客服/合规、私有化、权限、审计、引用、数据安全 | ACL、审计日志、引用、拒答、评测、脱敏样本 | 真实 IAM/DLP/合规审批/投研数据源未接 | 讲金融生产要接真实合规系统，不能说已满足监管 |

## JD 要求与项目实现一一对照

| 招聘要求 | 项目是否对得上 | 项目实现内容 | 代码 / 文档位置 | 面试回答边界 |
|---|---:|---|---|---|
| RAG 基础链路 | 已实现 | 文档进入系统后做切片、Embedding、BM25/ES、Milvus 检索、RRF 融合、生成、引用、拒答 | `backend/src/rag/karpathy/karpathy-rag.service.ts:323`、`backend/src/rag/karpathy/karpathy-rag.service.ts:438` | 可以说“不是纯向量问答，是 hybrid retrieval + citation + refusal” |
| 向量数据库 | 已实现 | Milvus 相似度检索，失败时降级 BM25 | `backend/src/rag/karpathy/karpathy-rag.service.ts:351`、`backend/src/providers/vector-store/milvus.vector-store.ts` | 可以讲 Milvus，但本机 Milvus timeout 仍依赖降级 |
| 关键词 / ES 检索 | 已实现 | 本地 BM25 + Elasticsearch 搜索合并 | `backend/src/rag/karpathy/karpathy-rag.service.ts:334`、`backend/src/providers/elasticsearch/elasticsearch.provider.ts` | 可以说企业中文知识库不能只靠向量 |
| Rerank | 已实现 | DashScope Rerank 工具，Agentic 链路可开关，失败降级 | `backend/src/rag/agentic/agentic-rag.service.ts:20`、`backend/src/tools/dashscope-rerank.service.ts` | 依赖外部 key，没 key 时不能说真实 rerank 生效 |
| Agentic Workflow | 已实现 | LangGraph 状态机：queryAugment、retrieval、sufficiency、webSearchFallback、rerank、generate、humanApproval、reflection | `backend/src/rag/agentic/agentic-rag.service.ts:111` | 要说“状态机编排”，不要说“多个 Agent 自己聊天” |
| Planning / Acting / Reflection | 已实现主体 | Query plan / query augment 属于 planning，retrieval/tool 属于 acting，reflection 负责质量自检和重试 | `backend/src/rag/agentic/agentic-rag.service.ts:31`、`backend/src/rag/agentic/agentic-rag.service.ts:154` | 可以讲闭环，但不是通用 AutoGPT 类无限规划执行 |
| Agent 路由 | 已实现 | simple / agentic / auto；auto 明确复杂问题才升级 agentic | `backend/src/rag/agentic/agentic-rag.service.ts:171` | 重点讲“普通问题走稳定 simple，复杂问题走 agentic” |
| 成本 / 预算控制 | 部分实现 | maxRetries、maxAugmentedQueries、maxRetrievalQueries、maxRetrievedChunks、maxWebSearchResults、maxRerankTopN | `backend/src/rag/agentic/agentic-rag.service.ts:42` | 有节点预算和参数控制，但没有租户级成本预算平台 |
| Web Search 工具 | 已实现 | Bocha Search 作为检索不足时的联网兜底 | `backend/src/rag/agentic/agentic-rag.service.ts:20`、`backend/src/tools/bocha-search.service.ts` | 依赖 Bocha key；没 key 时按降级讲 |
| Tool Calling | 已实现基础 | Web Search、Rerank、Graph Search、MCP、ASR/TTS、Vision Provider 属于工具层 | `backend/src/tools/tools.module.ts`、`backend/src/modules/mcp/mcp.controller.ts` | 可以讲宿主执行工具、不是模型直接执行 |
| 工具注册 / 工具目录 | 已实现基础 | MCP Provider 会加载 server 工具；Tool module 有 Bocha/Rerank/Graph；新增代码级 Tool Registry 记录风险、权限、超时、审计、降级 | `backend/src/providers/mcp/mcp.provider.ts:76`、`backend/src/tools/tools.module.ts`、`backend/src/tools/tool-registry.ts` | 可说“有工具治理清单”，不要说已有后台工具市场/审批流 |
| MCP | 已实现基础 | 读取 `mcp-servers.yaml`，用 `MultiServerMCPClient` 初始化 server，加载工具并带 source | `backend/src/providers/mcp/mcp.provider.ts:31`、`backend/src/providers/mcp/mcp.provider.ts:71` | 是 MCP Provider 和 smoke 能力，不是接了一堆真实业务 MCP server |
| A2A | 未实现 | 当前没有 Agent-to-Agent 协议实现 | 无 | 只能说了解概念，项目没有接 |
| Memory 长短期记忆 | 已实现 | Mem0 user/session 分层；会话前检索记忆，回答后分类写入 | `backend/src/modules/memory/memory.service.ts:10`、`backend/src/modules/memory/memory.service.ts:89`、`backend/src/modules/memory/memory.service.ts:132` | 可以讲 conversation memory / semantic memory；别说有复杂遗忘策略和合规留存 |
| Obsidian / Karpathy 知识编译 | 已实现 | simple fast path 读取 Obsidian；RAG chunks 和 Obsidian hits 合并成 evidence | `backend/src/rag/karpathy/karpathy-rag.service.ts:446`、`backend/src/rag/karpathy/karpathy-rag.service.ts:636`、`backend/src/modules/obsidian/obsidian-knowledge.service.ts` | 可以讲个人知识库和企业 RAG 互补 |
| GraphRAG | 已实现基础 | Neo4j Provider、Graph service、GraphOps、seed 数据、Graph Search | `backend/src/modules/graph/graph.service.ts`、`backend/src/providers/neo4j/neo4j.provider.ts`、`admin/src/pages/graph-ops/index.tsx` | 真实业务图谱仍是模拟，不要说已经接公司真实知识图谱 |
| 多智能体协同 | 部分实现 | 更准确是 LangGraph 多节点状态机，不是多个自治 Agent 互相协商 | `backend/src/rag/agentic/agentic-rag.service.ts:111` | 面试要主动纠正：“我这里不是自由聊天多 Agent” |
| Human-in-the-loop | 已实现后端基础 | `enableInterrupt=true` 时生成后暂停，等待 approve/reject，再 resume graph | `backend/src/rag/agentic/agentic-rag.service.ts:783`、`backend/src/rag/agentic/agentic-rag.service.ts:844`、`backend/src/modules/chat/chat.controller.ts:196` | 后端能力有，完整前端审批工作台/业务审批流不算生产完成 |
| AG-UI / SSE 流式输出 | 已实现 | RUN_STARTED、TEXT_MESSAGE_START、RAG 事件、TEXT_MESSAGE_END；admin 代理可接 | `backend/src/modules/agui/agui.service.ts:25`、`backend/src/modules/agui/agui.service.ts:59` | 可以讲真实流式，不是前端延迟模拟 |
| Markdown / 代码 / 图片输出 | 前端已优化 | QA 页面支持结构化渲染，AG-UI 事件折叠 | `admin/src/pages/qa-ops/index.tsx`、`backend/src/modules/agui/agui.types.ts` | 可以讲 UI 体验优化，但图片生成不是完整 multimodal output 平台 |
| Eval / Benchmark | 已实现 | `eval:rag:quality` 聚合 smoke、业务回归、项目评测、成熟度；项目评测支持 live 上传/问答/打分/清理 | `backend/scripts/eval-rag-quality-gate.mjs:5`、`backend/scripts/eval-rag-project.mjs:20` | 可以讲本地工程成熟度和模拟业务评测；不能冒充真实公司题库 |
| Agent 成功率评估 | 部分实现 | 有 RAG 质量、项目评测、工具 smoke；新增 Agent 任务覆盖脚手架，可用 live gate 跑项目级 task success | `backend/scripts/eval-rag-project.mjs`、`backend/scripts/smoke-external-tools.mjs`、`backend/scripts/eval-agent-task-metrics.mjs` | 可以说“已有任务评测脚手架”，但还没有线上 task success / step accuracy 看板 |
| 灰度 / A/B / 效果回归 | 部分实现偏弱 | 有 eval gate 和 maturity gate；没有线上灰度分流、A/B 实验和发布门禁平台 | `backend/scripts/eval-rag-quality-gate.mjs`、`backend/scripts/eval-rag-maturity.mjs` | 美团/字节问灰度时要说“离线门禁有，线上灰度还没做” |
| Observability | 已实现基础 | Prometheus HTTP/Retrieval/LLM 指标；AG-UI trace 事件；LangFuse 可选估算 token/cost | `backend/src/modules/metrics/metrics.service.ts:10`、`backend/src/modules/agui/agui.service.ts:263`、`backend/src/providers/observability/langfuse.provider.ts` | 可以讲链路可观测；生产监控接入和告警还不是完整 |
| Trace / Cost | 部分实现 | traceRagAnswer 记录 latency、citationCount、events、token/cost estimate | `backend/src/modules/agui/agui.service.ts:280` | 是估算和可选 provider，不是财务级成本核算 |
| 权限过滤 | 已实现基础 | 文档 ACL 支持 user/role/department/public，缓存 allowed docIds；检索层带 userId | `backend/src/modules/document/document-permission.service.ts:8`、`backend/src/modules/document/document-permission.service.ts:49`、`backend/src/rag/karpathy/karpathy-rag.service.ts:329` | 有基础权限模型；真实组织继承/IAM 仍要对接 |
| 多租户隔离 | 已实现基础 | PostgreSQL、Redis、Milvus、BM25 等按 userId 过滤；文档和检索带 userId | `README.md`、`backend/src/rag/karpathy/karpathy-rag.service.ts:329` | 可以讲基础隔离，不说金融级合规完成 |
| 审计日志 | admin-backend 已实现 | 后台审计日志查询，数据库未启用时返回 disabled；关键写操作有 AuditLog 标记 | `admin-backend/src/modules/audit-logs/audit-logs.service.ts:21`、`admin-backend/src/common/decorators/audit-log.decorator.ts` | 能讲后台审计基础，不代表满足金融监管 |
| 安全合规 | 部分实现 | 权限、审计、拒答、脱敏样本、红线文档；没有真实 DLP/IAM/审批/等保流程 | `docs/plans/remaining-enhancement-plan.md`、`admin-backend/src/modules/security/security.service.ts` | 金融/证券面试必须说“架构预留，生产需接公司合规系统” |
| 多模态 | 部分实现 | Vision Provider 接口、Mock/OpenAI-compatible OCR/图片理解；视频 provider 明确不直接支持，需要抽帧/音频 | `backend/src/providers/vision/vision-provider.interface.ts:1`、`backend/src/providers/vision/openai-vision.provider.ts:81` | 可以说有链路和样本，不说完整视频理解/视觉向量/以图搜图 |
| ASR / TTS | 已实现基础 | 腾讯云 ASR/TTS Provider，缺 key 明确降级 | `backend/src/providers/speech/tencent-speech.provider.ts`、`backend/scripts/smoke-speech.mjs` | 依赖腾讯云 key；不是端侧语音模型 |
| Prompt 工程 | 已实现基础 | prompt 文件集中管理，few-shot、semantic example selector 存在；新增 Prompt Registry 记录 version/owner/evals/rollback | `backend/src/rag/prompts/agentic.prompts.ts`、`backend/src/rag/prompts/few-shot.examples.ts`、`backend/src/rag/prompts/prompt-registry.ts` | 可以说“有代码级 Prompt Registry”，不要说已有后台灰度/回滚平台 |
| 上下文工程 | 已实现基础 | RAG chunks、Obsidian hits、memoryMessages、history 统一组装进 prompt；低质量证据走 fallback | `backend/src/rag/karpathy/karpathy-rag.service.ts:532`、`backend/src/modules/agui/agui.service.ts:73` | 可以讲证据选择、去噪、记忆注入；不要说已有自动 context optimizer |
| Prompt Injection 防护 | 已实现基础 | 检索片段会做本地注入模式检测和高风险行脱敏；生成 prompt 明确把片段当不可信证据；新增专项样本评测 | `backend/src/rag/prompts/prompt-injection.guard.ts`、`backend/src/rag/prompts/rag.prompts.ts`、`backend/eval/prompt-injection.dataset.json`、`backend/scripts/eval-prompt-injection.mjs` | 可以说“有基础防护和评测”，不要说能抵御所有 prompt injection |
| 模型路由 | 部分实现 | AG-UI 支持选择 model；simple/auto/agentic 路由；LLM Provider 有模型选择入口 | `backend/src/modules/agui/agui.service.ts:51`、`backend/src/rag/agentic/agentic-rag.service.ts:171` | 不是完整多供应商动态路由和成本最优路由 |
| SFT / RLHF / 模型训练 | 未实现 | 项目定位是 AI 应用工程和 RAG/Agent，不做模型训练和强化学习 | 无 | 金融/DeepSeek/算法岗问到时直接说不是本项目主线 |
| 高并发 / 高可用 | 部分实现 | NestJS、Docker Compose、timeout、fallback、队列基础；没有真实压测环境 SLA | `docker/`、`backend/scripts/benchmark-rag.mjs`、`ROADMAP.md` | 大厂问生产时要承认真实资源压测未完成 |
| 灰度发布 / 回滚 | 未完整实现 | 有文档和生产化差距清单，没有完整发布平台 | `docs/plans/remaining-enhancement-plan.md` | 不能说已具备生产发布体系 |
| 业务系统 API 接入 | 未接真实系统 | 有工具框架和 MCP 接入能力，但没有接小米/大疆/高德/金融真实业务 API | `backend/src/providers/mcp/mcp.provider.ts`、`backend/src/tools/` | 说“架构可迁移，真实业务 API 要按公司系统接” |
| CLI / 工程工具 | 已实现 | `rag search/context/ask --stream/admin search/graph query/eval` | `rag-cli/src/commands/` | 可以作为工程化亮点讲 |
| 管理后台运营 | 已实现多个入口 | QA Ops、GraphOps、文档治理、审计、权限、指标 | `admin/src/pages/qa-ops/index.tsx`、`admin/src/pages/graph-ops/index.tsx`、`admin-backend/src/modules/` | 可以讲“AI 能力运营化”，不是只做聊天页 |

## 按岗位类型怎么讲

### AI 应用开发工程师

匹配度：高。

你应该重点讲：

```text
我负责的是 AI 应用工程落地，不只是调模型。项目里有 RAG 入库、混合检索、AG-UI/SSE 流式输出、后台运营、权限、审计、评测和可观测。普通问题走 simple RAG，复杂问题才走 agentic，避免把所有请求都拖进高成本链路。
```

对应代码：

- `backend/src/rag/karpathy/karpathy-rag.service.ts`
- `backend/src/modules/agui/agui.service.ts`
- `admin/src/pages/qa-ops/index.tsx`
- `backend/scripts/eval-rag-quality-gate.mjs`

不要这么说：

```text
我做了一个 AI Chatbot。
```

要这么说：

```text
我做的是可运营、可评测、可追踪的企业知识库 AI 应用。
```

### Agent 开发工程师

匹配度：中高。

你应该重点讲：

```text
项目里的 Agentic 更准确是 LangGraph 状态机编排。它不是多个 Agent 自由聊天，而是把复杂问题拆成 query augment、retrieval、sufficiency、web search、rerank、generate、human approval、reflection，每个节点都有状态、预算、事件和降级。
```

对应代码：

- `backend/src/rag/agentic/agentic-rag.service.ts:111`
- `backend/src/rag/agentic/agentic-rag.state.ts`
- `backend/src/rag/agentic/sse-event.ts`

边界：

- 没有 A2A。
- 没有完整 AutoGPT 式任务执行平台。
- 没有真实业务 API 工具生态。
- 有 Human-in-the-loop 后端中断/恢复，但不是完整审批产品。

### RAG / 知识库工程师

匹配度：高。

你应该重点讲：

```text
这个项目最强的是企业 RAG 主链路：Milvus 负责语义召回，BM25/ES 负责精确词和制度编号，GraphRAG 负责关系型问题，Obsidian/Karpathy 负责长期知识编译，最后通过引用校验、质量闸门和拒答控制幻觉。
```

对应代码：

- `backend/src/rag/karpathy/karpathy-rag.service.ts:323`
- `backend/src/providers/elasticsearch/elasticsearch.provider.ts`
- `backend/src/modules/graph/graph.service.ts`
- `backend/src/modules/obsidian/obsidian-knowledge.service.ts`

边界：

- 真实私有题库是模拟替代。
- 真实 GraphRAG 业务数据还没接。
- Milvus 真实资源压测仍待做。

### 金融 / 证券 AI 应用岗位

匹配度：中等，工程基础对得上，真实合规系统没接。

你应该重点讲：

```text
金融场景我不会把模型当最终责任主体。项目里已有权限过滤、引用校验、拒答、审计日志和评测门禁，但真实落地还要接 IAM、DLP、数据分级、审批流、审计留痕、脱敏和监管口径。
```

对应代码：

- `backend/src/modules/document/document-permission.service.ts`
- `admin-backend/src/modules/audit-logs/audit-logs.service.ts`
- `backend/scripts/eval-rag-project.mjs`
- `docs/plans/remaining-enhancement-plan.md`

不要说：

```text
已经满足金融生产合规。
```

要说：

```text
架构上有合规落点，但生产合规必须接公司真实制度和审计系统。
```

### 多模态 / 硬件 / 地图类 AI 岗位

匹配度：中等。

你应该重点讲：

```text
项目已有多模态资料入库和 Vision Provider 抽象，能做 OCR、图片理解、音频转写 sidecar 和视频 metadata。但真实视觉向量检索、视频理解、端侧约束、地图实时数据或硬件设备 API，需要按具体业务系统继续接。
```

对应代码：

- `backend/src/providers/vision/vision-provider.interface.ts`
- `backend/src/providers/vision/openai-vision.provider.ts`
- `backend/src/providers/speech/tencent-speech.provider.ts`
- `backend/eval/private-fixtures/media/`

边界：

- 不要说做过地图 POI、无人机、车载或硬件端侧 AI。
- 可以说 Agent 架构、工具调用、评测和降级思路可迁移。

## 目前项目最能打的 10 个面试点

1. **不是纯向量 RAG**：Milvus + BM25 + ES + RRF + Rerank。
2. **Agentic 不是黑盒**：LangGraph 状态机节点可观测、可预算、可回放。
3. **Simple / Auto / Agentic 路由**：成本和稳定性优先。
4. **Karpathy + Obsidian Fast Path**：个人知识库与企业 RAG 互补。
5. **GraphRAG 有工程入口**：Neo4j、GraphOps、图上编辑、CLI query。
6. **AG-UI/SSE 真实流式**：不是前端假打字效果。
7. **Memory 分层**：user/session memory 由分类器判断写入。
8. **评测不是拍脑袋**：quality gate、project eval、maturity gate。
9. **权限和审计有基础**：document ACL、admin audit logs、userId 过滤。
10. **会承认边界**：真实生产、真实合规、真实图谱、真实多模态不乱吹。

## 需要避免的误导性说法

| 不要说 | 更准确说法 |
|---|---|
| 我做了多 Agent 协作系统 | 我做了 LangGraph 状态机式 Agentic RAG 编排 |
| 已经达到一线大厂生产可用 | 本地工程成熟度高，但生产 SLA 还需要真实环境验证 |
| 项目支持完整多模态理解 | 已有多模态入库和 Vision Provider，真实视觉/视频闭环还待 key 和样本验证 |
| 已接金融合规 | 有权限、审计、拒答和评测基础；真实合规要接 IAM/DLP/审批/审计系统 |
| MCP 工具体系已经很完整 | 有 MCP Provider 和 smoke 能力；真实业务 MCP server 需要继续接 |
| Prompt 安全已经解决 | 有引用/拒答边界；Prompt Injection 专项防护仍可补 |
| Agent 成功率已经完整评估 | 有 RAG/project/eval 基础；task success/step accuracy/tool success 看板还可补 |

## 如果面试官逐项追问，可以这样回答

### 你这个项目跟大厂 Agent 岗位差在哪？

```text
主干能力对得上：RAG、Agentic Workflow、Tool Calling、Memory、Eval、Observability 都有实现。差距主要在真实业务环境：真实业务 API、真实组织权限、真实多模态模型、生产 SLA、灰度发布、成本预算和金融合规系统。这些不是靠本地 demo 能补齐的，需要接公司真实系统。
```

### 如果你入职后怎么补齐？

```text
我会先做三件事：第一，拿真实业务题库和失败样本，建立评测基线；第二，接真实权限/IAM 和业务工具 API，把工具调用权限、审计、超时和成本做成统一治理；第三，做生产观测，包括 latency、tool success、retrieval hit、citation accuracy、refusal accuracy、cost 和人工接管率。
```

### 你最应该突出什么？

```text
我不是只做了一个问答页面，而是把 RAG 和 Agent 做成了工程闭环：有入库、检索、生成、引用、拒答、流式、记忆、工具、评测、后台和 CLI。这个闭环才是 AI 应用开发岗位最关心的。
```

## 后续如果要继续补项目

优先级建议：

1. **Prompt Injection 防护生产化**
   - 接入真实红队样本和线上攻击日志。
   - 增加模型级安全判别和后台安全事件查看。

2. **Agent 任务级评测产品化**
   - 把 `task_success_rate`、`tool_success_rate`、`step_accuracy`、`handoff_rate` 接入线上 trace 和 QA Ops 看板。

3. **Prompt Registry 后台化**
   - 增加后台管理、灰度发布、回滚 UI 和 prompt 变更审批。

4. **工具调用治理生产化**
   - 后台工具市场、危险动作二次确认、参数 schema 校验结果和工具调用审计入库。

5. **真实多模态检索**
   - 图片 OCR + image embedding。
   - 文本搜图、以图搜图。
   - 视频抽帧 + ASR + 时间戳引用。

6. **生产化补齐**
   - 真实压测、监控接入、告警、备份、灰度、回滚。
   - 真实 IAM / DLP / 审计 / 数据保留策略。
