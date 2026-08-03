# Agent 架构设计、方案对比与选型手册

更新时间：2026-08-03

## 一、结论先行

Agent 架构没有“越自治越高级、Agent 越多越好”。推荐顺序是：

```text
普通代码／固定 Workflow
  -> 单 Agent + Tools
  -> Workflow-first Agent
  -> Manager／Handoff 等多 Agent
  -> DAG／事件驱动的复杂协作平台
```

默认选择：

1. 路径固定、规则明确：普通 Workflow。
2. 路径动态、需要观察后决策：单 Agent。
3. 主流程稳定、局部需要语义判断：Workflow-first Agent，这是企业应用最推荐的主流方案。
4. 角色具有独立知识、上下文、权限或交付物：多 Agent。
5. 高风险写操作：任何方案都必须加入人工审批和确定性校验。

本项目推荐架构：

```text
Simple RAG Fast Path
  + Agentic RAG 状态机
  + 六岗位 Workflow-first Multi-Agent DAG
  + Tool Registry／MCP／Skill
  + Evidence Gate／Human Approval／Checkpoint／Evals
```

## 二、企业 Agent 平台总架构图

```mermaid
flowchart TB
  subgraph Channels["交互与业务入口"]
    Web["用户端 Web／Chat"]
    Admin["管理后台"]
    IDE["Codex／IDE Agent"]
    API["API／CLI／自动任务"]
    Voice["语音／多模态入口"]
  end

  subgraph Gateway["接入与治理层"]
    Auth["认证／租户／权限"]
    Session["会话／Thread／幂等"]
    Rate["限流／预算／审计"]
  end

  subgraph Orchestration["Agent 编排层"]
    Router["复杂度与意图 Router"]
    Simple["Simple RAG Workflow"]
    Single["Single Agent／ReAct"]
    Graph["LangGraph Workflow-first"]
    Multi["Multi-Agent DAG／Supervisor／Handoff"]
    Human["Human-in-the-loop"]
    Checkpoint["Checkpoint／恢复／局部重跑"]
  end

  subgraph Capability["能力层"]
    Skills["Skills／SOP"]
    Registry["Tool Registry"]
    MCP["MCP Client／Servers"]
    Business["业务 API／Artifacts／Jobs"]
  end

  subgraph Knowledge["知识与记忆层"]
    Ingest["解析／结构切片／版本治理"]
    Hybrid["BM25／ES／Vector／Graph"]
    Rerank["Reranker／Context Builder"]
    Memory["短期／长期／程序性记忆"]
    Evidence["Claim／Citation／Refusal"]
  end

  subgraph Runtime["模型与运行时"]
    Models["LLM／Embedding／Rerank／Vision／Speech"]
    Sandbox["Sandbox／Browser／Code Runtime"]
    Queue["Redis／Queue／Async Worker"]
  end

  subgraph Quality["质量与运营"]
    Trace["Trace／Metrics／Logs"]
    Eval["Offline Evals／LLM Judge"]
    BadCase["Bad Case Flywheel"]
    Cost["Latency／Token／Cost／SLA"]
  end

  Channels --> Gateway --> Router
  Router --> Simple
  Router --> Single
  Router --> Graph
  Graph --> Multi
  Single --> Skills
  Multi --> Skills
  Skills --> Registry --> MCP
  Registry --> Business
  Simple --> Hybrid
  Single --> Hybrid
  Multi --> Hybrid
  Ingest --> Hybrid --> Rerank --> Evidence
  Memory --> Orchestration
  MCP --> Runtime
  Business --> Runtime
  Orchestration --> Human
  Orchestration --> Checkpoint
  Orchestration --> Quality
  Evidence --> Quality
```

这张图面试时按四句话讲：

1. 入口统一经过身份、租户、预算和审计。
2. Router 根据复杂度选择 Simple、单 Agent、LangGraph 或多 Agent。
3. Agent 不直接碰业务系统，通过 Skill、Tool Registry 和 MCP 受控调用。
4. 知识证据、Checkpoint、人工审批和 Evals 是可靠性底座，不是后补功能。

## 三、核心选型决策树

