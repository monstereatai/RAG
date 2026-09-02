# 《AI 复盘四场面试》问题全量清单与 RAG 项目回答

> 来源：`/Users/monster/Desktop/简历被 AI 包装过头后，我又用 AI 复盘 4 场面试，拿到了 30K offer.mhtml`
>
> MHTML 正文重复存档了三次。去重后共收录 **58 个问题**：正文隐含追问 9 个、附录正式题 42 个、通用七层追问 7 个。
>
> 口径：只讲当前仓库可证明的实现；本地验证不冒充生产效果；HR 题只给模板，不编造个人经历。

## 术语说明

| 英文 | 中文含义 |
|---|---|
| RAG（Retrieval-Augmented Generation） | 检索增强生成 |
| Agent（智能体） | 能理解目标、维护状态、选择工具并执行任务的程序 |
| Agentic（智能体式） | 具备规划、判断、工具调用和状态管理的处理方式 |
| Simple（简单模式）／Auto（自动模式） | 固定快路径／按证据自动选择路径 |
| Hybrid Retrieval（混合检索） | 向量、关键词等多种检索方式组合 |
| TopK（返回前 K 条结果的数量） | 检索候选数量参数 |
| effective（生效）／deprecated（已废弃）／draft（草稿） | 文档生命周期状态 |
| Checkpoint（检查点）／Checkpointer（检查点器） | 保存和恢复中间执行状态的机制 |
| Rerank（重排） | 对召回结果进行二次相关性排序 |
| Prompt（提示词）／Prompt Injection（提示注入） | 模型指令文本／通过文本诱导模型越权执行的攻击 |
| Tool（工具）／Tool Registry（工具注册表） | Agent 可调用的函数及其统一登记与权限管理 |
| MCP（Model Context Protocol，模型上下文协议） | AI 工具发现和调用外部能力的标准协议 |
| API（应用程序接口）／SDK（软件开发工具包）／RPC（远程过程调用） | 常见的服务调用方式 |
| Schema（结构约束）／Zod（TypeScript 数据校验库） | 约束和验证结构化输出 |
| Run（运行记录）／Event（事件）／Action（动作）／Artifact（结构化产物） | 运行审计中的不同数据对象 |
| Trace（链路追踪）／Span（链路片段） | 一次请求及其中一个阶段的追踪记录 |
| SLA（服务等级目标）／DLP（数据防泄漏）／IAM（身份与访问管理） | 生产服务、数据安全和权限治理要求 |
| Bad Case（错误案例）／Evals（评测）／Evidence Report（证据报告） | 失败样本、质量测试和验证报告 |
| Fast Path（快速路径）／Web Search（联网搜索）／Citation Gate（引用门禁） | 低延迟路径、外部补证和引用校验环节 |

## 一、项目总述

> 这是面向游戏官网、营销活动页、H5 和小程序产研团队的 Agentic RAG（智能体式检索增强生成）工作台。RAG（检索增强生成）把 PRD、接口、埋点、测试和复盘资料变成受权限、版本约束且可引用的证据；Agent（智能体）负责复杂任务拆解、工具选择、状态管理、审批和交付。系统有 Simple（简单模式）、Auto（自动模式）、Agentic（智能体式）三档问答，组合 Milvus、BM25、Elasticsearch、Rerank（重排）、Neo4j、Redis Checkpoint（检查点）、MCP（模型上下文协议）、LangFuse 和 Prometheus，并以 Bad Case（错误案例）、评测回归和运行审计治理质量。当前证明的是本地工程闭环；真实 SLA（服务等级目标）、企业 IAM（身份与访问管理）、DLP（数据防泄漏）、长期压测和生产部署仍需目标环境验收。

## 二、正文中的 9 个问题

### N1. 你们这个智能问答里的审计追踪，是怎么实现的？

每次问答或工作流先创建 `agent_runs`（运行总览）；路由、节点、检索、工具、审批、重试和终态按序写入 `agent_runtime_events`（事件时间线）；工具动作另写 `agent_actions`。`runId` 串起单次执行，`threadId` 串起会话、Redis Checkpoint（检查点）和 Artifact（结构化产物）；运行中心据此展示时间线、指标、目标状态和 Failure Onset（失败起点），外部再接 LangFuse Trace（链路追踪）和 Prometheus 指标。生产级保留策略、不可篡改存储和跨服务一致性仍待接入。

### N2. 这个能力具体解决了什么问题？

