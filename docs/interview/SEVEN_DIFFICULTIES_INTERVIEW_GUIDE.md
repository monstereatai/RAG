# 七个 Agent／RAG 技术难点面试讲解稿

更新时间：2026-08-10

## 一、先记住整条主线

这七个难点不是七项互不相关的技术，而是在解决一条企业 Agent 应用链路中的七类核心问题：

| 难点                  | 解决的问题                           | 面试关键词                                                    |
| --------------------- | ------------------------------------ | ------------------------------------------------------------- |
| 1. 产研运协作 FSM     | 复杂任务怎样不乱跑                   | LangGraph、状态机、单／多岗位、Checkpoint、按需审批、防死循环 |
| 2. 快慢路径路由       | 怎样兼顾效果、延迟和成本             | simple、auto、agentic、充分性判断、预算上限                   |
| 3. 混合检索与结构切片 | 怎样查得准、引用撑得住               | Chunk、BM25／ES、Vector、RRF、Rerank、父子块、source span     |
| 4. 分层结构化记忆     | 长对话怎样记住关键事实又不污染上下文 | 短期记忆、结构化摘要、Redis Checkpointer、版本、生效期        |
| 5. Agent Evals        | 怎样证明系统真的有效                 | Recall、Faithfulness、任务成功、步骤准确、工具成功、回归门禁  |
| 6. Bad Case 数据飞轮  | 系统怎样从错误中持续改进             | 负反馈、归因、人工审核、动态 Few-Shot、回归集                 |
| 7. 节点级可观测性     | Agent 出错时怎样定位是哪一层         | Trace、Span、节点耗时、TTFT、工具调用、循环终止原因           |

当前本地工程门禁已覆盖七项能力：30 次完整六岗位 DAG 回放全部完成，180 次岗位模型调用全部成功；Simple／Agentic 各 30 个本地性能样本通过 `local` profile；Redis Checkpointer 双进程共享 Redis 恢复、Milvus Bad Case 回灌／清理和已配置 LangFuse 真实 trace／flush／health 均通过。这里的“通过”只表示代码路径、依赖降级和门禁可执行，不替代真实业务数据、线上流量或生产 SLA。

面试时统一使用下面的表达顺序：

```text
业务背景 → 发现的核心矛盾 → 方案对比 → 我的选择 → 具体实现 → 验证效果 → 适用边界
```

不要上来就说“我用了 LangGraph、Milvus、Rerank”。技术名词只能说明用过工具，说明不了为什么这样设计。

---

## 二、难点一：六岗位产研运协作 LangGraph FSM

### 1. 业务背景

游戏官网和活动项目会涉及产品、设计、前端、后端、测试和运营。复杂任务如果直接交给一个 ReAct Agent，容易出现三个问题：

- 模型自己决定步骤，可能跳过测试、运营或异常流程。
- 多次工具调用和反思可能形成死循环。
- 任务暂停或服务重启后，无法稳定恢复到原来的岗位和状态。

同时，并不是所有任务都需要六岗位完整执行，也不是所有岗位结果都需要人工审批。强制全链路和强制审批会让简单任务又慢又贵。

### 2. 我比较过的方案

| 方案           | 优点                                   | 缺点                                 | 结论                               |
| -------------- | -------------------------------------- | ------------------------------------ | ---------------------------------- |
| 单 Agent ReAct | 灵活，代码少，能动态选工具             | 顺序不稳定，难保证必经节点，容易循环 | 只适合开放探索，不适合正式产研流程 |
| 固定 Chain     | 顺序清楚，实现简单                     | 不擅长暂停、恢复、分支和回退         | 适合很短的无状态流程               |
| 自研 FSM       | 控制力强                               | 状态持久化、中断恢复和图调试成本高   | 没必要重复造完整编排基础设施       |
| LangGraph FSM  | 有状态图、条件边、Checkpoint、中断恢复 | 需要提前定义状态和流程边界           | 最符合当前可控协作需求             |

### 3. 我的选择

我采用“固定业务 DAG＋可组合岗位节点＋节点内使用 LLM”的方式：

- 六个岗位都能单独使用，也能任选多个组合。
- 完整链路按 `产品→设计／后端并行→前端→测试→运营` 执行。
- 后续岗位只读取自己的依赖结果，不把无关上下文全部塞进去。
- 普通任务自动流转；指定岗位或达到风险阈值时才暂停审批。
- 同一批次被驳回时只重跑有问题的岗位，保留已通过结果。

这不是六个 Agent 自由群聊，而是受控的结构化交接。自由讨论看起来更“智能”，但正式交付更需要可预测和可追踪。

### 4. 具体实现

- 使用 LangGraph `StateGraph` 管理准备、批次执行、审批和恢复状态，业务依赖由显式 DAG 计划器生成。
- `roles` 支持选择一个、多个或全部岗位；没有依赖冲突的岗位使用 `Promise.all` 并行执行。
- 每个节点通过 Zod 约束真实 Markdown 交付物、事实声明、证据、风险和就绪状态。
- 每个岗位只允许调用自己的知识检索工具，单节点最多一次，8 秒超时后降级。
- 事实声明必须引用本次检索返回的 evidence ID；非法或缺失引用自动降为待确认，不能通过证据门禁。
- 岗位文档提交到统一产物中心，可继续生成 Word、Excel、图片等分享文件。
- 结构化输出失败最多重试两次，避免无限重试。
- `approvalMode=auto|required|risk_based` 控制自动、全批次或风险／指定岗位审批。
- 启动和审批 API 只负责接收命令并快速返回 `running + threadId`，长耗时模型节点后台运行；前端轮询 checkpoint 状态，避免一个六岗位任务占住 HTTP 请求数分钟。
- Redis Checkpointer 保存 30 天，使用 `threadId` 恢复，状态按 owner 隔离。
- `maxSteps` 是硬退出条件，避免连续驳回或状态错误造成死循环。

