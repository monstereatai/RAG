# 第 8 节讲义 · Agent 评估与运营：LLM-as-Judge 与运行中心

> 课程：《从零手撕企业级 AI Agent》收官 · 评估运营
> 源码：[agent-eval.service.ts](../../backend/src/modules/agent-evals/agent-eval.service.ts) · [agent-ops-admin.controller.ts](../../backend/src/modules/agent-ops-admin/agent-ops-admin.controller.ts) L246-323 · [agentic-rag.service.ts](../../backend/src/rag/agentic/agentic-rag.service.ts) L1739-1791（observedNode） · [agent-runtime-events.service.ts](../../backend/src/modules/agent-runtime-events/agent-runtime-events.service.ts)
> 先修：全部前七节（评估是它们的验收面）

## 一、痛点引出

Agent 团队最怕的一句话："看起来不错，发吧。"——**没有度量就没有工程，只有玄学**。RAG 课程第 8 节调的是参数（延迟/召回/幻觉），Agent 要调的是**行为**：答案忠实吗？需求覆盖了吗？每次运行到底发生了什么？本节两件武器：LLM-as-Judge 做质量评估，运行中心做行为运营。

## 二、整体架构：评估与运营的双轮

```
质量轮（离线/准实时）：运行结果 → LLM-as-Judge（忠实度 + 覆盖度断言） → 评估报告
行为轮（在线）：agent.loop.* / tool.* / approval.* 事件 → Redis → run-center 面板 → 排障/复盘
```

## 三、代码拆解

### 3.1 judgeSchema：断言式评估（agent-eval.service.ts）

```ts
const judgeSchema = z.object({
  faithfulnessAssertions: z.array(z.object({
    claim: z.string(), supported: z.boolean(), reason: z.string(),  // 每条声明：是否被证据支持
  })),
  coverageAssertions: z.array(z.object({
    requirement: z.string(), covered: z.boolean(),                   // 每条需求：是否被满足
  })),
  reason: z.string(),
});
```

**教学引导语**：注意评估的粒度——**不是给答案打一个 1-10 分**，而是把答案拆成逐条断言：每条事实声明是否被证据支持（忠实度），每条需求是否被覆盖（覆盖度）。两个原因：① 分数是黑箱，断言是可行动的——"claim: 退款周期 7 天，supported: false"直接指出编在哪；② 断言可聚合统计（本周忠实度违规 12 次，集中在报销类问题），分数也可用于趋势分析，但需要稳定评分规则。zod 结构化输出保证 Judge 的产出是**机器可解析的**，不是一段要人读的评语。

### 3.2 运行中心：行为的运营面板（agent-ops-admin.controller.ts L246-323）

`run-center` 端点族：运行实例列表 → 单实例详情（完成轮次、快照数量、**终止状态与原因**）→ 逐轮事件展开 → artifacts → retry → metrics。**排障动线**：面板上看到 budget_exceeded 实例 → 展开逐轮事件 → 定位是哪个工具/哪一步烧完预算 → 结合第 4 节的 `agent.loop.round.started` 事件里的 remainingMs 看预算消耗曲线。终止四状态（第 1 节）在这里兑现价值：**completed/blocked/failed/budget_exceeded 天然是运营的四个分类视图**——blocked 可能是正确权限阻断或审批等待，budget_exceeded 表示预算保护触发，failed 可能来自代码、模型或外部依赖；根因需结合轨迹核对。

### 3.3 observedNode：节点级观测的统一包装（L1739-1791）

```ts
// 所有 LangGraph 节点被 observedNode 包装：统一记录 成功/失败 + 耗时 + 指标 + node_timing 事件
```

不是在每个节点里手写埋点，而是**包装器统一注入**——新增节点自动获得观测，忘了埋点这种事故在结构上不可能发生。这是横切关注点（cross-cutting concern）的标准解法，对照 RAG 课程第 7 节的 guard/interceptor 一脉相承。

### 3.4 事件计数：审批与循环的账本（agent-runtime-events.service.ts L41-57）

approvals / approvalAsked / approvalDecided / loop / tool / node 各类计数。第 5 节说过审批要有账本，这里是账本的数据源——**评估与运营最终回答的都是管理问题**："这套 Agent 上线后，拦了多少高危操作、成功率多少、成本多少。"

### 3.5 诚实边界：Judge 也会错

评估者本身是 LLM——它会漏判（该标 unsupported 的没标）、会偏判（对长答案更宽容）。缓解：断言式比整体打分的可复核性强（人可以抽查单条断言）；关键场景抽样人工复核；Judge 的 prompt 与模型版本固定，保证评估口径可比较。**评估是减少不确定性的工具，不是真理**。

## 四、生产坑点（学员最易踩的 2 个）

### 坑点 1：指标有了，闭环没有

- **现象**：评估报告每周生成、面板每天有人看，但 Agent 质量三个月没变化——评估变成了仪式。
- **根因**：评估结果没有回流路径——没有"哪类断言失败归哪个岗位/工具/Prompt 负责"的机制。
- **排查/预防**：闭环四步：断言失败分类（忠实度→生成 Prompt/引用门禁；覆盖度→SOP 拆解/检索）→ 归因到具体组件 → 修复后**同题重跑对比**（评估集固定）→ 指标趋势汇报。对照 RAG 课程第 8 节调参循环——Agent 版的调参对象从参数换成了行为组件。

### 坑点 2：评估集被"背题"污染

- **现象**：指标持续上涨，真实用户满意度不动——评估题目混进了训练/迭代过程，团队在对着固定答案优化。
- **根因**：评估集长期不换且被反复用于 Prompt 调优，形成过拟合。
- **排查/预防**：评估集分桶（开发集/盲测集，盲测集不参与日常调优）；定期从真实用户问题里抽样补充新题；指标上涨时抽查盲测集是否同步上涨。**评估集是考试卷，考卷泄露了考试就失效**。

## 五、讲师口播稿（约 300 字）

> 最后一讲，讲这门课的"验收面"。先问你们团队三个问题：你们的 Agent 上周成功率是多少？被审批门禁拦了多少次高危操作？哪类问题的忠实度最差？一个都答不上来的，不是你们不努力，是缺了这一讲的内容。第一件武器，LLM-as-Judge。注意它的做法：不打总分，打断言——答案里的每条声明，是否被证据支持；需求的每一项，是否被覆盖。为什么？分数是黑箱，断言是可行动的：哪条编了、哪里漏了，直接指认，还能统计聚合。第二件武器，运行中心。第 1 节的四个终止状态，在这里变成四个运营视图：blocked 可能是正确阻断或待审批，budget_exceeded 表示预算保护，failed 可能是代码、模型或依赖异常——分类排障，不靠猜。最后一句提醒，也是全课的收尾：Judge 自己也是模型，它也会错。评估是减少不确定性的工具，不是真理——留 5% 的人工抽查，对评估本身保持谦逊。这门课到这就完了，去把 Capstone 交付了吧。

## 六、配套 Lab 与自测

- 工程实验：[任务评测与修复](../LABS.md)；先读[任务级评测](./TASK-EVALUATION.md)和[运行治理](./OPERATIONS.md)。
- 自测：[quiz.md](./quiz.md)（9 题，≥10 分 + Lab 完成即通过）
