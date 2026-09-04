# 第 6 节讲义 · 多岗位协作：SOP 与生产工作流

> 课程：《从零手撕企业级 AI Agent》第 6 节 · 循环与协作
> 源码：[agent-collaboration.service.ts](../../backend/src/modules/agent-collaboration/agent-collaboration.service.ts) · [production-workflow.plan.ts](../../backend/src/modules/workflow/production-workflow.plan.ts) · [production-workflow.state.ts](../../backend/src/modules/workflow/production-workflow.state.ts) · [production-workflow.tools.ts](../../backend/src/modules/workflow/production-workflow.tools.ts) · [agentic-workflow.mermaid.ts](../../backend/src/modules/workflow/agentic-workflow.mermaid.ts)
> 先修：第 4 节（每个岗位内部就是一个受控循环）

## 一、痛点引出

multi-agent 的流行叙事是"几个 Agent 自由对话、自主协作"——听起来美好，工程上是灾难：谁先说话？谁听谁的？中间某个 Agent 编了个数，下游基于它产出了一堆交付物，追责时**没有一条清晰的因果链**。企业要的不是群聊，是流水线：每个岗位有明确输入、明确产出、明确工具清单——这就是 SOP（标准作业程序）驱动的协作。

## 二、整体架构：SOP → 岗位 → artifact 依赖链

```
SOP 定义（岗位 × 输入 × 工具 × 产出契约）
  └─ 岗位 N（内部是第 4 节的受控循环）
       ├─ 消费上游岗位的 artifact
       ├─ 只能用 SOP 授权的工具（过第 2 节治理壳）
       └─ 产出自己的 artifact + 决策记录
            └─ 下游岗位依赖此 artifact 才开工
```

## 三、代码拆解

### 3.1 DEFAULT_SOPS：岗位契约的样子（agent-collaboration.service.ts）

```ts
const DEFAULT_SOPS = [
  ['product', '产品需求 SOP',
    ['brief', '目标、范围、用户故事'],        // 输入
    ['rag.search', '需求拆解'],              // 工具（注册表授权）
    ['requirement_brief', 'acceptance_checklist'],  // 产出 artifact
    []],
  // ...后续岗位
];
```

**教学引导语**：一行 SOP 说清一个岗位的四件事：**叫什么、吃什么、用什么工具、产出什么**。product 岗位消费 `brief`、只许用 `rag.search`、必须产出 `requirement_brief` 和 `acceptance_checklist`。产出的名字就是下游的输入名——**artifact 名是岗位间的接口契约**，对不上就是编译错误级别的失败（下游饿死），而不是运行时的暧昧。

### 3.2 六类实体：协作的全量证据链

AgentSop（SOP 定义）/ CollaborationMessage（岗位间消息）/ **ArtifactDependency**（产出依赖关系）/ **DecisionRecord**（决策记录）/ AgentRun（运行实例）/ AgentAction（动作明细）。

重点看两个：`ArtifactDependency` 落库意味着**"下游用了上游的哪个产出"是可查询的**——上游产出有错，一条 SQL 找出所有被污染的下游；`DecisionRecord` 记录"这个岗位为什么这么决定"——多 Agent 最大的黑盒不是工具调用，是**中间决策**。这六类实体就是"可控可审计"的数据底座（呼应第 8 节运营）。

### 3.3 workflow 四件套：计划与执行分离（modules/workflow/）

- `production-workflow.plan.ts`——**计划**：把任务拆成岗位序列（静态结构）
- `production-workflow.state.ts`——**状态**：执行到哪、每个岗位的产出
- `production-workflow.tools.ts`——**工具**：各岗位可用工具的接线（接第 2 节 Tool Registry）
- `production-workflow.service.ts`——**编排**：按 plan 逐岗位执行（每岗位内是 AgentLoopService 受控循环）

**教学引导语**：plan 与 service 分离意味着**流程结构是数据不是代码**——调整岗位顺序/增删岗位改 plan，不动执行引擎。对照第 1 节"业务 DAG 外置"：循环内核不管流程，plan 文件管流程，两层各改各的。

### 3.4 mermaid 可视化：流程即文档（agentic-workflow.mermaid.ts）

工作流能输出 Mermaid 流程图（配套 spec 测试保证图与实际流程一致——**文档不会撒谎，因为它就是从同一份代码生成的**）。排障时先看图定位卡在哪个岗位，再看该岗位的 run-center 轨迹——可视化不是装饰，是排障动线。

### 3.5 诚实对照：SOP 流水线 vs 自由 swarm

| | SOP 流水线（本实现） | 自由 multi-agent 群聊 |
|---|---|---|
| 可预测性 | 高（岗位顺序固定） | 低（对话路径发散） |
| 可审计 | 强（六类实体全链路） | 弱（对话历史≠因果链） |
| 灵活性 | 低（改流程要改 SOP） | 高（自主分工） |
| token 成本 | 可预算（岗位数×预算） | 不可预算（对话轮数失控） |

企业场景先选前者：**先把可控做对，灵活性留给单岗位内部的受控循环**（第 4 节的 decide 仍然自由）。

## 四、生产坑点（学员最易踩的 2 个）

### 坑点 1：artifact 契约对不上 → 下游静默饿死

- **现象**：工作流跑到某岗位后"卡住"或产出为空，上游明明执行成功了。
- **根因**：上游产出的 artifact 名与下游声明的输入名不一致（`requirement_brief` vs `requirement-brief`）——契约靠字符串匹配，没有编译器帮你查。
- **排查三步**：查 ArtifactDependency 表该岗位的入边是否为空 → 对比 SOP 里上下游的 artifact 名拼写 → 把 artifact 名提取为常量/枚举，消除魔法字符串。

### 坑点 2：中间岗位 blocked 的传播策略缺失

- **现象**：研发岗位被权限拒绝（blocked）后，测试岗位还在傻等它的 artifact，整个工作流挂起直到超时。
- **根因**：只设计了 happy path——没有定义"上游失败时下游怎么办"（等待/降级/终止）。
- **排查/预防**：每个岗位的 SOP 必须声明失败语义；编排层拿到 blocked 终态后按策略处理（本课程 Lab 3 会让你实测当前实现的策略——先读代码再下结论）。**流水线的健壮性 = 每一环的失败处理**。

## 五、讲师口播稿（约 300 字）

> 讲多岗位协作之前，先泼一盆冷水。市面上最流行的 demo 是什么？三个 Agent 在一个群里自由对话，产品经理 Agent、程序员 Agent、测试 Agent，看着热闹得像个创业公司。我告诉你工程上这是什么：三个概率系统互相传染幻觉，出了错你查不到是哪一环编的数。企业要的不是热闹，是流水线。这一讲的方案是 SOP 驱动：每个岗位一行契约，说清四件事——叫什么、吃什么、用什么工具、产出什么。产出物的名字就是下游的输入名，名字对不上，下游直接饿死，这是接口契约，不是文档约定。然后是证据链：六类数据库实体把每个岗位的输入、产出、依赖、决策全部落库——上游产出错了，一条 SQL 查出所有被污染的下游。有同学会问：那灵活性呢？灵活性在每个岗位的内部——每个岗位都是一个受控循环，decide 想怎么聪明就怎么聪明，但岗位之间，只认 SOP。这叫把自由关进笼子，把笼子排成流水线。我们开始。

## 六、配套 Lab 与自测

- Lab（见[课程大纲第 6 节](../README.md)）：三岗位流水线 + artifact 落库检查 + blocked 传播实测
- 自测：[quiz.md](./quiz.md)（9 题，≥10 分 + Lab 完成即通过）