核心代码：`backend/src/modules/workflow/production-workflow.service.ts`。

### 5. 验证效果

- 单岗位前端审查可以独立完成。
- 完整六岗位 DAG 会生成五个批次，其中设计与后端并行。
- 风险审批和指定岗位审批都只暂停必要批次。
- 驳回设计／后端批次时，可以只重跑后端并保留设计结果。
- 非法 evidence ID 会被降为待确认，缺少证据时结果不能冒充已就绪。
- 专项回归覆盖依赖正确率、交付完整率、证据门禁、产物生成、局部重跑、工具预算和 owner 隔离。

### 6. 面试口述版

> 我们的业务不是所有问题都适合自由 ReAct。游戏官网活动有明确的产品、设计、研发、测试和运营依赖，所以我用 LangGraph 管状态，用显式 DAG 管业务依赖。六岗位既能独立使用，也能组合；完整链路中产品先执行，设计和后端并行，前端等待两者，测试再做门禁，最后交给运营。每个岗位输出真实 Markdown、关键声明和证据引用，引用不成立就降为待确认。普通任务自动流转，只有指定岗位或达到风险阈值才审批；驳回时局部重跑，不浪费已通过结果。Redis Checkpointer 负责跨请求恢复，maxSteps、工具预算和超时负责防循环。这样保留节点内推理，同时把协作过程控制在可验证边界内。

### 7. 常见追问

**为什么不全部使用 ReAct？**

ReAct 适合路径未知的探索型任务。产研流程的岗位依赖和上线门禁是已知规则，交给模型自由决定会降低稳定性，所以采用 workflow first，只有节点内部保留模型推理。

**为什么不所有节点都审批？**

审批是成本，不是越多越企业级。日常草稿自动流转，正式上线、高风险规则和关键变更才需要人工责任人介入。

**Agent 死循环怎么处理？**

使用最大步骤、每节点调用次数上限、明确终止状态、工具超时和失败降级；可观测层同时记录循环终止原因，不能只依赖 Prompt 里写“不要循环”。

---

## 三、难点二：快慢路径路由

### 1. 业务背景

知识库问题的复杂度差异很大。“某个接口字段是什么”只需要检索和生成；“为东南亚服抽奖活动生成完整方案”才需要多轮检索、工具调用和反思。如果所有问题都进入 Agent，会增加首字延迟、Token 成本和失败概率；如果全部走普通 RAG，复杂任务又容易漏步骤。

### 2. 方案对比

| 方案                  | 优点                               | 缺点                                 |
| --------------------- | ---------------------------------- | ------------------------------------ |
| 全部普通 RAG          | 快、便宜、稳定                     | 复杂任务拆解和工具使用不足           |
| 全部 Agentic RAG      | 能处理复杂任务                     | 延迟高、成本高、状态更多、出错面更大 |
| 规则路由              | 可解释、便宜                       | 对表达变化敏感，维护规则成本高       |
| LLM 路由              | 语义判断能力强                     | 路由本身也有成本和误判               |
| Fast Path＋充分性升级 | 简单任务先快速回答，证据不足再升级 | 需要设计可靠的充分性门禁             |

### 3. 我的选择

系统提供三种模式：

- `simple`：固定走混合检索、上下文组装和生成。
- `auto`：先走 Fast Path，再根据证据充分性决定是否升级 Agentic。
- `agentic`：用户明确要求复杂研究或工具编排时强制进入图。

`auto` 不是只靠问题长度判断，而是结合检索命中、证据数量、引用覆盖、置信度和任务复杂度。

### 4. 具体实现

- Fast Path 使用 Karpathy RAG＋Obsidian 高优先级知识上下文。
- 充分性不足时进入 LangGraph，执行查询扩展、检索、充分性判断、Rerank、生成、按需审批和反思。
- 对查询扩展数、检索次数、Chunk 数、联网结果、Rerank TopN 和反思次数设置预算。
- 向量、联网或 Rerank 失败时可以降级，不让单个外部能力拖垮整条链路。

### 5. 验证效果

- 项目真实服务回放 `simple／auto` 共 `28／28` 通过。
- 首 Token、节点耗时和升级路径进入可观测指标。
- 这里的 `28／28` 是当前项目回放结果，不冒充真实公司线上效果。

### 6. 面试口述版

> 我没有让所有问题都跑 Agent，因为 Agent 的推理和工具链会显著增加延迟、成本和故障面。我设计了 simple、auto、agentic 三档。simple 处理事实查询；auto 先跑混合检索 Fast Path，再根据证据数量、引用覆盖和置信度做充分性判断，不足才升级 LangGraph；agentic 用于用户明确要求的复杂任务。每条路径都有查询数、Chunk、工具和反思预算，外部能力失败可降级。核心目标不是让每次调用看起来更智能，而是在效果足够时尽快结束。

