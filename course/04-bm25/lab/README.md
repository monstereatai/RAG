# Lab 04 · 动手实现 BM25 核心：分词、索引与打分

> 前置阅读：[第 4 节讲义](../README.md)（重点 §3.1 打分公式 / §3.2 分词 / §3.3 tf 恒为 1）
> 文件清单：
> - `bm25.student.ts` —— 学员填空版（3 处 TODO，jieba 懒加载/降级、clear、排序截断等基础设施已给出）
> - `bm25.student.spec.ts` —— 验收测试（3 个用例，含手算对拍）
> - `bm25.solution.ts` —— 参考答案（与生产代码 `bm25.util.ts` **逐字节一致**）
> - `bm25.solution.spec.ts` —— 参考答案自检（与学员版用例逐字一致，仅 import 不同）
> - `jest.inplace.config.json` —— 原地跑法配置（见下文）

**与 Lab 02（chunking）同款玩法**：从零填空而非修复错误——三处核心逻辑留白，其余逐字保留生产结构，完成后 diff 应只剩注释差异。

## 一、任务概览

| TODO | 所在方法 | 要实现什么 | 对应讲义 | 验收测试 |
|---|---|---|---|---|
| ① | `tokenize`（jieba 分支） | trim → 小写 → 滤空 → **去重保序** | §3.2 / §3.3 | 测试 1 |
| ② | `addDocs` | docFreq（**文档数**计数）+ avgDocLen | §3.1 前置 | 测试 2 |
| ③ | `search`（打分循环） | idf（含 +1）× tfNorm（k1/b 长度归一化）→ 累加 | §3.1 | 测试 3 |

**修复依赖链**：① → 测试 1 绿；①+② → 测试 2 绿（docTokens 来自 tokenize）；①+②+③ → 测试 3 绿。按序做，每步都有绿可看。

## 二、如何运行（标准三步）

```bash
# 1. 拷贝学员文件到 backend（spec 与实现必须同目录，@node-rs/jieba 才能解析）
cp course/04-bm25/lab/bm25.student.ts \
   course/04-bm25/lab/bm25.student.spec.ts \
   backend/src/rag/karpathy/

# 2. 跑验收测试：实现前应 3 个全红（断言失败），实现后应 3 个全绿
cd backend && npm test -- bm25.student

# 3. 完成后清理：删除 backend/src/rag/karpathy/ 下你拷贝的两个文件（course/ 原件不动）
```

### 进阶：不拷文件的原地跑法

```bash
cd backend
npx jest --config ../course/04-bm25/lab/jest.inplace.config.json bm25.student
```

与 [Lab 02](../../02-chunking/lab/README.md) 同款配置：`modulePaths` 借 backend 的依赖（本 Lab 依赖原生模块 `@node-rs/jieba`——比 Lab 02 的纯 JS 依赖多一层原生绑定加载，实测 jest 环境下正常工作，可对照生产 spec `bm25.util.spec.ts` 的跑法）；`testEnvironment` 显式锁定 30.4.1 规避 workspace 的 jest 29/30 共存坑。

## 三、对拍数字的由来（测试 3 的期望值怎么算的）

测试 3 的语料与手算过程——**建议先自己拿计算器算一遍再写代码**，这正是 quiz 计算题的实地演习：

```
语料（tokenize 去重后）：
  d1 'alpha'                       → ['alpha']                    len 1
  d2 'alpha alpha alpha'           → ['alpha']（去重！）           len 1
  d3 'alpha beta gamma delta epsilon' → 5 词                      len 5
  d4 'beta gamma'                  → 2 词，不含 alpha              len 2

N = 4，df(alpha) = 3，avgDocLen = (1+1+5+2)/4 = 2.25

idf = ln((N - df + 0.5)/(df + 0.5) + 1) = ln(1.5/3.5 + 1) = ln(10/7) ≈ 0.3566749

d1/d2（tf=1, len=1）：
  tfNorm = (1×2.5) / (1 + 1.5×(1 - 0.75 + 0.75×(1/2.25)))
         = 2.5 / (1 + 1.5×(0.25 + 0.3333)) = 2.5 / 1.875 = 1.3333
  score = 0.3566749 × 1.3333 ≈ 0.4755666

d3（tf=1, len=5）：
  tfNorm = 2.5 / (1 + 1.5×(0.25 + 0.75×(5/2.25))) = 2.5 / 3.875 = 0.6452
  score = 0.3566749 × 0.6452 ≈ 0.2301116
```

三个断言各自锁死的语义：

| 断言 | 锁死什么 |
|---|---|
| `hits` 只有 3 条 | score>0 门 + **idf 的 +1**（df=3 > N/2=2，漏 +1 则分数全负、一条都拿不到） |
| `s2 === s1`（严格相等） | **tf 恒为 1**——tokenize 去重是 TODO① 与 TODO③ 的联动语义 |
| `hits[2].id === 'd3'` | 长度归一化（b 参数）让长文档吃亏 |

## 四、实现提示（Hints）

### TODO ① tokenize 流水线

1. 四步是链式的：`jieba.cut(text)` 的结果依次 map → filter → 去重。
2. 去重保序一行：`[...new Set(tokens)]`——`Set` 构造时保序、扩展运算符转回数组。
3. 别忘了为什么去重：不是省内存，是**让 tf 恒为 1**（讲义 §3.3）——测试 3 的 `s2 === s1` 会回头检查这一步。

### TODO ② docFreq 与 avgDocLen

1. df 的语义是"**有几篇文档**含这个词"：d2 里 'vector' 出现 3 次，df 只 +1。
2. `new Set(tokens)` 后逐词 +1——tokens 已被 tokenize 去重，这层 Set 是防御性的（不默默依赖上游语义），注释里想清楚这一点。
3. avgDocLen 注意空索引：`docTokens.length > 0` 时才除，否则保持 0。

### TODO ③ 打分循环

1. `tf === 0` 必须 `continue`——词不在文档里，这一项不得分也不报错。
2. idf 公式整体照讲义 §3.1：分子 `(N - df + 0.5)`、分母 `(df + 0.5)`、**log 里 +1**。漏 +1 测试 3 直接全空（见上文断言表）。
3. tfNorm 分母的 `this.avgDocLen || 1`——空索引防除零；k1=1.5、b=0.75 是类字段，直接用。

## 五、参考答案

先自己写完、测试全绿，再看答案：

```bash
# 逐行对拍（应只剩注释差异）
diff backend/src/rag/karpathy/bm25.student.ts course/04-bm25/lab/bm25.solution.ts
```

`bm25.solution.ts` 与生产实现 `backend/src/rag/karpathy/bm25.util.ts` 逐字节一致——参考答案不是教学简化版，就是线上跑的代码本身。对生产实现直接跑同样 3 个用例的自检（无需拷贝任何文件）：

```bash
cd backend
npx jest --config ../course/04-bm25/lab/jest.inplace.config.json bm25.solution
```

**通过标准**：学员版 3/3 绿 + [quiz.md](../quiz.md) ≥ 10 分（计算题和本 Lab 的手算是同一套功夫）。
