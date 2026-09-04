# 第 2 节讲义 · 自定义文档切片与语义重叠策略

> 课程：《从零手撕企业级 RAG》第 2 节 · 文档处理管线（切片模块精讲）
> 源码：[`chunking.util.ts`](../../backend/src/modules/document/chunking.util.ts)（410 行）
> 配套测试：[`chunking.util.spec.ts`](../../backend/src/modules/document/chunking.util.spec.ts)（9 个用例，本讲义的"可执行验收标准"）

---

## 一、痛点引出

固定长度暴力切片（每 500 字切一刀）的致命问题是**语义腰斩**：表格被切成 `| 金币 | 50% |` 这样没有表头的裸数据行，向量里"这是什么的 50%"完全丢失；代码块从中间断开变成语法错误；一个 chunk 脱离了它所在的章节，模型根本不知道这段话在讲"员工手册 > 薪酬制度"还是"活动配置 > 抽奖规则"。**检索质量的上限在入库时就已被切片器决定，后面换再贵的 Embedding 和 Rerank 都救不回来。**

本模块的解法是四个动作：按 Markdown 标题结构切、把表格翻译成自包含的人话、代码/表格块整体保护不腰斩、给每个 chunk 盖上"章节路径"上下文邮戳。

## 二、整体架构（数据流）

```
原始 Markdown
   │
   ▼
normalizeTables()          表格行 → "表格列：/表格行：key=value" 自包含文本
   │
   ▼
collectSections()          按 H1-H6 切节，维护 headingPath 标题栈 + 条款编号识别
   │
   ▼
splitSection()             每节内：
   ├─ collectBusinessBlocks()   按空行/代码围栏切块，识别 code/table/api/test/version
   ├─ 保护块（code/table）       整块输出，表格按完整行分组且每个 chunk 复用表头
   └─ 普通块                     RecursiveCharacterTextSplitter 二次切分（预算内）
   │
   ▼
StructuredChunk[]          content + headingPath + clauseId + tableRef + 源文偏移量
```

一句话总结设计哲学：**结构信息优先，递归切分兜底**——能用文档自身结构（标题/表格/代码围栏）切的地方绝不靠字数硬切，字数切分只作为最后一段防线。

## 三、代码拆解

### 3.1 数据结构：切片器输出什么（L24-34）

先看输出再讲实现，让学生带着"目标形状"读代码：

```ts
export interface StructuredChunk {
  content: string;          // 切片正文（含章节路径前缀、内容类型标签）
  chunkIndex: number;       // 全文档递增序号
  parentChunkId: string | null;  // 父节点 = 所属 section，用于"小节召回→整节阅读"
  headingPath: string[];    // ['员工手册', '薪酬制度'] 标题路径
  sectionId: string | null;
  clauseId: string | null;  // '第一条' —— 条款级精确引用
  tableRef: string | null;  // 表格归属，跨 chunk 表格关联
  sourceStart: number; null;  // 源文档字符偏移，前端高亮引文用
  sourceEnd: number | null;
}
```

**教学引导语**：注意这不是 `string[]`，切片的"元数据"和正文同等重要。`parentChunkId`/`sourceStart` 这些字段在检索阶段才能变现——小 chunk 精确召回、命中后拿 parent 整节重排，是"检索粒度"和"阅读粒度"解耦的经典手法。

### 3.2 表格归一化（L94-171）：先把表格翻译成人话

```ts
// 表头行 → 声明列名
out.push(`表格列：${cells.join(' / ')}`);
// 数据行 → key=value 自包含文本
const rowText = cells
  .map((cell, index) => `${tableHeader?.[index] ?? `列${index + 1}`}=${cell}`)
  .join('；');
out.push(`表格行：${rowText}`);
```

**教学引导语**：这一步在切分**之前**执行，顺序是关键。`| 绩效奖金 | 按季度评估 |` 这行文本对 Embedding 模型毫无语义；翻译成 `表格行：项目=绩效奖金；规则=按季度评估` 后，每个数据行都自包含表头语义——这正是"语义重叠策略"在表格场景的落地：**重叠的不是字符，是上下文**。

三个细节值得逐行讲：