### 7. 常见追问

**auto 怎么判断要不要升级？**

看当前证据是否足以回答，而不是只看问题长短。核心信号包括相关文档命中、有效 Chunk 数、来源覆盖、引用可支撑度、冲突信号和任务是否需要外部工具。

**怎样防止路由误判？**

评测集按事实查询、跨文档、复杂方案、拒答和工具任务分层统计；误判案例进入 Bad Case。高风险任务允许用户强制选择 `agentic`。

---

## 四、难点三：混合检索与结构保护切片

### 1. 业务背景

游戏活动知识同时包含自然语言、活动概率表、接口字段、错误码、代码、地区规则和测试清单。纯向量检索擅长语义，但容易漏掉缩写、版本号和精确字段；纯关键词检索能找精确词，却不理解同义表达。更麻烦的是，如果入库时把表格、接口和章节关系切碎，后面再好的向量模型也救不回来。

### 2. 切片方案对比

| 方案                 | 优点                          | 缺点                                       |
| -------------------- | ----------------------------- | ------------------------------------------ |
| 固定字符切片         | 简单、吞吐稳定                | 容易切断标题、表格、代码和接口契约         |
| 纯语义切片           | 语义完整                      | 成本较高，边界不稳定，表格和代码仍可能受损 |
| 按 Markdown 标题切片 | 保留文档层级                  | 超长章节仍需二次拆分                       |
| 结构优先＋长度兜底   | 同时保护结构并控制 Chunk 大小 | 实现复杂度更高                             |

### 3. 我的选择

先按标题、段落、表格、代码围栏和业务内容类型识别结构，再在结构内部按长度切分。每个 Chunk 保留：

- 完整 `headingPath`。
- 父子 Chunk 关系。
- `source span` 和文档版本。
- 表格重复表头。
- API、配置、测试、地区规则等内容类型。

检索阶段采用 BM25／Elasticsearch＋向量召回，再用 RRF 融合和 Reranker 精排。

### 4. 为什么需要 Reranker

Embedding 召回的目标是“尽量别漏”，所以候选集合通常较大，里面会有主题相关但不能回答问题的 Chunk。Reranker 对“问题－候选片段”做更细的相关性判断，把真正能支撑答案的证据排到前面。

它不能修复完全没召回的文档，所以顺序必须是：

```text
多路召回扩大候选覆盖 → RRF 合并 → Reranker 提高 TopK 精度
```

### 5. 具体实现

- Markdown Chunker 保护标题层级、表格、代码围栏和接口契约。
- 表格分块时重复表头，保留空单元格与转义竖线语义。
- 向量召回负责语义，BM25／ES 负责专有名词、字段、错误码和版本号。
- RRF 融合不同分值空间，避免直接相加不可比。
- Rerank 后做同 Section／相邻块扩展、语义去重、单文档限额、来源多样性和上下文预算。
- Lost-in-the-Middle 排布避免最重要证据全部挤在上下文中段。
- 向量失败时降级 BM25／ES。

### 6. 怎样评测召回

- `Recall@K`：标准证据是否进入前 K 个候选。
- `Precision@K`：前 K 中有多少真正相关。
- `MRR`：第一个正确证据排得有多靠前。
- `nDCG@K`：多个不同相关等级证据的整体排序质量。
- 文档命中率与 Chunk 命中率：避免只命中文档却没找到正确段落。
- 过滤正确率：版本、地区、权限和生命周期是否过滤正确。
- 排序稳定性：同义改写后核心证据是否保持稳定。
- 降级可用性：向量或 Rerank 失败时是否仍能返回可用结果。

### 7. 面试口述版

> 我把召回问题拆成“入库时有没有保存好证据”和“查询时有没有把证据排上来”两层。入库侧不是固定长度硬切，而是先保护标题、表格、代码和接口契约，再做长度兜底，并保留 headingPath、父子关系和 source span。查询侧用向量召回语义，用 BM25／ES 召回缩写、版本号和精确字段，通过 RRF 融合，再用 Reranker 提高 TopK 精度。最后做相邻块扩展、去重、来源多样性和上下文预算。评测不只看最终答案，还看 Recall@K、MRR、nDCG、过滤正确率、稳定性和降级行为。

### 8. 常见追问

**Chunk 多大合适？**

没有统一数字。自然段、表格、代码和接口契约的边界不同。先保护结构，再通过真实评测比较不同大小和 overlap；目标是一个 Chunk 能独立支撑一个事实或步骤，而不是机械追求某个 Token 数。

**怎样提高召回准确率？**

先定位是召回漏失、过滤错误还是排序错误，再分别优化切片、元数据、查询改写、多路召回、RRF 和 Rerank。直接换更大的 Embedding 模型通常不是第一步。

---

## 五、难点四：分层结构化记忆

### 1. 业务背景

长对话如果把所有历史原文都塞回模型，会造成 Token 膨胀、响应变慢和旧信息干扰。只做一段自然语言摘要又容易丢掉“谁决定了什么、哪个版本生效、还有哪些问题没解决”。跨进程恢复还需要把执行状态持久化，不能只放进应用内存。

### 2. 方案对比

