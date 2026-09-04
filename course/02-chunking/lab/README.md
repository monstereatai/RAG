# Lab 02 · 动手实现 MarkdownChunker 核心算法

> 前置阅读：[第 2 节讲义](../README.md)（重点 §3.2 表格归一化 / §3.3 标题栈 / §3.6 表格分块）
> 文件清单：
> - `chunking.student.ts` —— 学员填空版（3 处 TODO，其余基础设施已给出）
> - `chunking.student.spec.ts` —— 验收测试（3 个用例，逐一对应 TODO）
> - `chunking.solution.ts` —— 参考答案（与生产代码逐字节一致）
> - `chunking.solution.spec.ts` —— 参考答案自检（直接对生产实现跑同样的 3 个用例）
> - `jest.inplace.config.json` —— 进阶原地跑法使用的 jest 配置（见下文）

## 一、任务概览

| TODO | 所在方法 | 要实现什么 | 对应讲义 | 验收测试 |
|---|---|---|---|---|
| ① | `normalizeTables` | 表格语义化：分隔行丢弃、表头捕获、数据行序列化为 `表格行：列=值` | §3.2 | 测试 1 |
| ② | `collectSections` | 标题栈：`headingPath` 弹栈/压栈，遇同级标题能"弹回去" | §3.3 | 测试 1、2 |
| ③ | `splitTableBlock` | 长表格按完整行分组，新 chunk 必须复用表头 | §3.6 | 测试 3 |

三个 TODO 之外的代码（逐字符表格解析、业务块正则识别、动态预算与 overlap 钳制等）全部保留——先读懂它们再动手，别跳过。

## 二、如何运行（标准三步）

```bash
# 1. 拷贝学员文件到 backend（spec 与实现必须同目录，@langchain/textsplitters 才能解析）
cp course/02-chunking/lab/chunking.student.ts \
   course/02-chunking/lab/chunking.student.spec.ts \
   backend/src/modules/document/

# 2. 跑验收测试：实现前应 3 个全红（断言失败），实现后应 3 个全绿
cd backend && npm test -- chunking.student

# 3. 完成后清理：删除 backend/src/modules/document/ 下你拷贝的两个文件（course/ 原件不动）
```

### 进阶：不拷文件的原地跑法

理解了依赖解析机制后，可以用仓库自带的 `jest.inplace.config.json` 直接在 course 目录原地跑：

```bash
cd backend
npx jest --config ../course/02-chunking/lab/jest.inplace.config.json chunking.student
```

这份配置里藏着两个比 Lab 本身更值钱的工程知识点：

1. **`modulePaths` 借依赖**：pnpm workspace 下 `@langchain/textsplitters` 只装在 `backend/node_modules`，从 `course/` 按默认规则向上找不到——monorepo 依赖解析的现实一课。
2. **显式锁定测试环境**：本 workspace 同时存在 jest 30（backend）与 jest 29（admin-backend），backend 默认解析 `testEnvironment` 时会错误命中 29.7.0 的环境包，其 moduleMocker 缺少 30.x 需要的方法，直接报 `this._moduleMocker.clearMocksOnScope is not a function`。配置里因此显式指向了 backend 自己的 `jest-environment-node@30.4.1`。若日后 workspace 统一 jest 版本，此覆盖可以去掉。

## 三、实现提示（Hints）

### TODO ① 表格语义化

1. **结构先行**：三分支骨架——分隔行 `continue`、无表头则记表头、有表头则序列化。先搭 if 骨架，再填输出格式。
2. 分隔行判定（兼容 `:---:` 对齐语法）：`cells.every((cell) => /^:?-{3,}:?$/.test(cell))`
3. 序列化模板：`cells.map((cell, i) => \`${tableHeader?.[i] ?? \`列${i + 1}\`}=${cell}\`).join('；')`——注意列数超出表头时的兜底。

### TODO ② 标题栈

1. `headingPath` 是**用数组模拟的栈**：`slice(0, level - 1)` 负责"弹回父级"，`headingPath[level - 1] = 标题` 负责"压入"。**先弹后压，顺序不能反**。
2. 测试 2 就是防"路径越切越深"的：`## B` 之后再遇 `# C`，栈里 B 必须被弹掉。得到 `['C', 'B']` 说明只压不弹。
3. 新节的 `headingPath` 必须**拷贝**（`filter(Boolean)` 同时完成拷贝和去空洞），否则后续标题会污染前面已收集的节。

### TODO ③ 行分组

1. **先算后加**：`const candidate = [...current, row].join('\n')`，用 `candidate.length` 与 `contentBudget` 比大小，不要真 push 了再回退。
2. 开新组的前提是 current 已含数据行（`current.length > baseLines.length`），否则第一行就会触发开组。
3. 新组从 `[...baseLines, row]` 起步——`baseLines` 就是 `[内容类型标签, 表头行]`，这就是"表头复用"。

## 四、参考答案

先自己写完、测试全绿，再看答案：

```bash
# 逐行对拍（应只剩注释差异）
diff backend/src/modules/document/chunking.student.ts course/02-chunking/lab/chunking.solution.ts
```

`chunking.solution.ts` 与生产实现 `backend/src/modules/document/chunking.util.ts` 逐字节一致——参考答案不是教学简化版，就是线上跑的代码本身。对生产实现直接跑同样 3 个用例的自检（无需拷贝任何文件）：

```bash
cd backend
npx jest --config ../course/02-chunking/lab/jest.inplace.config.json chunking.solution
```