它回答“请求走了哪条路、在哪一步首次失败、使用了哪些证据和工具”。这样能把错误定位到解析、召回、重排、上下文、模型、工具、权限或预算，而不是笼统归咎于模型。

### N3. 为什么这么设计？

Run、Event、Action、Artifact 分开，是因为运行状态、不可变时间线、工具输入输出和大交付物的查询方式不同；统一用 ID 关联即可回放。超过 6,000 字符的工具输出外置为 Artifact，事件只留预览和定位 ID。

### N4. 数据怎么存？

PostgreSQL 保存 Run、事件、动作、Query Log、反馈、任务和 Artifact 元数据；Redis 保存短期记忆、摘要热副本、Checkpoint、租约和幂等状态；Milvus、BM25、Elasticsearch、Neo4j 保存不同索引。查询快照只留 query hash、长度、模式、Prompt 版本和工具策略，不保存原始敏感 Prompt。

### N5. 异常怎么处理？

模型结构化输出失败走 Zod 校验后的有限降级；Milvus 超时快速失败、熔断并退到 BM25 等可用链路；联网和 Rerank 不可用时跳过增强；工具失败写审计事件，副作用操作用幂等键；证据不足则拒答或标记待确认，不伪造成功。

### N6. 如果任务执行失败，状态怎么恢复？

LangGraph 节点状态写入 Redis Checkpoint，Run 表记录当前节点和终态，事件时间线定位失败起点。恢复时读取 Checkpoint 和已完成工具的幂等结果，从安全节点继续；副作用工具结果未知时标记 `unknown`，先查询外部结果再决定，不盲目重写。多实例故障切换仍需部署环境验证。

### N7. 项目产生的背景是什么？

游戏官网和活动项目周期短、版本多、角色多，PRD、设计、接口、埋点、测试和复盘分散，旧口径容易进入交付。项目要让产品、UI、前端、后端、测试和运营围绕同一生效证据协作，而非只做上传文档后聊天。

### N8. 怎么设计解决方案？

先做文档解析、质量门禁、父子切块和多索引；再做权限／版本过滤、混合召回、Rerank、引用和拒答；复杂任务用 LangGraph 拆步、调用受控工具并保存 Checkpoint；最后用 Admin、Bad Case、Evals、LangFuse 和 Prometheus 形成运营闭环。

### N9. 过程中遇到过哪些问题？怎么解决？

代表性问题是：Milvus 波动以快速失败、熔断和 BM25 降级处理；简单题全走 Agentic 成本高，以 Simple／Auto Fast Path 处理；引用不完整时做支撑校验和抽取式回退；长上下文用窗口、摘要和按需历史向量压缩；Agent 黑盒则增加 Run／Event／Action／Failure Onset。它们是治理手段，不是“彻底消灭故障”。

## 三、Agent、MCP、RAG 共性题（18 题）

### A1. 为什么这个需求适合用 Agent，而不是普通业务代码？

确定输入、步骤和输出的流程继续用普通代码；只有目标开放、需动态检索／工具选择、多步判断、失败回退和人工确认时才用 Agent。查接口字段是 RAG 查询，生成跨产品、研发和测试的完整活动方案才适合 Agent。

### A2. 整个 Agent 的运行流程是怎样的？

上下文与计划 → Query Augment（查询扩展）／SubQuestion Plan（子问题计划）→ 并发 Hybrid Retrieval（混合检索）→ Sufficiency Gate（充分性门禁）→ 必要时 Web Search（联网补证）→ Rerank（重排）→ Generate（生成）→ Citation Gate（引用门禁）→ 可选 Human Approval（人工审批，仅显式开启答案审批时）→ Reflection（反思）→ Final（终态）。高风险副作用工具必须在执行前单独审批；当前 Chat Agentic 工具均为只读。每个节点写事件并保存 Checkpoint（检查点）。

### A3. 项目是单 Agent 还是多 Agent？为什么这么设计？

普通问答是一条 Chat Agentic 状态机；产研运复杂交付用 Task Agentic 多岗位 DAG。多 Agent 只在职责、产物和审批边界确实不同的场景使用，否则协调成本和失败面更大。

### A4. Agent 如何判断用户意图并选择不同处理流程？

用户可选 Simple、Auto、Agentic；Auto 先走 Fast Path，再根据复杂度、查询长度和本地证据充分性决定停留 Simple 或升级 Agentic。路由写入 `route.selected`，并有配置化长度和预算保护。