| 方案                 | 优点                       | 缺点                           |
| -------------------- | -------------------------- | ------------------------------ |
| 全量历史拼接         | 信息最完整                 | Token 持续增长，旧事实污染严重 |
| 滑动窗口             | 简单、成本可控             | 早期关键决策会被丢弃           |
| 自然语言摘要         | 压缩率高                   | 字段不可控，版本和证据容易丢   |
| 向量长期记忆         | 可跨会话召回               | 可能召回过期或不相关记忆       |
| 结构化摘要＋近期原文 | 保留关键字段并维持近期语境 | 需要设计摘要 schema 和版本规则 |

### 3. 我的选择

记忆分成三层：

- 近期原文：保留最近 6 轮，维持当前交流语境。
- 结构化短期摘要：记录 facts、decisions、openIssues 和 sourceDigest。
- 工作流状态：通过 Redis Checkpointer 保存当前岗位、步骤、审批和结果。

事实额外保存角色、模块、变更前后、版本、生效期和证据，防止旧版本被当成当前事实。

### 4. 具体实现

- 对话超过约 2000 Token 时触发压缩。
- 被移出窗口的历史由模型整理成结构化摘要。
- 模型压缩失败时保留旧摘要和受限原文，不静默丢数据。
- 工作流 checkpoint 使用 30 天 TTL，并按 thread 和 owner 隔离。
- 长期知识仍由 RAG 检索，不把所有历史对话都当成永久事实。

### 5. 面试口述版

> 我把记忆和知识分开了。知识库保存经过治理的长期事实，记忆主要保存当前任务上下文。短期记忆超过约 2000 Token 后压缩，但保留最近 6 轮原文；更早内容不是压成一段散文，而是抽成 facts、decisions、openIssues 和 sourceDigest，事实还保留版本、生效期和证据。LangGraph 的执行状态由 Redis Checkpointer 持久化，支持跨请求恢复。这样既控制 Token，又避免摘要把关键决策和版本关系抹掉。

### 6. 常见追问

**用户三天后问另一个问题，怎样关联？**

通过用户、项目和 thread 识别会话；近期任务状态从 checkpoint 恢复，长期事实重新从带项目、版本和权限过滤的知识库检索。不能只靠模型“记住”。

**记忆存在哪里？**

不同层存储不同内容：Redis 保存可恢复的工作流 checkpoint，数据库保存业务会话和治理数据，向量／检索系统保存可召回知识。介质不是重点，关键是生命周期、作用域和更新规则。

---

## 六、难点五：Agent Evals

### 1. 业务背景

只看最终答案“像不像对的”无法判断 Agent 是否漏步骤、调用错工具、引用不忠实或本应交给人工却自行决定。Prompt、Chunk、模型或 Rerank 的任何变化都可能修好一类问题，同时破坏另一类问题。

### 2. 方案对比

| 方案                      | 优点                           | 缺点                   |
| ------------------------- | ------------------------------ | ---------------------- |
| 人工抽查                  | 判断细致                       | 慢、贵、不可稳定回归   |
| 只看最终答案相似度        | 自动化简单                     | 无法判断证据和执行过程 |
| 只用 LLM-as-Judge         | 能评语义                       | 有偏差、波动和调用成本 |
| 规则指标＋过程指标＋Judge | 可解释、可回归、覆盖结果和过程 | 评测体系设计成本更高   |

### 3. 我的选择

把评测拆成 RAG 效果和 Agent 执行两层：

- RAG：召回、排序、Faithfulness、引用覆盖、拒答和版本过滤。
- Agent：任务成功率、PRD 覆盖、测试用例完整度、工具成功率、步骤准确率和人工接管率。

确定性问题优先使用规则断言，语义质量再使用 LLM-as-Judge；Judge 不是唯一裁判。

### 4. 具体实现

- 建立 Agent 任务回归数据集，覆盖工作流、检索、工具降级、引用、拒答、记忆和 Bad Case。
- 记录 expectedSteps 与 actualSteps，判断是否漏步或乱序。
- 记录工具调用成功率，区分模型答错和工具失败。
- 检查输出中的 unsupported claims，约束答案必须由上下文支撑。
- 将评测放进质量门禁，避免只在演示前手工测试。

### 5. 验证效果和诚实边界

- 当前 Agent 数据集 8 个场景，任务／工具／步骤指标通过。
- 游戏活动专项数据为 8 文档／96 问题。
- 项目服务回放为 `28／28`。
- 这些是项目仿真和本地回归数据，不冒充真实企业线上业务评测。

### 6. 面试口述版

> 我不只评最终答案，而是把 Agent 拆成结果和过程两层。RAG 侧看 Recall@K、排序、Faithfulness、引用覆盖、拒答和版本过滤；Agent 侧看任务成功、步骤准确、工具成功、PRD 覆盖、测试用例完整和人工接管。确定性条件用规则断言，语义质量再补 LLM-as-Judge，并把 Bad Case 固化进回归集。这样 Prompt、检索或模型变化后，我能知道到底是召回退化、证据不忠实，还是 Agent 漏步骤。

### 7. 常见追问

**RAG 召回从哪些维度评测？**

离线看 Recall@K、Precision@K、MRR、nDCG、文档／Chunk 命中、过滤正确率；端到端看 Faithfulness、引用覆盖、答案正确性、拒答准确率；线上看点击、追问、点踩、人工接管、延迟和成本。