```mermaid
flowchart TD
  Start["收到业务任务"] --> Fixed{"步骤是否固定且规则明确？"}
  Fixed -- 是 --> Deterministic["普通代码／Workflow"]
  Fixed -- 否 --> Dynamic{"是否需要根据执行结果动态决策？"}
  Dynamic -- 否 --> Chain["Chain／Router／结构化输出"]
  Dynamic -- 是 --> One{"单个 Agent 能否在可控上下文内完成？"}
  One -- 是 --> Single["单 Agent + Tools／Skills"]
  One -- 否 --> Why{"为什么需要拆分？"}
  Why -- "固定依赖／可并行" --> DAG["多 Agent DAG"]
  Why -- "一个入口统一汇总" --> Manager["Manager／Agents as Tools"]
  Why -- "专家直接接管会话" --> Handoff["Handoff／Swarm"]
  Why -- "开放研究和专家动态选择" --> Supervisor["Supervisor／Hierarchical"]
  Why -- "异步长任务／跨服务" --> Event["Event-driven／Blackboard"]

  Deterministic --> Risk{"是否有高风险写操作？"}
  Chain --> Risk
  Single --> Risk
  DAG --> Risk
  Manager --> Risk
  Handoff --> Risk
  Supervisor --> Risk
  Event --> Risk
  Risk -- 是 --> Human["审批／幂等／审计／补偿"]
  Risk -- 否 --> Eval["评测／观测／灰度"]
  Human --> Eval
```

## 四、方案一：确定性 Workflow／Chain

### 架构图

```mermaid
flowchart LR
  Input["输入"] --> Validate["规则校验"] --> Retrieve["检索／API"] --> Generate["LLM 结构化生成"] --> Verify["确定性验证"] --> Output["输出"]
```

### 特点

流程由代码决定，LLM 只在某些节点完成分类、抽取或生成，不自主选择整个执行路径。

### 优点

- 可预测、易测试、延迟和成本稳定。
- 容易做权限、审计、回滚和 SLA。
- 错误定位清晰，适合高风险流程。

### 缺点

- 对开放任务和异常分支适应性弱。
- 流程变化时需要修改代码和图。
- 复杂分支过多会形成状态机维护成本。

### 适用场景

- 文档入库、审批、发布、支付、工单状态流转。
- Simple RAG、固定报表、结构化信息抽取。
- 测试门禁、数据校验、批处理任务。

### 伪代码

```ts
const input = InputSchema.parse(request);
const route = classifyByRules(input);
const evidence = await retriever.search(input.query, route.filters);
const output = await model
  .withStructuredOutput(ResultSchema)
  .invoke({ input, evidence });
assertBusinessRules(output);
return output;
```

### 面试结论

> 确定性问题不需要 Agent。能用规则和 Workflow 稳定解决时，让模型自由规划只会增加失败面。

## 五、方案二：Router／单次 Tool Calling Agent

### 架构图

```mermaid
flowchart LR
  User["用户请求"] --> Router["规则／模型 Router"]
  Router --> RAG["RAG Tool"]
  Router --> Order["业务 API Tool"]
  Router --> Human["人工渠道"]
  RAG --> Answer["统一回答"]
  Order --> Answer
```

### 特点

模型或规则只负责从有限能力中选择一条路径，通常没有长循环。

### 优点

- 比完整 Agent 简单、快、便宜。
- Tool 选择和参数容易评测。
- 适合现有业务 API 的自然语言入口。

### 缺点

- 难以处理多步骤依赖和动态恢复。
- Router 分类错误会直接走错链路。
- 工具数量过多时 Schema 会占用大量上下文。

### 适用场景

- FAQ／知识库／订单／工单入口路由。
- 简单客服、办公助手、查询型 Copilot。
- Simple／Auto／Agentic 模式选择。

### 伪代码

```ts
const route = await router.invoke({ goal, routes: routeCards });
const handler = routeRegistry.get(route.name);
return handler.execute(route.arguments, context);
```

## 六、方案三：单 Agent ReAct

### 架构图

```mermaid
flowchart TD
  Goal["Goal"] --> Think["Reason／Decide"] --> Action["Tool Action"] --> Observe["Observation"]
  Observe --> Stop{"达到停止条件？"}
  Stop -- 否 --> Think
  Stop -- 是 --> Final["Final Result"]
```

### 特点

Agent 根据每次 Tool Observation 动态决定下一步，适合路径未知的开放任务。

