# 第 1 节讲义 · Agent 架构总览：从管线到受控循环

> 课程：《从零手撕企业级 AI Agent》第 1 节 · 架构总览
> 源码：[agent-loop.service.ts](../../backend/src/modules/agent-loop/agent-loop.service.ts) · [agent-loop.types.ts](../../backend/src/modules/agent-loop/agent-loop.types.ts) · [agentic-rag.service.ts](../../backend/src/rag/agentic/agentic-rag.service.ts) L151-241
> 先修：[RAG 课程第 6 节](../../course/06-agentic/README.md)（LangGraph 图与 SSE 协议）

## 一、痛点引出

一个 demo Agent 一晚上就能写出来——`while (!done) { llm.decide(); callTool(); }`。但企业级 Agent 三个月都上不了线，差在哪？**demo 把循环当语法，企业把循环当状态机**。没有终止状态机的循环有两种结局：卡死，或者烧钱烧到有人发现。本课程第一课先建立全局认知：三种执行模式、一个受控循环内核、四类决策与四种终态。

## 二、整体架构：三模式一内核

| 模式 | 循环位置 | 特征 |
|---|---|---|
| Simple | **不进循环** | 固定线性 Fast Path（RAG 课程第 5 节的链路） |
| Chat Agentic | LangGraph 图 + 生成节点内循环 | 模型草稿 → 引用校验工具 → 终止 |
| Task Agentic | 每个岗位内循环 | 岗位工具 → 结果回填 → 终止 |

Chat Agentic 与 Task Agentic 复用 `AgentLoopService`（循环内核）；Simple 不进入该循环。三者的工具执行仍需核对各自调用点的治理路径。

## 三、代码拆解

### 3.1 职责边界写在类注释里（agent-loop.service.ts L13-16）

```ts
/**
 * 受控 Agent Loop：只负责"决策 → 模型／工具动作 → 结果回填 → 再决策"。
 * 业务 DAG、工具实现和审批规则仍由现有模块负责，避免模型越权改写工作流。
 */
```

**教学引导语**：注意最后半句——"避免模型越权改写工作流"。循环内核是**泛型的**（`TState / TOutput`），它不知道业务状态长什么样，也不知道工具干什么。这个解耦让同一个内核同时服务 Chat 和 Task 两种场景。对照：很多 Agent 框架把业务流程焊进循环体，改一个场景动全身。

### 3.2 决策四类型：判别联合（agent-loop.types.ts L31-35）

```ts
export type AgentLoopDecision<TState, TOutput> =
  | AgentLoopModelAction<TState, unknown>   // 模型动作
  | AgentLoopToolAction<TState, unknown>    // 工具动作
  | { type: 'complete'; output: TOutput; reason: string }  // 完成
  | { type: 'blocked'; reason: string };                    // 阻断
```

TypeScript 的判别联合（discriminated union）是状态机的正统表达：`decision.type` 一窄化，编译器就知道剩下能访问什么字段。`complete` 必须带 `output`、`blocked` 必须带 `reason`——**结构即约束**，忘传 reason 编译不过，不是运行时才发现。

### 3.3 终止四状态（agent-loop.types.ts L3 / L52-59）

```ts
export type AgentLoopStatus = 'completed' | 'blocked' | 'failed' | 'budget_exceeded';
```

四种终态各有语义：`completed`（正常完成）、`blocked`（被权限/审批/依赖阻断——**不是错误**）、`failed`（异常）、`budget_exceeded`（预算耗尽——**保护性终止，不是故障**）。调用方拿到的是机器可读的状态 + `terminationReason`，运营面板（第 8 节）据此分类告警。**blocked 和 failed 混为一谈的系统，排障时会把"权限拒绝"当成"系统挂了"**。

### 3.4 每轮先看表（agent-loop.service.ts L50-54）

```ts
for (let step = 1; step <= maxSteps; step += 1) {
  const remainingMs = input.timeoutMs - (Date.now() - startedAt);
  if (remainingMs <= 0) {
    return this.finish(input, state, step - 1, toolCalls, 'failed', 'Agent Loop 总超时');
  }
```

循环的第一件事不是决策，是**对表**：总时限是否已耗尽。超时作为 `failed` 终止并保留当前 `state`——即使失败，已发生的工作也在结果里。

## 四、生产坑点（学员最易踩的 2 个）

### 坑点 1：`while (!done)` 没有出口分类

- **现象**：Agent 卡死（用户侧转圈）或烧钱（token 账单异常）；日志里只有无限重复的调用记录。
- **根因**：循环出口只有 done/未 done 两种，没有预算、没有终态区分——"正常完成""被拒""出错""超限"四件事挤在一个 boolean 里。
- **排查三步**：搜代码里的 `while (true)` / `while (!done)` → 检查循环体内是否有 `maxSteps` 计数与超时对表 → 检查所有分支是否都能到达某个终止语句。对照本实现：四终态 + 双预算 + 每轮对表。

### 坑点 2：业务逻辑塞进循环内核

- **现象**：想给 Task 场景加一个"岗位跳过"逻辑，改了 AgentLoopService，结果 Chat 场景的引用校验也出问题了。
- **根因**：循环内核里出现了 `if (scenario === 'task')` 之类的业务分支——内核不再纯粹。
- **排查/预防**：本内核的扩展点只有两个回调 `decide`（业务决策）与 `reduce`（状态归约，L5-10）——**新需求先问"这是决策逻辑还是循环逻辑"**，前者写进 decide，后者才动内核。

## 五、讲师口播稿（约 300 字）

> 欢迎来到 Agent 进阶课程的第一讲。开课先泼冷水：写一个 Agent 很简单，一晚上就够了——一个大模型、几个工具、一个 while 循环。但那样的东西叫 demo，不叫产品。这门课要教你的是中间差的那一层：治理。今天先看全局。这个项目里有三种执行模式：Simple 模式压根不进循环，一条直线跑到底；Chat Agentic 在生成节点里循环；Task Agentic 在每个岗位里循环。Chat 与 Task 复用同一个循环内核，Simple 不调用它，一百多行代码，但它有两个特征值钱：第一，它有四个终止状态——完成、阻断、失败、预算耗尽，每一种都有不同的处理方式，而不是一个布尔值；第二，它什么都不懂——不懂业务、不懂工具，业务逻辑全部通过两个回调注入。记住这一讲的一句话：demo 把循环当语法，产品把循环当状态机。这一课我们先把地图看全，后面七节逐个攻城。我们开始。

## 六、配套 Lab 与自测

- Lab（见[课程大纲第 1 节](../README.md)）：三模式对比实验 + while 改受控循环
- 自测：[quiz.md](./quiz.md)（9 题，≥10 分 + Lab 完成即通过）