**LLM-as-Judge 靠谱吗？**

它适合语义评估，不适合当唯一真值。需要固定 rubric、结构化输出、温度控制、少量人工校准，并与确定性断言和业务标准答案组合。

---

## 七、难点六：Bad Case 数据飞轮

### 1. 业务背景

用户点踩如果只写进数据库，系统不会变好；如果未经审核就把用户反馈直接注入 Prompt 或知识库，又可能把恶意反馈、误判和过期答案扩大成系统性错误。

### 2. 方案对比

| 方案                   | 优点               | 缺点                            |
| ---------------------- | ------------------ | ------------------------------- |
| 只记录点踩             | 实现简单           | 不产生后续改进                  |
| 自动把反馈写回知识库   | 改进速度快         | 错误会被放大，污染正式知识      |
| 把所有坏例拼入 Prompt  | 使用直接           | Prompt 膨胀，低相关案例干扰回答 |
| 审核门禁＋相似坏例召回 | 质量可控，按需使用 | 需要审核流程和独立索引          |

### 3. 我的选择

建立“捕获→归因→人工纠正→进入回归集→按相似度召回”的闭环：

1. 用户负反馈进入待审池。
2. 人工标注错误类型和 corrected answer。
3. 只有 `reviewed／resolved`、存在纠正答案且允许进入回归集的负反馈才建立索引；撤销审核、取消回归或忽略案例时同步删除索引。
4. Simple 与 Agentic 共用结构化 Bad Case 检索协议，最多召回 2 条高相似案例。
5. Simple 增加 Correction Gate：精确／强命中采用纠正证据，弱命中只作为提示；当前知识证据仍优先，历史纠错案例不能覆盖新版本事实。

### 4. 具体实现

- Bad Case 使用独立 Milvus collection，避免污染正式知识向量。
- 使用 HNSW＋Cosine 做相似案例检索。
- 相似度门槛为 `0.85`，最多使用 2 条；`0.88` 以上标记为 correction，`0.95` 以上、问题归一化相同或存在明确实体包含关系标记为 exact，避免“韦水春”与“韦水春是谁”这类短问题漏命中。
- Simple 与 Agentic 都记录 Bad Case 命中级别；Simple 和 Agentic 对 exact／correction 都使用纠错事实重新生成自然答案，且 Agentic 在无知识库、检索不足和 Fast Fallback 前置检查 Bad Case，避免兜底分支绕过纠错证据；hint 仅注入生成上下文，避免把人工填写的纠正文本原样输出。
- 审核操作同时决定是否加入回归集。
- 管理后台支持查看、纠正和审核坏例。
- `backend/scripts/eval-bad-case-regression.mjs` 会读取有效回归案例，逐条执行 `simple／auto／agentic`，检查旧答案不再出现、纠正事实覆盖率和最终路由；命令为 `npm run eval:bad-case`。
- 当前正式知识先经过 Fast Path 充分性判断；已有新知识证据时，Bad Case 只能作为纠错提示，不能直接覆盖当前证据；只有当前知识不足时才启用强纠错答案。

### 5. 当前验证与边界

- Milvus 服务与 Node SDK 已对齐到兼容版本 `2.4.19／2.4.10`。
- 真实 smoke 已完成临时坏例插入、flush、向量命中、标量读回和清理，不再把“写入成功”当成整个检索闭环成功。
- 真实 smoke 会写入唯一临时审核样本，依次验证 flush、向量检索命中、标量回读和清理，当前全部通过。
- 主知识集合 `rag_chunks` 的 425 条数据已完成 HNSW 索引，真实搜索耗时 24ms。
- 当前本地有效案例已完成 `2 条 × 3 条链路 = 6／6` 回归通过；这证明本地完整链路可运行，但不能把本地回归说成生产长期稳定性，生产仍需要持续监控和真实业务流量回归。

### 6. 面试口述版

> 我没有让模型直接学习所有用户点踩，因为反馈本身可能是错的。我的 Bad Case 流程先捕获问题和召回快照，再由人工标错误类型、纠正答案和是否进入回归集。只有审核通过的负反馈才写入独立 Milvus collection。Simple 和 Agentic 共用结构化 Bad Case 检索协议，Simple 通过 Correction Gate 区分精确、强语义和弱语义命中，精确／强命中使用纠错事实重新生成自然答案，弱命中只作提示；不会把人工纠正文本原样返回。Prompt 明确当前生效知识证据优先，避免旧坏例覆盖新版本事实。这样数据飞轮是受治理的，而不是把错误自动放大。

### 7. 常见追问

**坏例应该修 Prompt、知识还是检索？**

先归因。事实错误修知识和版本；召回漏失修切片、元数据或检索；排序错误修融合和 Rerank；步骤遗漏修工作流；表达问题才考虑 Prompt。不能看到点踩就统一改 Prompt。

**为什么最多两条？**

Few-Shot 太多会占用上下文并把历史案例当成事实。高门槛、少量、相似、经审核，比堆积大量案例更稳定。

---

## 八、难点七：节点级可观测性与死循环诊断

### 1. 业务背景

Agent 最终回答失败，可能发生在解析、查询扩展、检索、Rerank、工具、生成、审批或反思中的任何一层。只有一条 HTTP 总耗时，只能知道“慢了或错了”，不知道哪一步出了问题。SSE 一次请求还会产生很多事件，如果按每个事件计数，会把一次请求误算成几十次。