### 优点

- 灵活，能根据实时结果改变计划。
- 工具组合不需要预先枚举所有路径。
- 单 Agent 上下文和责任边界相对简单。

### 缺点

- 容易循环、重复调用和超预算。
- 轨迹、时延和结果稳定性低于 Workflow。
- 高风险写操作难以只靠 Prompt 控制。

### 适用场景

- 开放检索、故障诊断、轻量 Coding Agent。
- 需要边观察边探索，但单个上下文仍可承载的任务。
- 低风险、可回滚的工具操作。

### 伪代码

```ts
for (let step = 0; step < MAX_STEPS; step++) {
  const decision = await agent.decide(state);
  if (decision.type === "finish") return verify(decision.output);
  const result = await secureToolRuntime.execute(decision.tool, decision.args);
  state = reduce(state, decision, result);
  if (noProgress(state) || overBudget(state)) return handoffToHuman(state);
}
```

### 关键治理

- 最大步骤、时间、Token、费用和同 Tool 重复次数。
- 无新增证据／状态无变化时停止。
- Tool 白名单、参数 Schema、权限和幂等。
- Checkpoint、人工接管和真实业务结果断言。

## 七、方案四：Plan-and-Execute

### 架构图

```mermaid
flowchart TD
  Goal["Goal"] --> Planner["Planner 生成结构化计划"] --> Validate["代码／人工校验计划"]
  Validate --> Executor["Executor 执行步骤"] --> Result["Observation"] --> Replan{"计划仍有效？"}
  Replan -- 是 --> Executor
  Replan -- 否 --> Planner
  Executor --> Verify["Evaluator"] --> Final["结果"]
```

### 优点

- 长任务先显式规划，便于展示、审批和跟踪。
- Planner 与 Executor 可使用不同模型和权限。
- 可对计划做依赖、预算和危险动作检查。

### 缺点

- 初始计划可能因新信息快速过时。
- 规划本身增加一次模型调用和延迟。
- 重规划过多会退化成昂贵循环。

### 适用场景

- Deep Research、复杂数据分析、长 Coding 任务。
- 需要用户先确认计划的高价值任务。
- 任务可拆成结构化子任务但路径不是完全固定。

### 伪代码

```ts
let plan = await planner.createPlan(goal, constraints);
validatePlan(plan);

for (const step of topologicalOrder(plan)) {
  const result = await executor.run(step, state);
  state = update(state, result);
  if (materialAssumptionChanged(state)) {
    plan = await planner.replan(goal, state, remaining(plan));
  }
}

return evaluator.grade(state);
```

## 八、方案五：Workflow-first Agent／LangGraph

### 架构图

```mermaid
flowchart TD
  Start --> Route["复杂度路由"]
  Route --> Retrieve["混合检索"]
  Retrieve --> Sufficiency{"证据充分？"}
  Sufficiency -- 是 --> Generate["生成"]
  Sufficiency -- 否 --> ToolAgent["受限 Tool Agent"]
  ToolAgent --> Generate
  Generate --> Citation["Claim／Citation Gate"]
  Citation -- 通过 --> End
  Citation -- 可修复 --> Retrieve
  Citation -- 高风险 --> Human["人工审批"] --> End
```

### 特点

控制流由显式图掌握，只在语义判断、工具选择等少量节点使用 Agent 能力。

### 优点

- 兼顾确定性和灵活性。
- State、条件边、Checkpoint、暂停恢复清晰。
- 适合审计、可观测、局部重跑和生产治理。

### 缺点

- 需要设计 State Schema 和图结构。
- 流程变化会增加图维护成本。
- 图设计过细会造成节点和状态膨胀。

### 适用场景

- 企业 RAG、业务 Copilot、产研协作、审批和发布。
- 多步骤但主流程相对稳定的生产应用。
- 对稳定性、证据、恢复和审计要求较高的场景。

### 推荐原因

这是当前企业 Agent 应用最常用、最务实的主流架构：代码负责可控性，LLM 负责不确定性。OpenAI 官方也区分 LLM 编排与代码编排，并指出代码编排在速度、成本和性能上更确定。

## 九、方案六：Manager／Agents as Tools

### 架构图