### A5. Agent 调用工具失败后怎么重试和兜底？

工具先过 Tool Registry（工具注册表）和统一执行外壳，记录 `tool.call`，再做白名单、权限、审批和幂等检查，最后写 `tool.result／failed／blocked`。只读工具可在预算内重试或换本地证据；写工具结果未知时不自动重放；联网、重排、图谱失败则回退现有证据或拒答。

### A6. 执行到一半中断，状态如何保存和恢复？

LangGraph 状态由 Redis Checkpointer（检查点器）按 `threadId` 保存，PostgreSQL 保存 Run 和事件。前端收到 interrupt（中断）后完成人工审批，再调用恢复接口从 Checkpoint 继续。

### A7. 如何避免 Agent 死循环或者重复调用同一个工具？

显式状态图限定边，Reflection 只有重检索或结束；Run 设置 `maxSteps`、`maxToolCalls`、`maxDelegations` 和最大重试，超限写 `budget.exceeded`。副作用工具使用幂等指纹，已完成则恢复结果，执行中或未知则阻断。

### A8. MCP 在项目中解决了什么问题？

MCP 把 RAG 能力变成 AI 编程工具可发现、可校验、可调用的标准工具，让 Codex、Cursor、Claude Code 等编码前自动取内部组件、活动规则和工作流交接物。它是协议入口，不替代 RAG 后端、Admin 或业务 API。

### A9. 为什么使用 MCP，而不是直接调用 API、SDK 或 RPC？

内部服务间仍用 HTTP API；MCP 用在多个 AI 客户端统一发现和调用工具的边界。只有单一确定调用方、强事务或极低延迟诉求时，直接 API／SDK／RPC 更简单。

### A10. MCP 中设计了哪些 Tools（工具）？每个 Tool 的粒度怎么确定？

当前有 13 个工具：健康、证据搜索、编码上下文、直接问答、图谱、Agent 领域、多 Agent 管线、工作流上下文、活动列表，以及游戏方案、上线清单、埋点、多地区检查。按单一意图、可验证输入输出和清晰权限拆分；例如 `rag_search` 只给证据，`rag_ask` 才生成答案。

### A11. MCP 如何处理用户权限、租户隔离和数据安全？

MCP 不直连存储，只携带 JWT 或后端只存 hash 的长期 API Key 调 RAG API；后端按认证 `userId` 在 PostgreSQL、Redis、Milvus 和 BM25 隔离，并执行权限、版本和生命周期过滤。当前是用户级隔离和基础 RBAC；企业 IAM、ABAC、凭证中心和 DLP 仍待接入。

### A12. RAG 的完整流程是什么：文档如何处理、存储、召回和生成？

入库：原始资料 → 解析与快照 → 来源、空内容、注入和元数据门禁 → 父子切块 → PostgreSQL → 按文档适用性并行写 Milvus、BM25／Elasticsearch、Neo4j 和 Obsidian 编译知识 → 必要索引完成后切换生效；Karpathy 本地知识是受治理直答与降级资产，不是独立在线链路。查询：Direct Answer Gate（精确直答门禁）→ 未命中后统一 Hybrid RAG → 权限／版本过滤 → RRF（倒数排名融合）→ Rerank（重排）→ 上下文预算 → 生成 → 引用校验 → 补证或拒答 → Query Log（查询日志）和审计。

### A13. 为什么用 RAG，而不是全文检索或直接把文档放进上下文？

全文检索擅长精确词但不懂语义，所以项目把 BM25／ES 纳入混合检索；全文塞上下文会带来 Token、版本污染、权限和 Lost in the Middle（中间信息遗失）问题。RAG 是先筛选和排序证据，再生成可引用答案，不是替代全文检索。

### A14. 文档数量不多时，还有必要使用 RAG 吗？

不一定。几份短且稳定的文档可直接上下文或关键词搜索；一旦有权限、版本、频繁更新、引用责任或增长预期，RAG 的治理价值就出现。项目采用 RAG 主要因为跨角色和版本复杂，而非单纯文件多。

### A15. RAG 没有召回正确内容时，怎么定位和优化？

依次检查文档是否解析且 `effective`（生效）、切块是否破坏表格／标题、权限与版本过滤、查询改写、各路候选、RRF／Rerank（重排），以及上下文预算是否裁掉强证据。修复后加入回归集，不能只调大 TopK（返回前 K 条结果的数量）。