### 2. 方案对比

| 方案                      | 优点                       | 缺点                              |
| ------------------------- | -------------------------- | --------------------------------- |
| 普通应用日志              | 接入简单                   | 无法还原完整 Agent 链路           |
| 只记录 HTTP 指标          | 能看 QPS 和总耗时          | 无法定位图节点和工具              |
| 全量打印 Prompt／上下文   | 调试直接                   | 泄露敏感数据，日志量巨大          |
| Trace＋节点指标＋脱敏快照 | 能定位节点、耗时和失败原因 | 需要统一 traceId、span 和采样规则 |

### 3. 我的选择

以一次 Agent 任务为一个 trace，每个图节点和工具调用为 span，同时记录业务指标：

- 节点成功／失败与耗时。
- 首 Token 时间 TTFT。
- 检索为空次数。
- 工具调用次数、成功率和耗时。
- 反思继续／终止原因。
- 循环步数和 `span_limit`。

日志和 trace 只记录必要摘要、哈希或脱敏数据，不打印密钥和完整敏感上下文。

### 4. 具体实现

- LangGraph 每个节点统一包裹 timing 和 tracing。
- SSE 发出 `node_timing`，前端和调用方能看到执行进度。
- 同一 thread 聚合到同一个 traceId。
- 超过 15 个节点标记 `span_limit`，辅助识别异常循环。
- Prometheus 记录节点耗时、TTFT、工具调用、空召回和循环终止。
- HTTP Metrics／Tracing interceptor 使用 RxJS `finalize`，一次 SSE 请求只在结束时计数一次。

### 5. 验证效果

- 真实 Agent 回放保留查询扩展、检索、充分性、Rerank、生成、审批节点和反思共 7 个节点。
- 修复前一次 SSE 因多个事件累计 76 条 HTTP 记录，修复后严格计为 1 条。
- 所有节点归属同一个 trace，可以区分检索慢、模型慢、工具失败和循环未终止。
- LangFuse 增加状态契约和主动 smoke：当前配置完整密钥后已创建 trace／generation 并 flush；本地未配置密钥时也会明确返回禁用原因，不把“未发送”伪装成已观测。

### 6. 面试口述版

> Agent 出错不能只看最终 500 和总耗时。我把一次任务作为 trace，把查询扩展、检索、充分性判断、Rerank、生成、审批和反思作为 span，记录每个节点的状态、耗时、TTFT、空召回、工具调用和循环终止原因。同一个 thread 归到同一个 trace，超过节点上限会标记 span_limit。我们还发现 SSE interceptor 原来在每个 next 事件都记一次 HTTP，导致一次请求被算成 76 次，后来改成 RxJS finalize，只在流结束时记录一次。可观测性不只是看大盘，而是能直接支持故障归因和 Bad Case 回放。

### 7. 常见追问

**怎么发现 Agent 死循环？**

同时看硬限制和行为信号：stepCount 超限、相同节点重复、相同工具与参数重复、状态没有进展、Token 持续增长。达到阈值后终止或转人工，并保留最后状态供回放。

**需要记录完整 Prompt 吗？**

开发环境可受控采样，生产环境默认记录 prompt version、输入摘要、哈希、Token 和证据 ID。完整 Prompt、用户隐私和密钥不能无条件写日志。

---

## 九、七个难点怎样连起来讲

### 30 秒版本

> 这个项目不是只做文档问答，而是面向游戏官网和活动产研流程的 Agentic RAG 工作台。我重点解决了七个问题：用 LangGraph FSM 控制六岗位独立或协作执行；通过快慢路径平衡效果、延迟和成本；用结构保护切片、混合召回、RRF 和 Rerank 提高证据质量；用结构化摘要和 Redis Checkpointer 管理记忆与恢复；建立 RAG 和 Agent 多维评测；把审核后的 Bad Case 转成回归集和动态 Few-Shot；最后用节点级 Trace 和 Prometheus 定位检索、工具、模型和循环问题。目标就是查得准、答得稳、引用能撑住、不会瞎编。

### 2 分钟版本

> 项目服务游戏官网、活动 H5 和版本专题的产品、设计、前后端、测试和运营。最初如果只做普通 RAG，能回答事实问题，但复杂方案容易漏步骤；如果全部使用自由 ReAct，又会带来流程乱序、死循环、延迟和成本问题。
>
> 所以第一层我用 LangGraph 建了可组合的产研 FSM，六岗位能独立也能协作，普通任务自动流转，重要任务按需审批，并用 Checkpoint 和 maxSteps 保证可恢复、可终止。工作流命令异步返回，真实模型在后台执行，页面按 threadId 轮询，避免完整 DAG 阻塞 HTTP。第二层做 simple、auto、agentic 路由，简单问题先走 Fast Path，证据不足再升级。
>
> 知识侧我先解决切片，保护标题、表格、代码、接口和 source span，再用向量＋BM25／ES 多路召回、RRF 融合和 Rerank 精排，最后做相邻块扩展、去重和上下文预算。长对话使用最近原文＋结构化事实、决策和开放问题摘要，避免旧版本污染。
>
> 质量上不只看答案，而是同时评召回、Faithfulness、引用、任务成功、步骤和工具成功；点踩经过人工归因后才能进入独立 Bad Case 索引和回归集。最后每个 Agent 节点都有 trace、耗时、TTFT、工具和循环终止指标，能定位到底是检索、排序、模型还是工具出了问题。当前本地工程门禁、项目回放和 Milvus Bad Case 读写检索闭环已通过，但真实企业数据效果、外部模型延迟稳定性和生产部署仍按真实边界说明，不会把本地结果吹成线上成绩。