```mermaid
flowchart TD
  User --> Manager["Manager Agent／统一用户入口"]
  Manager --> Research["Research Agent as Tool"]
  Manager --> Data["Data Agent as Tool"]
  Manager --> Writer["Writer Agent as Tool"]
  Research --> Manager
  Data --> Manager
  Writer --> Manager
  Manager --> Final["统一汇总与回答"]
```

### 特点

Manager 保持对用户对话和最终答案的控制，专业 Agent 作为有边界的 Tool 完成子任务。

### 优点

- 用户只面对一个统一 Agent。
- Manager 可统一 Guardrail、风格、证据和汇总。
- 子 Agent 输入输出范围明确，易替换和评测。

### 缺点

- Manager 成为上下文、延迟和质量瓶颈。
- 所有结果回流 Manager，Token 成本可能较高。
- Manager 选错专家会影响全链路。

### 适用场景

- Deep Research、报告生成、企业统一助手。
- 一个入口需要调用多个专业分析能力。
- 专家只完成子任务，不应直接接管用户会话。

### 伪代码

```ts
const manager = createAgent({
  instructions: "统一理解目标、调用专家并汇总最终结果",
  tools: [
    researchAgent.asTool("research_expert"),
    dataAgent.asTool("data_expert"),
    writerAgent.asTool("writing_expert"),
  ],
});

return runner.run(manager, userGoal);
```

## 十、方案七：Handoff／Swarm

### 架构图

```mermaid
flowchart LR
  User --> Triage["Triage Agent"]
  Triage -- "订单" --> Order["Order Agent"]
  Triage -- "退款" --> Refund["Refund Agent"]
  Triage -- "技术" --> Tech["Tech Agent"]
  Refund -- "需要人工" --> Human["Human Agent"]
```

### 特点

当前 Agent 将控制权和必要上下文移交给另一个专家，专家直接成为用户当前对话方。

### 优点

- 专家 Prompt 和上下文聚焦。
- 专家可以直接与用户澄清，不需要 Manager 转述。
- 适合领域路由和长会话归属变化。

### 缺点

- 容易来回 Handoff 或失去统一口径。
- 上下文过滤不好会丢信息或泄露多余信息。
- 全局 Guardrail、状态和用户体验更难统一。

### 适用场景

- 客服分流、医疗／法律专业分诊、企业服务台。
- 不同阶段由不同专家真正接管的长会话。
- 专家需要直接向用户追问的场景。

### 伪代码

```ts
const next = await triage.selectSpecialist(userMessage, specialistCards);
const handoffPayload = HandoffSchema.parse({
  goal,
  userSummary: summarizeConversation(messages),
  verifiedFacts,
  unresolvedQuestions,
});

return specialistRegistry.get(next).resume(handoffPayload);
```

### 关键治理

- 最大 Handoff 次数和禁止原路往返。
- Handoff Payload 使用 Schema，不直接倾倒全部历史。
- 明确当前 Owner、退出条件和人工接管。
- 每个 Agent 继续执行统一权限和安全策略。

## 十一、方案八：多 Agent DAG／Pipeline

### 架构图

```mermaid
flowchart LR
  Product["产品 Agent"] --> Design["设计 Agent"]
  Product --> Backend["后端 Agent"]
  Product --> Frontend["前端 Agent"]
  Design --> Frontend
  Backend --> Frontend
  Backend --> QA["测试 Agent"]
  Frontend --> QA
  QA --> Ops["运营 Agent"]
```

### 特点

角色和依赖由代码图明确表达；无依赖节点并行，有依赖节点等待；角色之间传版本化 Artifact。

### 优点

- 分工、依赖、并行和审批清晰。
- 适合 Checkpoint、失败恢复和局部重跑。
- 每个角色可独立配置 Tool、上下文和评测标准。

### 缺点

- 图和 Agent Contract 需要持续维护。
- 上游错误可能向下游传播。
- 角色过度拆分会产生协调成本和重复内容。

### 适用场景

- 产研协作、软件开发、内容生产审核、复杂报告流水线。
- 业务流程相对稳定，但各岗位需要专业模型能力。
- 有明确交付物、依赖和质量门禁的任务。

### 伪代码

