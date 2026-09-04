# 第 1 节自测 · 你学会了吗？

> 合上讲义独立完成，再对照底部答案。**通过标准：满分 12 拿 ≥10 分 + Lab 完成（三模式对比 + 受控循环改写）。**

## 一、判断题（每题 1 分）

1. Simple 模式也会进入 Agent Loop，只是步数上限为 1。
2. `blocked` 和 `failed` 都会终止循环，所以运营上可以合并成一类告警处理。
3. `AgentLoopService` 通过泛型 `TState / TOutput` 保持对业务状态的无知。

## 二、选择题（每题 1 分）

4. 决策类型 `AgentLoopDecision` 不包含以下哪一种？
   - A. `model`（模型动作）
   - B. `tool`（工具动作）
   - C. `retry`（重试上一动作）

5. 循环每轮开始的第一件事是？
   - A. 调用 decide 产生决策
   - B. 检查剩余总时限 remainingMs
   - C. 写检查点快照

6. `budget_exceeded` 终止的正确理解是？
   - A. 系统故障，等同 failed，应触发告警升级
   - B. 保护性终止——预算防线生效，结果里仍保留已完成的 state
   - C. 循环 bug，需要修复代码

## 三、简答题（每题 2 分）

7. 为什么 `AgentLoopDecision` 用 TypeScript 判别联合（discriminated union）定义，而不是一个带 `type: string` 的扁平接口？编译期和运行期各获得什么？
8. "业务 DAG、工具实现和审批规则仍由现有模块负责"——这个职责边界给 AgentLoopService 带来了什么收益？举一个反例说明违反它的后果。

## 四、代码审查题（2 分）

9. 同学写的 Agent 循环骨架：

```ts
async function runAgent(goal: string) {
  let done = false;
  while (!done) {
    const decision = await llm.plan(goal);
    if (decision.isComplete) { done = true; continue; }
    if (decision.tool) {
      const result = await executeAnything(decision.tool, decision.args); // 任何工具直接执行
      goal = decision.tool + ' result: ' + JSON.stringify(result);
    }
  }
  return { ok: true };
}
```

对照本节讲义，指出至少 3 个问题。

---

## 参考答案（先做完再看）

1. **错**。Simple 是固定线性 Fast Path，**不进入循环**——不是"步数为 1 的循环"（§二）。
2. **错**。blocked 是被权限/审批/依赖阻断（预期内），failed 是异常（预期外）——告警级别、排障路径完全不同（§3.3）。
3. **对**。内核通过 `decide`/`reduce` 回调与泛型隔离业务知识（§3.1）。
4. **C**。四类型是 model/tool/complete/blocked——**没有 retry**：要重试就再次返回 tool 决策，由预算闸门约束（§3.2）。
5. **B**。每轮先对表，超时以 failed 终止并保留 state（§3.4）。
6. **B**。预算是防线不是 bug；结果对象里 state/steps/toolCalls 全部保留，运营可追溯（§3.3）。
7. 编译期：`decision.type` 窄化后编译器知道可用字段（complete 必有 output、blocked 必有 reason），漏传直接编译错误，把运行时 bug 前置到构建；运行期：分支穷尽（switch/if 覆盖全部 type），不存在"未知类型落到神秘分支"——状态机的非法状态在类型层面就不存在。
8. 收益：一个内核服务多场景（Chat/Task），业务变更不动内核，内核升级全场景受益；反例：在内核里加 `if (scenario === 'task')` 业务分支后，改 Task 逻辑会波及 Chat 场景（坑点 2 的真实案例）。
9. ① 无终态分类：只有 done 布尔，无 completed/blocked/failed/budget_exceeded——阻断、故障、超限无法区分；② 无预算：没有 maxSteps/maxToolCalls/timeout，卡死或烧钱是时间问题；③ `executeAnything` 直连工具：绕过 Tool Registry 的权限/审批/幂等壳（第 2、3 节的主题）；④ 把结果塞回 goal 字符串当状态：无结构化 reduce，状态管理退化成字符串拼接；⑤ 无检查点：中断后只能从零重跑。

**计分**：判断/选择每题 1 分，简答/代码题每题 2 分，满分 12。
**通过标准**：≥10 分 + Lab 完成。未达标 → 重读 §3.2/§3.3 与坑点 1，隔天重做。