## 十、面试时不能说错的边界

- 可以说六岗位工作流、按需审批、回退、Checkpoint 和测试已经实现。
- 可以说项目回放 `28／28`、Agent 任务数据集 8 条、游戏专项 96 问题是本地验证。
- 不要把本地仿真数据说成真实企业线上数据。
- 不要把一次本地 Bad Case smoke 通过说成生产长期稳定，生产结论仍需持续流量和监控支撑。
- 不要说 `93／100` 等于生产就绪，它只是当前本地工程成熟度门禁。
- 不要说 Agent 能替代产品、研发或测试负责人签字，重要决策仍由人工负责。
- 不要只背框架名。每个技术选择都要回到业务矛盾、替代方案和验证指标。

## 十一、七个难点对应的项目代码

面试时不要只说一个 Service 文件。建议按“入口负责什么、辅助模块怎样配合、用什么测试证明”三个层次讲。

### 1. 六岗位产研运协作 FSM

核心代码：

- `backend/src/modules/workflow/production-workflow.service.ts`：LangGraph 构图、批次执行、异步调度、审批、局部重跑、证据降级和产物生成。
- `backend/src/modules/workflow/production-workflow.plan.ts`：产品、设计、前端、后端、测试、运营的依赖关系和 DAG 批次计算。
- `backend/src/modules/workflow/production-workflow.state.ts`：工作流状态、岗位交付物、声明、证据、风险和工具轨迹模型。
- `backend/src/modules/workflow/production-workflow.tools.ts`：岗位工具白名单、调用预算、超时和失败降级。
- `backend/src/modules/workflow/production-workflow.dto.ts`：岗位选择、审批策略、风险阈值和局部重跑参数。
- `backend/src/modules/workflow/workflow.controller.ts`：异步启动、审批恢复和状态查询 API。
- `backend/src/providers/langgraph-checkpointer/redis-checkpointer.ts`：Redis checkpoint 和跨请求恢复。

管理后台：

- `admin-backend/src/modules/agent-ops/`：工作流、评测、Bad Case 和 trace 的后台代理。
- `admin/src/pages/agent-ops/index.tsx`：工作流启动、2 秒轮询、审批、局部重跑、证据和产物展示。

测试和评测：

- `backend/src/modules/workflow/production-workflow.service.spec.ts`
- `backend/src/modules/workflow/production-workflow.plan.spec.ts`
- `backend/src/modules/workflow/production-workflow.tools.spec.ts`
- `backend/eval/production-workflow-regression.dataset.json`
- `backend/scripts/eval-production-workflow.mjs`
- 验证命令：`npm run eval:production-workflow`

### 2. RAG 快慢路径

核心代码：

- `backend/src/modules/chat/chat.service.ts`：接收 `simple`、`auto`、`agentic` 模式并选择执行入口。
- `backend/src/rag/agentic/agentic-rag.service.ts`：路由、Query Augment、检索、充分性判断、Web Search、Rerank、生成、审批和 Reflection。
- `backend/src/rag/agentic/agentic-rag.state.ts`：Agentic RAG 状态定义。
- `backend/src/rag/karpathy/karpathy-rag.service.ts`：Simple Fast Path、混合检索和证据回答。
- `backend/src/rag/prompts/agentic.prompts.ts`：查询扩展、充分性判断和 Reflection Prompt。

测试：

- `backend/src/rag/agentic/agentic-rag.service.spec.ts`
- `backend/src/test/chat-modes.integration.spec.ts`

### 3. 结构保护切片与混合检索

切片代码：

- `backend/src/modules/document/chunking.util.ts`：标题路径、父子 Chunk、代码围栏、表格和业务结构保护。
- `backend/src/modules/document/document-profile.util.ts`：PRD、API、设计、测试、配置和复盘文档识别。
- `backend/src/modules/document/document.service.ts`：文档解析、切片、Embedding 和索引编排。

检索和排序代码：

- `backend/src/rag/karpathy/karpathy-rag.service.ts`：Milvus、ES、BM25 多路召回和融合。
- `backend/src/rag/karpathy/bm25-store.ts`：本地 BM25 索引。
- `backend/src/rag/karpathy/context-builder.ts`：相邻块扩展、语义去重、单文档限额、上下文预算和 Lost-in-the-Middle 排布。
- `backend/src/providers/vector-store/milvus.vector-store.ts`：向量写入、加载、搜索、超时和熔断。
- `backend/src/providers/elasticsearch/elasticsearch.provider.ts`：关键词召回。
- `backend/src/tools/dashscope-rerank.service.ts`：真实 Reranker 重排和失败降级。

测试和评测：