```ts
for (const batch of topologicalBatches(agentDag)) {
  const ready = batch.filter((role) => dependenciesPassed(role, state));
  const results = await mapWithConcurrency(ready, MAX_PARALLEL, (role) =>
    runAgentWithContract(roleContracts[role], buildRoleInput(role, state)),
  );

  state = mergeVersionedArtifacts(state, results);
  state = await qualityGate.evaluate(state);
  await checkpointer.save(state);

  if (state.hasBlockingFailure) return handoffOrFail(state);
  if (state.requiresApproval) state = await waitForApproval(state);
}
```

## 十二、方案九：Supervisor／Hierarchical Multi-Agent

### 架构图

```mermaid
flowchart TD
  User --> Top["Top Supervisor"]
  Top --> ResearchLead["Research Supervisor"]
  Top --> DeliveryLead["Delivery Supervisor"]
  ResearchLead --> Search["Search Agent"]
  ResearchLead --> Analyst["Analyst Agent"]
  DeliveryLead --> Writer["Writer Agent"]
  DeliveryLead --> Reviewer["Reviewer Agent"]
  ResearchLead --> Top
  DeliveryLead --> Top
```

### 优点

- 能动态选择专家，适合开放且复杂的任务。
- 可按领域形成多层团队。
- 专家 Prompt、Tool 和上下文隔离。

### 缺点

- Supervisor 决策本身不稳定且增加调用。
- 层级越深，延迟、Token 和故障归因越难控制。
- 容易形成中心瓶颈或重复委派。

### 适用场景

- 大型 Deep Research、复杂咨询、跨领域分析。
- 专家集合较大，执行路径无法预先固定。
- 需要动态组队而不是固定岗位 DAG。

### 选择建议

固定流程不要用 Supervisor 替代代码路由。候选专家先按规则、权限和领域缩小，再让模型选择，减少错误和上下文成本。

## 十三、方案十：Group Chat／Debate／Critic

### 架构图

```mermaid
flowchart LR
  Proposal["Generator"] --> Board["共享消息／方案"]
  Critic["Critic"] --> Board
  ExpertA["Expert A"] --> Board
  ExpertB["Expert B"] --> Board
  Board --> Judge["规则／Judge／人工裁决"] --> Final["最终方案"]
```

### 优点

- 可从不同专业角度发现遗漏和冲突。
- Generator＋Critic 对开放产物有一定质量收益。
- 适合需要方案比较和论证的高价值任务。

### 缺点

- 多个 Agent 可能共享同一模型偏差，只是重复表达。
- 全量群聊上下文膨胀快，成本和延迟高。
- 没有明确终止和裁决标准时容易空转。

### 适用场景

- 架构评审、风险评审、创意方案、复杂研究结论校验。
- 一次决策价值明显高于多次模型调用成本。

### 不适用

- 简单事实问答、固定审批、追求低延迟的在线请求。
- 没有可执行 Rubric，只让多个 Agent “互相讨论”。

## 十四、方案十一：Event-driven／Blackboard

### 架构图

```mermaid
flowchart TB
  Bus["Event Bus／Task Queue"]
  Board["Shared Blackboard／Artifact Store"]
  Planner["Planner Agent"] --> Bus
  WorkerA["Worker A"] <--> Bus
  WorkerB["Worker B"] <--> Bus
  Reviewer["Reviewer"] <--> Bus
  Bus --> Board
  Board --> Planner
  Board --> WorkerA
  Board --> WorkerB
  Board --> Reviewer
```

### 优点

- 支持异步长任务、弹性扩缩容和跨服务协作。
- Worker 可独立部署、失败重试和水平扩展。
- Artifact／Event 天然适合审计和恢复。

### 缺点

- 分布式一致性、重复消费和事件顺序复杂。
- 调试比单进程图困难。
- 最终一致性不适合强实时同步交互。

### 适用场景

- 大规模文档处理、批量评测、异步研究、跨系统任务。
- 一个任务可能持续数分钟到数小时。
- 不同 Agent／Worker 需要独立扩缩容。

### 关键治理

- At-least-once 消费下所有写操作必须幂等。
- Event 带 taskId、causationId、correlationId 和 schemaVersion。
- 使用 Outbox／Inbox、死信队列、补偿和超时扫描。
- Blackboard 只保存结构化事实和 Artifact，不保存无限聊天文本。

## 十五、主流业务场景推荐

