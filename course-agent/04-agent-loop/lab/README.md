# Lab 04 · 动手修复受控 Agent Loop 的三处语义

> 前置阅读：[第 4 节讲义](../README.md)（重点：当前执行顺序、预算前置、快照与故障边界）
> 文件清单：
> - `agent-loop.student.ts` —— 学员修复版（3 处与生产语义不符的错误实现，其余基础设施已给出）
> - `agent-loop.student.spec.ts` —— 验收测试（3 个用例，逐一对应 TODO）
> - `agent-loop.solution.ts` —— 参考答案（教学提取版，语义逐条对齐生产行号）
> - `agent-loop.solution.spec.ts` —— 参考答案自检（与学员版用例逐字一致，仅 import 不同）
> - `jest.inplace.config.json` —— 原地跑法使用的 jest 配置（见下文）

**与 Lab 02 的两点不同**：

1. **修复式填空**：不是从零写，而是给出 3 处"看起来能跑、语义全错"的实现——预算检查放在执行之后、工具 blocked 用 `continue` 跳过、检查点写在每轮开头。这些都是真实项目里最常见的写法，测试红的原因就是讲义讲的坑本身。
2. **教学提取版答案**：生产 `AgentLoopService` 是 NestJS 服务类（依赖 ToolExecutionService / Redis / 事件服务），Lab 提取为纯函数 + `ports` 注入。**语义逐条对应生产行号**（TODO 注释里都标了），但不是逐字节拷贝——`withTimeout`、Redis 快照切片等细节被注入化。

## 一、任务概览

| TODO | 要修复什么 | 对应讲义 / 生产行号 | 验收测试 |
|---|---|---|---|
| ① | 预算入口消毒（Math.max 钳制）+ 每轮对表（总超时 → failed，`steps = step - 1`） | 入口预算 / 快照时机 · L39-40 / L51-54 | 测试 1 |
| ② | 工具预算**执行前**拦截；blocked / failed（含 success 无输出）直接终止而非 continue | 工具预算 · L79-91 | 测试 2 |
| ③ | 检查点与 round.completed 写在**每轮成功后**；步数用尽 → budget_exceeded（生产原文 `执行步数达到上限 N`） | 快照时机 · L115-119 | 测试 3 |

三个 TODO 之外的代码（finish 组装、decide 异常转 failed、model 动作、事件协议）全部保留——先读懂它们再动手。

## 二、如何运行（标准三步）

```bash
# 1. 拷贝学员文件到 backend（spec 与实现必须同目录）
cp course-agent/04-agent-loop/lab/agent-loop.student.ts \
   course-agent/04-agent-loop/lab/agent-loop.student.spec.ts \
   backend/src/modules/agent-loop/

# 2. 跑验收测试：实现前应 3 个全红（断言失败），实现后应 3 个全绿
cd backend && npm test -- agent-loop.student

# 3. 完成后清理：删除 backend/src/modules/agent-loop/ 下你拷贝的两个文件（course-agent/ 原件不动）
```

### 进阶：不拷文件的原地跑法

```bash
cd backend
npx jest --config ../course-agent/04-agent-loop/lab/jest.inplace.config.json agent-loop.student
```

配置说明：本 Lab 无外部依赖（纯 TS + jest），但 `testEnvironment` 仍显式锁定 `jest-environment-node@30.4.1`——workspace 里 jest 30（backend）与 jest 29（admin-backend）共存，backend 默认解析测试环境时会错误命中 29.7.0 并报 `clearMocksOnScope is not a function`。这是 [Lab 02](../../../course/02-chunking/lab/README.md) 里详述过的同一个坑，配置模式保持一致。

## 三、实现提示（Hints）

### TODO ① 入口消毒与对表

1. 两行钳制：`Math.max(1, ...)` / `Math.max(0, ...)`——想清楚为什么一个下限是 1（至少跑一步拿结果）、另一个是 0（纯模型循环合法）。
2. 对表的位置：`remainingMs` 算出来之后、`decide` 之前——"先看表再决策"。超时的那一轮没有执行，`steps` 传 `step - 1`。
3. 测试 1 的三个子场景各卡一下：(a) `maxSteps=0` 也要拿到 complete 的输出；(b) `timeoutMs=0` 时 decide 一次都不能被调用；(c) decide 第二参的形状（预算上下文）是给定的，别改。

### TODO ② 工具分支

1. 预算检查必须在 `executeTool` **之前**——测试 2(a) 断言的是"执行器只被调 1 次"，先执行再检查会得到 2。比较符也想一下：生产用 `>=` 在递增前判断。
2. blocked / failed 是终态不是跳过：想想"被拒后继续跑"的循环会建立在什么假状态上（讲义 工具预算：以为写成功了）。
3. 第三处最隐蔽：`status === 'success'` 但 `output === undefined`——契约违例按 failed。而 `recovered` 带输出要照常 reduce（第 3 节的四态语义）。

### TODO ③ 检查点时机与步数耗尽

1. "每轮成功后"的位置语义：complete / blocked / 预算拦截的那一轮都不算成功轮，不落快照。测试 3(a) 的完成轮（step 3）若落了快照就是错的。
2. 循环正常走完（没有被 return）意味着步数用尽——budget_exceeded，理由用生产原文：`` `执行步数达到上限 ${maxSteps}` ``。
3. `checkpoint` 与 `round.completed` 事件同生同灭（生产 L115-116 连续两行），挪就一起挪，别只改一个。

## 四、参考答案

先自己写完、测试全绿，再对照答案：

```bash
# 学员版与答案版的差异就是三处修复（应只剩 TODO 注释差异）
diff backend/src/modules/agent-loop/agent-loop.student.ts course-agent/04-agent-loop/lab/agent-loop.solution.ts
```

答案自检（无需拷贝任何文件）：

```bash
cd backend
npx jest --config ../course-agent/04-agent-loop/lab/jest.inplace.config.json agent-loop.solution
```

**通过标准**：学员版 3/3 绿 + [quiz.md](../quiz.md) ≥ 10 分。两样通过只完成基础循环实验；工程验收继续做规划和故障输入。