- `backend/src/modules/document/chunking.util.spec.ts`
- `backend/src/modules/document/document-profile.util.spec.ts`
- `backend/src/rag/karpathy/context-builder.spec.ts`
- `backend/src/rag/karpathy/karpathy-rag.service.spec.ts`
- `backend/scripts/smoke-hybrid-quality.mjs`
- `backend/scripts/eval-rag-project.mjs`

### 4. 分层结构化记忆

核心代码：

- `backend/src/modules/memory/short-term-memory.service.ts`：Redis 对话窗口、结构化摘要、最近六轮原文和模型失败保底。
- `backend/src/modules/memory/memory.service.ts`：长期记忆搜索、写入和分类。
- `backend/src/modules/memory/memory.controller.ts`：记忆状态、搜索和会话 API。
- `backend/src/providers/mem0/mem0.provider.ts`：Mem0 cloud／local 双模式。
- `backend/src/providers/langgraph-checkpointer/redis-checkpointer.ts`：Agent 工作流状态记忆和恢复。

测试：

- `backend/src/modules/memory/short-term-memory.service.spec.ts`
- `backend/src/modules/memory/memory.service.spec.ts`
- `backend/src/providers/mem0/mem0.provider.spec.ts`
- `backend/scripts/smoke-redis-checkpointer.mjs`

### 5. Agent Evals

核心代码：

- `backend/src/modules/agent-evals/agent-eval.service.ts`：任务成功率、Faithfulness、PRD 覆盖、测试完整度、工具成功率和步骤准确率。
- `backend/src/modules/agent-evals/agent-eval.dto.ts`：评测输入契约。
- `backend/src/modules/agent-evals/agent-eval.controller.ts`：评测 API。
- `backend/eval/agent-task-regression.dataset.json`：Agent 任务回归数据集。
- `backend/scripts/eval-agent-task-metrics.mjs`：任务、工具、步骤和人工接管指标门禁。

测试和命令：

- `backend/src/modules/agent-evals/agent-eval.service.spec.ts`
- 验证命令：`npm run eval:agent-tasks`

### 6. Bad Case 数据飞轮

核心代码：

- `backend/src/modules/chat/rag-feedback.service.ts`：保存用户反馈、服务端召回快照、审核状态和纠正答案。
- `backend/src/rag/prompts/bad-case-flywheel.service.ts`：审核后写入独立 Milvus collection，并召回相似纠错案例。
- `backend/src/modules/agent-ops-admin/agent-ops-admin.controller.ts`：Bad Case 审核和回灌接口。
- `admin/src/pages/agent-ops/index.tsx`：Bad Case 审核管理界面。
- `backend/scripts/smoke-bad-case-milvus.mjs`：真实 insert、flush、向量检索、标量读回和临时数据清理。

测试和命令：

- `backend/src/modules/chat/rag-feedback.service.spec.ts`
- `backend/src/rag/prompts/bad-case-flywheel.service.spec.ts`
- 验证命令：`npm run smoke:milvus:bad-case`

### 7. 节点级可观测与死循环诊断

核心代码：

- `backend/src/modules/metrics/metrics.service.ts`：LLM 调用、耗时、token、TTFT、空召回、工具调用和循环终止指标。
- `backend/src/modules/metrics/metrics.interceptor.ts`：HTTP／SSE 请求结束时统一计数。
- `backend/src/modules/tracing/tracing.service.ts`：thread 级 Trace、节点 Span 和 `span_limit` 告警。
- `backend/src/modules/tracing/tracing.interceptor.ts`：HTTP Trace 拦截。
- `backend/src/providers/observability/langfuse.provider.ts`：LangFuse trace、generation、token 和成本记录。
- `backend/src/providers/observability/observability.controller.ts`：LangFuse 状态查询和受保护的主动 smoke 接口。
- `backend/src/providers/llm/llm-gateway.policy.ts`：按任务统一模型主备、超时、输出上限和成本预算策略。
- `backend/src/modules/rag-ops-api/query-log.service.ts`：查询、反馈、活跃用户和复访用户运营指标。
- `backend/scripts/smoke-adoption-summary.mjs`：查询窗口内活跃用户、复访用户、回答率和反馈覆盖率。
- `backend/src/rag/agentic/agentic-rag.service.ts`：`observedNode` 包装每个 LangGraph 节点，发出 `node_timing` 并记录循环决策。
- `backend/src/rag/agentic/sse-event.ts`：节点耗时等 SSE 事件类型。

测试：

- `backend/src/modules/metrics/metrics.interceptor.spec.ts`
- `backend/src/modules/tracing/tracing.interceptor.spec.ts`
- `backend/src/modules/tracing/tracing.service.spec.ts`
- `backend/src/rag/agentic/agentic-rag.service.spec.ts`
- `backend/src/providers/observability/langfuse.provider.spec.ts`

验证命令：`npm run smoke:langfuse`。已配置真实云端密钥时验收 trace、generation、flush 和 health；未配置时验收明确的禁用契约。

## 十二、文档和证据总入口

| 内容           | 入口                                                     |
| -------------- | -------------------------------------------------------- |
| 工作流使用说明 | `docs/PRODUCTION_WORKFLOW_USAGE.md`                      |
| 七项面试速查卡 | `docs/interview/SEVEN_DIFFICULTIES_CHEATSHEET.md`        |
| 七项实现证据   | `docs/plans/expert-agent-difficulties-implementation.md` |
| 当前真实进度   | `ROADMAP.md`                                             |