| 业务场景         | 首选架构                              | 可选增强                     | 不推荐默认使用           |
| ---------------- | ------------------------------------- | ---------------------------- | ------------------------ |
| 企业知识库问答   | Simple RAG＋Workflow-first Agent      | GraphRAG、Web Search、HITL   | 自由多 Agent 群聊        |
| 客服助手         | Router＋单 Agent＋Handoff             | Manager、人工客服            | 所有专家共享全量上下文   |
| Coding Agent     | Plan-and-Execute＋Tools＋Sandbox      | Coder／Reviewer／Tester DAG  | 无沙箱的自由 Shell Agent |
| Deep Research    | Manager＋专家 Agents as Tools         | Supervisor、Critic、并行搜索 | 固定单次 Chain           |
| 数据分析 Agent   | Planner＋SQL／Metric Tools＋Evaluator | 多专家 DAG                   | 直接暴露任意 SQL         |
| 内容生产         | Research→Writer→Critic Pipeline       | 并行创意、人工终审           | 无限 Debate              |
| 产研协作平台     | Workflow-first 多 Agent DAG           | 风险审批、局部重跑           | Handoff 群聊替代项目流程 |
| 审批／发布／支付 | 确定性 Workflow＋HITL                 | LLM 做分类和摘要             | 自治 ReAct 写操作        |
| 运维故障处理     | Router＋Runbook Workflow＋受限 Agent  | 专家 Handoff、Blackboard     | 无预算自动修复生产       |
| 实时语音 Agent   | 单 Agent＋低延迟 Tools                | 专家 Handoff                 | 多层 Supervisor          |
| 批量文档／评测   | Event-driven Workers                  | Agent 做异常分类             | 同步长连接处理全部任务   |

### 当前最主流的三种组合

1. **Workflow-first＋局部 Agent**：企业应用默认答案，兼顾确定性和灵活性。
2. **单 Agent＋Tools／MCP／Skills**：中等复杂度 Copilot、客服和 Coding 场景常用。
3. **Manager 或 DAG 多 Agent**：只在专业角色和协作收益明确时使用。

## 十六、方案横向对比

评分：1 表示较弱／较低，5 表示较强／较高。成本和复杂度分数越高，代价越大。

| 方案                     | 灵活性 | 可预测性 | 低延迟 | 易评测 | 恢复能力 | 成本 | 工程复杂度 |
| ------------------------ | -----: | -------: | -----: | -----: | -------: | ---: | ---------: |
| Workflow／Chain          |      1 |        5 |      5 |      5 |        4 |    1 |          2 |
| Router／单次 Tool        |      2 |        4 |      4 |      4 |        3 |    2 |          2 |
| Single ReAct             |      4 |        2 |      3 |      2 |        2 |    3 |          3 |
| Plan-and-Execute         |      4 |        3 |      2 |      3 |        3 |    4 |          3 |
| Workflow-first Agent     |      4 |        5 |      3 |      5 |        5 |    3 |          4 |
| Manager／Agents as Tools |      4 |        3 |      2 |      3 |        3 |    4 |          4 |
| Handoff／Swarm           |      4 |        2 |      3 |      2 |        3 |    4 |          4 |
| Multi-Agent DAG          |      4 |        5 |      3 |      5 |        5 |    4 |          5 |
| Supervisor／Hierarchy    |      5 |        2 |      1 |      2 |        3 |    5 |          5 |
| Group Chat／Debate       |      5 |        1 |      1 |      2 |        2 |    5 |          4 |
| Event-driven／Blackboard |      4 |        4 |      1 |      4 |        5 |    4 |          5 |

## 十七、如何做正确选型

### 17.1 先问七个问题

1. 业务成功状态能否被代码验证？
2. 路径是否固定，还是必须根据 Observation 动态变化？
3. Tool 是否有副作用，错误能否回滚？
4. 单 Agent 的上下文、权限和能力是否已经足够？
5. 多角色是否有独立交付物和评测标准？
6. 时延、成本、稳定性和人工等待上限是多少？
7. 失败后要重试、降级、恢复、补偿还是转人工？

### 17.2 选型伪代码