1. **代码围栏状态机**（L102-111）：遇到 ``` 切换 `fencedCode` 开关，围栏内不解析表格。否则 `const status = a || b` 里的 `||` 会被当成表格竖线，代码直接被劈碎。
2. **分离符行跳过**（L120-122）：`| --- | --- |` 是 markdown 表格语法噪音，不产生语义，直接丢弃。
3. **转义竖线**（L150-155）：单元格里的 `\|` 逐字符解析还原成 `|`。spec 里"多语言素材"用例（L143-157）专门验证 `泰语\|德语` 不被劈成两列。

### 3.3 章节收集（L340-404）：标题栈算法

```ts
const heading = /^(#{1,6})\s+(.+)$/.exec(line.trim());
if (heading) {
  pushCurrent();
  const level = heading[1].length;
  headingPath = headingPath.slice(0, level - 1);   // 弹栈到父级
  headingPath[level - 1] = heading[2].trim();       // 压入当前标题
  ...
}
```

**教学引导语**：`headingPath` 是一个用数组模拟的**栈**。`## 二级标题` 出现时，`slice(0, level - 1)` 先把更深的层级弹掉再压入自己——这样任何时刻 `headingPath` 都是从 H1 到当前的完整路径。学员最容易犯的错是只用 `slice` 不赋值（或反之），结果路径越切越深回不去。让学生手动模拟 `# A → ## B → # C` 三个标题走一遍栈的变化。

另一个容易忽略的分支（L379-385）：**条款编号识别**。`第一条`、`1.2.3、` 这类中文文档模式被注入为 `条款编号：第一条` 标记行，最终由 `extractClauseId`（L406-409）提取进 `clauseId` 元数据。法律/制度类文档"按条款检索"就靠它。

### 3.4 分节切分（L181-239）：动态预算与保护块

这是全模块工程密度最高的 50 行，两个考点：

**考点一：contentBudget 动态预算**（L185-189）

```ts
const prefix =
  section.headingPath.length > 0
    ? `章节路径：${section.headingPath.join(' > ')}\n`
    : '';
const contentBudget = Math.max(1, this.chunkSize - prefix.length);
```

每个 chunk 都要带 `章节路径：员工手册 > 薪酬制度\n` 前缀（spec 用例"repeats the full heading path on every leaf chunk"验证）。前缀占了字数，所以**正文预算 = chunkSize - 前缀长度**，动态计算。这不是优化，是正确性：不扣前缀的话，"前缀 + 正文"会稳定超出 chunkSize 约 10-15%。

**考点二：保护块策略**（L223-235）

```ts
if (block.kind === 'code' || block.kind === 'table') {
  await flushRegularBlocks();          // 先把攒的普通块切掉
  const protectedChunks =
    block.kind === 'table'
      ? this.splitTableBlock(decorated, contentBudget)
      : [decorated];                   // 代码块：整块输出，绝不切
  chunks.push(...protectedChunks.map((content) => `${prefix}${content}`));
  continue;
}
```

代码块**允许超预算**，整体输出。这是个明确的 trade-off：被腰斩的代码是语法错误（负资产），超长的完整代码至少语义无损（正资产），代价是 Embedding 时要留意 token 上限。让学生记住这个决策模式：**切分器里"不切"有时比"怎么切"更重要**。

**overlap 钳制**（L201-204）：

```ts
chunkOverlap: Math.min(
  this.chunkOverlap,
  Math.max(0, contentBudget - 1),
),
```

为什么 `contentBudget - 1`？因为 overlap ≥ chunkSize 时 `RecursiveCharacterTextSplitter` 会异常/死循环。深层嵌套标题把预算压小后，这个 clamp 就是保命符——坑点二详解。

### 3.5 业务块识别与打标（L241-311）

`collectBusinessBlocks` 按空行和代码围栏把节内正文切成块，然后 `detectBusinessBlockKind` 用正则给每块分类：

| kind | 识别特征 | 打标结果 |
|---|---|---|
| code | ``` 围栏开头 | `内容类型：代码或配置` |
| table | 含 `表格列：/表格行：` | `内容类型：配置表` |
| api | `POST /xxx`、请求参数、错误码 | `内容类型：接口契约` |
| test | 测试用例、前置条件、预期结果 | `内容类型：测试与验收` |
| version | 版本：、生效地区、V3 | `内容类型：版本与地区规则` |

**教学引导语**：这层"业务语义打标"是纯自研项目才有的东西。LangChain 的 splitter 给你通用切分，但不知道你的文档里"错误码 40003"是接口契约、"生效地区：东南亚服"是版本规则。`内容类型：` 前缀直接进 chunk 正文参与向量化，用户问"这个接口的验收标准"时，语义匹配直接受益。

### 3.6 表格分块（L313-338）：按完整行分组

```ts
for (const row of rows) {
  const candidate = [...current, row].join('\n');
  if (current.length > baseLines.length && candidate.length > contentBudget) {
    chunks.push(current.join('\n'));
    current = [...baseLines, row];   // 新 chunk 重新带上 [标签行, 表头行]
  } else {
    current.push(row);
  }
}
```

超长表格切分时，每个新 chunk 都以 `[内容类型标签, 表格列：表头]` 开头——**表头在每个 chunk 里重复**，这正是"语义重叠"在表格场景的第二层落地。spec 用例"splits long tables by complete rows and repeats table headers"（L116-141）就是这条规则的验收标准。

### 3.7 关键参数设定依据（总结表）

| 参数 | 默认值 | 设定依据 |
|---|---|---|
| `chunkSize` | 500 | 中文业务文档单条规则/条款通常 200-500 字。chunk 越大向量语义越被"平均"、召回越模糊；越小上下文越碎。500 是语义完整与检索精确的平衡点，需按语料实测调整（见 Lab） |
| `chunkOverlap` | 50 | 约 chunkSize 的 10%，只兜"句子恰在边界被切断"。过大 = 重复内容入库，污染 BM25 的 tf 统计、浪费 Embedding 配额 |
| `separators` | `['\n\n','\n','。','！','？','.','!','?',' ','']` | 从粗到细的降级链：段落 → 行 → 中文句号 → 英文句号 → 词 → 硬切。中文标点排在英文前；最后的 `''` 表示所有分隔符都失败时才允许字符级硬切 |
| `contentBudget` | `chunkSize - prefix.length` | 保证"章节路径前缀 + 正文"总长不超预算，前缀长度随标题嵌套深度动态变化 |
| overlap clamp | `min(overlap, contentBudget - 1)` | 防止预算被前缀压小后 overlap ≥ chunkSize 触发 splitter 异常 |

## 四、生产坑点（学员最易踩的 2 个）

### 坑点 1：表格切片丢表头，检索结果"答非所问"

- **现象**：用户问"绩效奖金怎么发放"，检索命中的 chunk 是 `| 绩效奖金 | 按季度评估 |`——没有表头，向量里"项目/规则"的语义完全丢失，模型答非所问或幻觉。隐蔽变体：单元格含转义竖线 `\|` 时，表格被错误地劈成多列。
- **根因**：markdown 表格的表头行和数据行物理分离，任何按行/按字数的通用切分都会把两者拆开。**用现成 splitter 的学员 100% 会遇到**。
- **排查方法**：
  1. 入库前 grep chunk 内容：含奇数个 `|` 或以 `|` 开头但不含 `表格列：` 的 chunk，就是丢表头的漏网之鱼；
  2. 写断言单测：每个含 `表格行：` 的 chunk 必含 `表格列：`（本模块 spec L116-141 就是标准答案）；
  3. 验证转义：构造 `泰语\|德语` 用例，断言还原成单列（spec L143-157）。

### 坑点 2：章节路径前缀吃掉预算 → 切片爆炸或 splitter 死循环

- **现象**：文档标题嵌套到三四级（`活动平台 > 2026周年庆 > 抽奖模块 > 东南亚服`）后，chunk 数量暴增、Embedding 账单翻倍；极端情况下 `RecursiveCharacterTextSplitter` 直接抛异常或死循环。
- **根因**：每个 chunk 都携带完整 `章节路径：` 前缀（L185-187），前缀越长 `contentBudget` 越小（L189）；当 `contentBudget ≤ chunkOverlap` 时，overlap ≥ chunkSize 触发 splitter 异常。前缀越深 → 预算越小 → chunk 越碎 → 数量越多，恶性循环。
- **排查方法**：
  1. 打点日志输出每节的 `prefix.length` 和 `contentBudget` 分布，`contentBudget < 100` 告警；
  2. 检查 L201-204 的 clamp 是否在自己的实现里存在（`Math.min(overlap, contentBudget - 1)`）；
  3. 治本：`headingPath` 截断到 2-3 级，深层标题只保留最近一级——上下文价值和前缀成本不成正比。

## 五、讲师口播稿（约 300 字，开场用）

> 大家好，今天我们讲整个 RAG 系统里投入产出比最高的一个模块——文档切片。很多同学 RAG 效果不好，第一反应是换更大的模型、换更好的 Embedding，结果召回还是稀碎。问题往往不在模型，而在你喂给它的知识库：固定五百字一刀切下去，表格被切成三段裸数据，代码从中间断开，一个 chunk 单拿出来谁都看不懂——模型也一样看不懂。今天这节课，我们直接打开这个项目里四百行的 MarkdownChunker 源码，看它用四招解决问题：先按标题结构切，再把表格翻译成人话，代码和表格整块保护绝不腰斩，最后给每个 chunk 盖上"章节路径"的上下文邮戳。你会发现所谓"语义重叠"，重叠的根本不是那五十个字符，而是上下文本身。学完这节课你会认同一句话：切片器里五十行代码的差异，抵得上换三次 Embedding 模型。我们开始。

## 六、配套 Lab

填空实战（3 处 TODO：表格语义化 / 标题栈 / 行分组，参考答案即生产代码）见 [lab/](./lab/)；对拍实验、参数扫描等扩展练习见[课程大纲第 2 节](../README.md)。