### A16. 如何判断模型生成的答案是否可信？

不看模型自报置信度，而看证据：检索先过充分性门禁，事实论断带片段引用，生成后做引用支撑校验；引用不足时抽取式回退，仍撑不住就拒答。评测关注忠实度、引用覆盖、拒答和版本／权限正确性。

### A17. 会话记忆、执行状态、审计记录分别解决什么问题？

记忆保存用户说过什么，服务连续对话；执行状态保存 Agent 当前节点和中间结果，服务恢复；审计保存谁在何时用什么证据和工具做了什么，服务追责排障。项目分别用 Redis／Mem0、LangGraph Checkpoint、PostgreSQL Run／Event／Action 实现。

### A18. 大模型失败、超时或输出格式错误时怎么处理？

超时／限流做受预算约束的有限重试与退避；结构化输出用 Zod Schema 校验，失败后有限重试或启发式降级；充分性 Judge 失败可按本地分数兜底；最终生成失败则保留证据、记录错误并拒绝伪造成功。所有降级必须可观测。

## 四、可观测、审计与安全（9 题）

### O1. AI 应用如何做全链路可观测？

HTTP 层记录请求和延迟；Agent 节点层记录路由、检索、充分性、工具、引用和重试；LangFuse 记录 Trace、Span、Token 和估算成本；Prometheus 记录调用量、延迟、空召回、失败和熔断；运行中心按 Run 汇总时间线和 Failure Onset。

### O2. 一次请求经过了哪些 Agent、节点和工具，怎么追踪？

请求创建 `runId`，所有事件带 `runId／threadId` 和递增 sequence。`route.selected` 表示选路，`node.started` 表示节点，`retrieval.completed` 表示检索，`tool.*` 表示工具，`approval.*` 表示审批，`run.completed／failed` 表示终态；后台按序回放。

### O3. 大模型调用失败时，从哪里开始定位？

先看 Failure Onset 找第一个失败事件，再区分 Provider 超时／限流、Prompt／Schema、上下文过长、检索为空或工具缺输入；随后核对节点耗时、输入摘要、模型配置、重试／降级事件和回归结果，不从“模型不稳定”开始猜。

### O4. 系统需要记录哪些日志、指标和状态？

日志记录请求 ID、用户／租户、路由、节点、错误码和耗时；指标记录请求量、p50／p95、LLM 与 Token、召回、工具成功率、拒答、重试、熔断和预算；状态记录当前节点、Checkpoint、任务终态、审批、版本和 Artifact。密钥、密码和不必要的敏感 Prompt 不入日志。

### O5. 审计追踪具体审计哪些信息？

包括发起人、模式与角色、Prompt／策略版本、节点序列、检索 Profile、证据 ID、工具和参数摘要、权限／审批、幂等键、结果预览或 Artifact ID、错误、预算、终态和耗时。查询快照保存 hash 而非原始 query，工具参数保存预览、hash 和字节数。

### O6. 敏感信息如何识别和脱敏？

当前已落地的是最小化记录：查询只留 hash／长度，Token 事件不进 Trace 明细，工具入参只留截断预览和 hash，大结果外置，API Key 只存 hash，密钥不进代码和日志；入库／检索还检测 Prompt Injection（提示注入）。这不等于完整 DLP，身份信息识别、字段级脱敏、水印、保留周期和删除请求仍待企业接入。

### O7. 如何控制模型幻觉和错误输出？

来源／版本门禁 → 权限过滤 → 混合召回与 Rerank → 充分性判断 → 不可信证据隔离 → 引用约束 → 引用支撑校验 → 不足拒答 → Bad Case 回归。结构化交付物再用 Answer Contract（答案契约）标记证据覆盖和待确认项。

### O8. 如何积累 Bad Case，并持续优化系统？

反馈先写 `rag_feedback`；运营查看原问题、答案、引用和检索快照后，选择驳回、保留纠正层、待晋升或核验来源后晋升正式知识。勾选回归只创建评测用例，不直接让纠错生效；正式晋升后进入版本和权限治理，并移除重复纠正向量。

### O9. Prompt、知识库和模型变化后，怎么做回归测试？

固定版本化数据集和期望证据，记录 Prompt、模型、知识版本和工具策略；改动后跑 Recall／MRR／NDCG、忠实度、引用、拒答、注入、Agent 步骤合法性和稳定性测试，与基线比较。未过门禁不切换 `effective`，Evidence Report（证据报告）由人工决定是否发布。