```ts
function selectArchitecture(task: TaskProfile): Architecture {
  if (task.fixedSteps && task.rulesAreDeterministic) {
    return task.highRiskWrite ? "workflow-with-human-approval" : "workflow";
  }

  if (!task.needsIterativeObservation) {
    return "router-or-structured-chain";
  }

  if (task.fitsSingleContext && !task.requiresRoleIsolation) {
    return task.mainFlowStable
      ? "workflow-first-single-agent"
      : "single-react-agent";
  }

  if (task.dependenciesKnown) return "multi-agent-dag";
  if (task.singleUserFacingOwner) return "manager-agents-as-tools";
  if (task.specialistShouldTakeOver) return "handoff";
  if (task.openEndedExpertSelection) return "supervisor";
  if (task.longRunningAndDistributed) return "event-driven-blackboard";

  return "single-agent-baseline";
}
```

### 17.3 决策必须有数据

同一真实评测集比较：

- Task success、evidence coverage、citation accuracy。
- Tool／handoff／dependency accuracy。
- P50／P95、Token、cost per successful task。
- Loop、fallback、human handoff、rework rate。
- 多 Agent coordination overhead 和 parallel efficiency。

多 Agent 只有在成功率、质量、上下文隔离或并行收益明显超过单 Agent Baseline 时才保留。

## 十八、本项目为什么这样选

### 项目架构图

```mermaid
flowchart TD
  User["游戏产研用户"] --> Router["Simple／Auto／Agentic Router"]
  Router -- "明确事实" --> Simple["Simple Hybrid RAG"]
  Router -- "复杂检索" --> Agentic["Agentic RAG LangGraph"]
  Router -- "产研任务" --> Workflow["六岗位 Multi-Agent DAG"]

  Simple --> Retrieval["BM25＋ES＋Milvus＋Graph"]
  Agentic --> Retrieval
  Workflow --> Product["产品"]
  Product --> Design["设计"]
  Product --> Backend["后端"]
  Design --> Frontend["前端"]
  Backend --> Frontend
  Frontend --> QA["测试"]
  Backend --> QA
  QA --> Ops["运营"]

  Agentic --> Registry["Tool Registry"]
  Workflow --> Registry
  Registry --> MCP["MCP／Business APIs／Artifacts"]
  Retrieval --> Gate["Evidence／Citation／Refusal Gate"]
  Ops --> Gate
  Gate --> Approval{"高风险？"}
  Approval -- 是 --> Human["人工审批"]
  Approval -- 否 --> Output["产物／回答／分享"]
  Human --> Output
  Workflow <--> Checkpoint["Redis Checkpoint／局部重跑"]
```

### 方案对比

| 候选方案                 | 为什么没有作为主方案                     |
| ------------------------ | ---------------------------------------- |
| 所有问题都走 ReAct       | 简单问题延迟、成本和失败概率没有必要增加 |
| 六岗位自由 Group Chat    | 依赖、责任、版本、终止和审批不可控       |
| 全部 Supervisor 动态路由 | 六岗位顺序本来就较稳定，模型路由收益不足 |
| 单 Agent 承担六岗位      | 上下文混杂、交付标准和 Tool 权限难隔离   |
| 纯固定 Workflow          | 对复杂检索、证据不足和工具异常适应性不够 |

### 最终选择

- 普通问答走 Simple Fast Path。
- 复杂问题进入 Agentic RAG 状态机。
- 六岗位使用显式 DAG，设计和后端并行。
- 每个角色有独立 Tool 白名单、结构化产物和证据门禁。
- 重要任务按风险审批，不强制逐步审批。
- Redis Checkpoint 支持跨进程恢复和局部重跑。
- Qwen 模型成功、工作流完成和降级分别统计。

### 效果怎么讲

> 这套选择的核心不是追求自治，而是把确定性和模型能力放在合适位置。六岗位完整真实回放修复超时后连续三次共 18／18 模型调用成功、0 降级；设计和后端保持并行。业务证据覆盖、审批就绪和真实用户价值仍作为独立指标，不用工作流成功冒充业务质量。

## 十九、常见架构错误

1. 没有 Baseline 就直接做多 Agent。
2. 把不同 System Prompt 当成真实角色边界。
3. 用群聊代替 Workflow、状态机和项目管理。
4. 把全量消息广播给所有 Agent，造成上下文污染。
5. 只看最终答案，不评 Tool、轨迹、依赖和业务状态。
6. 没有停止条件、预算、Checkpoint 和人工接管。
7. 高风险写操作只靠 Prompt 限制。
8. Supervisor 和 Worker 使用相同上下文、模型、Tool，却没有专业化收益。
9. MCP、Skill、Agent、Workflow 概念混在一起。
10. 用 HTTP 200 或“最终生成了文字”作为任务成功。