## 五、AI 编程方法论（8 题）

### C1. 你平时如何使用 AI 完成一个完整需求？

固定为 Spec（规格）→ Plan（计划）→ Tasks（任务）→ Execute（执行）→ Verify（验证）→ Review（审查）。先读规则、Roadmap 和源码，明确边界与验收，再做局部修改并跑类型、测试、构建、Smoke 和 Diff，最后同步真实进度；MCP 用于编码前取项目上下文。

### C2. AI 编程和传统编程有什么区别？

工程标准没变，变化的是候选实现生成速度。AI 容易过度实现、引用不存在 API、忽略仓库状态或把假设写成事实，所以开发者要加强上下文、约束、任务拆分、证据核验和自动验收，不能把 AI 当自动驾驶。

### C3. 如何保证 AI 生成代码的正确性和可维护性？

用仓库规则限制技术栈和范围，用类型与 Schema 限制接口，用测试／构建／Lint／Smoke 验证行为，用 Diff Review 检查越界和隐性重构。只做可追溯的最小改动，不通过注释错误或 mock 绕过验证；未验证不能写“已完成”。

### C4. AI 生成了你不熟悉的技术方案，你会怎么验证？

先查官方文档、SDK 源码或官方示例，逐字段对比 API、Header、Body、生命周期和错误语义；再做最小 PoC 和失败用例，最后接入主链路。两轮仍无进展就停止猜测，改查参考实现或工作版本 Diff。

### C5. 你有没有沉淀 Rules（规则）、SPEC（规格）或项目上下文？

有。`CLAUDE.md` 固化技术栈、红线和验证；`ROADMAP.md` 是真实进度源；架构、PRD、服务边界和功能步骤描述实现；复杂改动先形成 Spec／Plan，运行后保存 Evidence；RAG MCP 再把上下文提供给外部 AI 工具。

### C6. AI 生成代码发生错误时，你怎么定位是提示词、上下文还是代码问题？

先用同一输入复现。需求理解或输出结构错误查 Prompt／Answer Contract；不存在的模块、旧接口或错误业务事实查上下文；理解正确但执行失败按普通代码问题查类型、状态、并发和边界。一次只改一个变量，用最小复现证明归因。

### C7. 个人 AI 项目和真正的商业产品，主要差在哪里？

商业产品还需真实数据质量、身份权限、版本治理、审计合规、SLA、成本容量、备份恢复、灰度回滚和运营责任。当前项目有企业级原型主链路和本地闭环，但真实 IAM、DLP、生产压测、长期稳定性和业务收益仍是边界。

### C8. 你认为 AI 时代的开发者还需要具备哪些能力？

更需要业务建模、系统设计、数据与评测、调试归因、安全边界和结果验收。关键是判断什么该自动化，把开放目标变成可验证任务，证明结果可靠，并定位失败在数据、检索、模型、工具还是工程层。

## 六、HR 与职业选择（7 题）

> 仓库无法证明个人 HR 事实。请把方括号替换成真实信息，并统一简历、BOSS 和 HR 中的月薪、年包、奖金与 Offer 口径。

### H1. 为什么离开上一家公司？

**模板：** 上一段经历让我积累了[真实能力]，但后续工作重心与我希望深入的 AI 应用工程方向逐渐不一致。我已通过当前 RAG 项目完成从检索、Agent 到评测运营的系统实践，所以寻找能把这些能力用于真实业务并承担结果责任的岗位。不要批评前公司或编造组织原因。

### H2. 空窗期做了什么？为什么现在重新找工作？

**模板：** 空窗期完成了[真实事项一／二／三]。可展示成果是当前 RAG 项目：补齐文档治理、Hybrid RAG、Agentic、MCP、审计和评测闭环，并有代码、测试和 Roadmap 证据。现在求职是因为作品验证已到可进入真实团队继续检验的阶段。

### H3. 为什么考虑深圳？

**模板：** 我考虑深圳基于[岗位密度／业务方向／家庭安排／长期发展]，会综合团队、职责、稳定性、通勤和生活成本。若地点尚未确定，就说明可接受范围和决策条件，不编造理由。

### H4. 你最看重下一份工作的哪些因素？

真实 AI 业务与数据、岗位结果边界、团队工程标准与反馈、成长空间，再综合薪资和地点。我希望参与数据、评测、稳定性和业务闭环，而不只调用模型。

### H5. 上一份工作的薪资结构是什么？

**模板：** 固定月薪[真实数字]，一年[真实月数]薪，奖金／补贴[真实规则]，实际税前年包约[真实数字]；期望更关注[月 Base／总包]，计算公式是[明确公式]。未兑现奖金或股票不计入已获年包。

### H6. 目前还有哪些 Offer 或面试在推进？

**模板：** 目前有[真实数量]个流程，处于[真实阶段]；会按岗位匹配、团队方向和时间节点决策。可说明决策时间，不虚构公司或 Offer 施压。

### H7. 你有什么问题想问我们？

可问：入职前三个月最重要的 AI 问题是什么？瓶颈在数据、检索、模型、稳定性还是 Adoption（采用）？团队如何建评测集并判断上线？Agent 可调用哪些系统，权限审计怎么做？岗位结果用什么指标衡量？

## 七、简历关键词的七层追问（7 题）

### P1. 是什么？

先给边界定义。例如：Agent 是围绕目标维护状态、选择工具、执行步骤并判断结束的运行系统；本项目用 LangGraph 把它约束为可检查状态机。

### P2. 为什么用？

从业务矛盾推方案：复杂产研任务需要动态取证、跨角色依赖和恢复，普通一次性 RAG 不够；简单事实题仍走普通代码和 Fast Path。

### P3. 具体怎么实现？

按输入 → 核心步骤 → 状态／存储 → 输出讲。Agentic 示例：请求与上下文 → 扩展和并发检索 → 充分性、工具、生成和引用门禁 → Checkpoint 与事件 → 带引用答案／Artifact。

### P4. 你本人做了什么？

只列自己能打开代码、解释取舍和复现验证的部分。团队人数、职责和个人贡献必须按真实经历替换；外部基础设施和生产部署不能算个人已完成。

### P5. 出错了怎么办？

讲错误分类、幂等、降级、审计和恢复，不能只说“加重试”。例如检索超时快速失败并退 BM25；写工具结果未知时停止重放；证据不足则拒答。

### P6. 效果怎么证明？

用数据集、基线、指标和原始报告证明。当前项目可说本地评测、测试、构建和 Smoke 证明工程链路；不能把本地模拟集、成熟度分数或几次回放说成生产业务收益。

### P7. 重新做会怎么改？

优先补真实数据和生产证据：接 IAM／DLP，建设专家毒题和线上反馈集，做生产压测、故障演练和跨实例恢复，再按指标决定是否保留 GraphRAG、多 Agent 等复杂能力。

## 八、项目证据索引

| 能力 | 主要证据 |
|---|---|
| 背景与边界 | `docs/PROJECT_BACKGROUND.md`、`docs/interview/resume/resume-rag-project.md` |
| 完整功能流程 | `docs/interview/功能步骤流程.md` |
| Agentic、充分性、引用、恢复 | `backend/src/rag/agentic/agentic-rag.service.ts`、`backend/src/rag/agentic/agentic-rag.state.ts` |
| 路由与请求快照 | `backend/src/modules/chat/chat.service.ts` |
| Run、Event、Action、Failure Onset | `backend/src/modules/agent-runs/`、`backend/src/modules/agent-runtime-events/`、`backend/src/modules/agent-runtime/` |
| 工具权限、审批、幂等 | `backend/src/tools/tool-execution.service.ts`、`backend/src/tools/tool-execution-policy.service.ts` |
| MCP 工具和认证 | `tools/rag-mcp-server/README.md`、`tools/rag-mcp-server/src/server.ts` |
| RAG 与引用门禁 | `backend/src/rag/karpathy/karpathy-rag.service.ts`、`backend/src/rag/karpathy/context-builder.ts` |
| Bad Case | `backend/src/modules/chat/rag-feedback.service.ts`、`backend/src/rag/prompts/bad-case-flywheel.service.ts` |
| 可观测 | `backend/src/providers/observability/langfuse.provider.ts`、`backend/src/providers/observability/observability.controller.ts`、`backend/src/modules/metrics/` |
| 当前验证与边界 | `ROADMAP.md` |

## 九、使用方式

1. 第一轮只练每题首段，控制在 30～45 秒。
2. 被追问再补实现和边界，不一次倾倒全部组件。
3. 所有数字面试前重新对照 `ROADMAP.md` 和最新 Evidence。
4. 新问题必须绑定代码、测试或文档；无法绑定就降级为“理解但未落地”。