## 二十、面试回答模板

### 30 秒版本

> Agent 架构我不会直接上多 Agent，而是按任务确定性选型。固定流程用 Workflow，动态工具决策用单 Agent，主流程稳定但局部需要模型判断时用 Workflow-first；只有角色存在独立知识、上下文、权限、交付物或并行收益时才拆多 Agent。生产上无论哪种方案都要有显式 State、预算、停止条件、Checkpoint、权限、人工审批和 Evals。

### 两分钟版本

> 我先把业务拆成确定性和不确定性两部分。确定性的状态流转、审批和写操作交给代码；语义理解、复杂检索、规划和工具选择交给模型。单 Agent 已经能完成时不会拆团队，因为多 Agent 会增加协调 Token、延迟和故障面。
>
> 常见多 Agent 方案里，Manager 适合一个入口统一汇总多个专家；Handoff 适合客服分诊后专家直接接管；DAG 适合依赖已知的产研协作；Supervisor 适合开放任务动态选专家；事件驱动适合异步长任务。本项目六岗位依赖明确，所以选 LangGraph 风格的 Workflow-first DAG，而不是自由群聊。角色通过版本化 Artifact 和 Agent Contract 协作，关键失败阻塞下游，Checkpoint 支持恢复和局部重跑，高风险动作才审批。最后用真实任务成功、证据覆盖、P95、成本和协调开销与单 Agent Baseline 比较。

### 追问“哪个最主流”

> 企业落地最主流、最稳妥的是 Workflow-first＋局部 Agent；中等复杂度应用常用单 Agent＋Tools／MCP／Skills；Manager、Handoff 和多 Agent DAG 用在专业角色和协作收益明确的场景。不是所有业务都应该做成 Supervisor 或 Swarm。

## 二十一、本项目代码对应

| 架构能力                     | 项目入口                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| Simple／Auto／Agentic Router | `backend/src/modules/chat/chat.service.ts`                                                         |
| Agentic RAG StateGraph       | `backend/src/rag/agentic/agentic-rag.service.ts`                                                   |
| Supervisor                   | `backend/src/modules/supervisor/supervisor.service.ts`                                             |
| 专家 Agent Pipeline          | `backend/src/rag/agents/agent-pipeline.service.ts`                                                 |
| Agent Contract               | `backend/src/rag/agents/agent.interface.ts`                                                        |
| 六岗位 DAG Plan              | `backend/src/modules/workflow/production-workflow.plan.ts`                                         |
| 六岗位 State                 | `backend/src/modules/workflow/production-workflow.state.ts`                                        |
| 六岗位执行与恢复             | `backend/src/modules/workflow/production-workflow.service.ts`                                      |
| 六岗位 Tool 白名单           | `backend/src/modules/workflow/production-workflow.tools.ts`                                        |
| Tool Registry                | `backend/src/tools/tool-registry.ts`                                                               |
| MCP Server                   | `tools/rag-mcp-server/src/server.ts`                                                               |
| Agent Evals                  | `backend/src/modules/agent-evals/agent-eval.service.ts`                                            |
| Metrics／Trace               | `backend/src/modules/metrics/metrics.service.ts`、`backend/src/modules/tracing/tracing.service.ts` |

## 二十二、官方资料

主流架构判断参考以下官方资料：

- [OpenAI Agents SDK：Agent orchestration](https://openai.github.io/openai-agents-python/multi_agent/)
- [OpenAI Agents SDK：Agents](https://openai.github.io/openai-agents-python/agents/)
- [OpenAI Agents SDK：Handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- [LangGraph.js Multi-Agent Supervisor](https://langchain-ai.github.io/langgraphjs/reference/modules/langgraph-supervisor.html)
- [Microsoft AutoGen Teams](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/teams.html)

官方资料共同体现的工程原则：LLM 编排和代码编排可以混合；Manager 与 Handoff 解决不同控制权问题；简单任务先优化单 Agent，只有协作和专业化收益明确时再使用多 Agent。
