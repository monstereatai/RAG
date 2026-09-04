# 第 5 节讲义 · 充分性门控与回答链路（Karpathy 链路）

> 课程：《从零手撕企业级 RAG》第 5 节 · 检索核心 II
> 源码：[karpathy-rag.service.ts](../../backend/src/rag/karpathy/karpathy-rag.service.ts)（`answer` L771 主线 / `assessFastPath` L1191 / `answerWithWebFallback` L1455） · [context-builder.ts](../../backend/src/rag/karpathy/context-builder.ts)
> 前置：第 2 课切片、第 4 课混合检索——本节把它们串成完整回答链路

## 一、痛点引出

传统 RAG 的逻辑是"检索到什么就答什么"：检索为空，模型照样编；检索到垃圾，模型照样一本正经地引用垃圾。本节的主角是一层 LangChain `RetrievalQA` 完全不给你暴露的**决策层**：先判断"检索够不够"，再决定"直答 / 生成 / 补证 / 拒答"。

## 二、answer() 主线全景（L771 起）

```
normalizeQuery → detectRetrievalProfile（意图分档）
  ├─ karpathyDirectAnswer 开启：answerDirect（只查 PG 精确问题，不碰 Milvus）命中即返回
  ├─ Promise.all 三路并发：Base Case 纠错 / 正式 Hybrid RAG / Obsidian
  ├─ exact Bad Case 命中 → 纠错回答（短路返回）
  ├─ 双门禁：baseCaseGate + formalRetrievalGate
  ├─ 门禁充分 → ContextBuilder 组装 → 流式生成
  ├─ 门禁不足 → answerWithWebFallback 联网补证 → 再门禁
  └─ 仍不足 → 安全降级（confidence = 0 + 补充信息指引，绝不硬答）
```

## 三、代码拆解

### 3.1 直答：零检索成本的捷径（L818-831）

`karpathyDirectAnswer` 开启时先走 `answerDirect`（L1350）——**只查 PostgreSQL 精确问题表，完全不触发 Milvus 语义检索**。已审核的 Base Case（含中文姓名单字纠错）命中即返回，一次向量计算都不花。未命中则与正式 Hybrid RAG **并行**继续（L833-837）。

### 3.2 三路并发与各自的降级（L833-845）

```ts
[badCaseMatches, initialRetrieval, obsidianHits] = await Promise.all([
  retrieveBaseCaseKnowledge(),   // Bad Case 纠错证据
  retrieveFormalKnowledge(),     // 正式 Hybrid RAG
  retrieveObsidianKnowledge(),   // Obsidian 笔记（自带 catch 降级）
]);
```

延迟从 sum 变 max；且 `prefetchedFastPath`（L791-813）让 Fast Path 阶段的检索快照直接复用——上层（auto 模式）升级链路时**不重复检索**。

### 3.3 双门禁与证据合并顺序（L869-887）

```ts
const chunks = formalRetrievalGate.sufficient
  ? [...retrieval.chunks, ...reviewedBaseCaseChunks]   // 正式充分：正式在前
  : [...reviewedBaseCaseChunks, ...retrieval.chunks];  // 正式不足：已审核证据在前
```

两道门：`baseCaseGate`（已审核纠错证据）与 `formalRetrievalGate`（`assessRetrievalQuality`，空结果直接 insufficient）。**任一充分即放行**；合并顺序随门禁结果变化——正式检索充分时它优先，不足时**已审核的人工证据顶到前面**。这个顺序变化是语义的：兜底证据质量更可信时，让它主导上下文。

### 3.4 充分性不足：补证 → 再门禁 → 安全降级

门禁不足时进入 `answerWithWebFallback`（L1455）：联网搜索（博查）补充证据后**重新过门禁**；Simple 模式最多补一次（成本护栏），Agentic 按预算多次（第 6 课）。仍不足则安全降级：`confidence: 0` + 明确告知"资料不足，建议补充版本/项目/时间/场景"——**宁可不给答案，不给没证据的答案**。这是知识库场景的产品决策：错误答案的代价（误导决策、合规风险）远大于"没答案"。

### 3.5 组装与生成

证据经 ContextBuilder 四步（去重→配额→预算→首尾重排，详见[第 8 节讲义幻觉部分](../08-tuning/README.md)）注入七条军规 Prompt，流式生成、逐句引用门禁、抽取式兜底。

## 四、生产坑点（学员最易踩的 2 个）

### 坑点 1：充分性阈值——过严变慢，过松变编

- **现象 A**：几乎每个问题都触发联网补证，p99 延迟和 API 成本翻倍，用户抱怨"系统很慢"。**现象 B**：检索到弱相关片段就放行生成，回答里全是牵强引用。
- **根因**：阈值没有按观测数据校准——它是"成本/延迟"与"答案质量"的交换旋钮，不是写死的一次性配置。
- **排查三步**：统计 `retrievalReason` 的分布（多少走了补证/降级）→ 抽样人工评估放行答案质量 → 小步调整并 A/B 对比。改参数前先有基线数据。

### 坑点 2：补证循环——不足→搜→再不足→再搜

- **现象**：一个坏问题触发多轮联网搜索，token 燃烧，延迟叠加，最终仍降级——白花钱。
- **根因**：补证后再门禁的循环没有次数上限。
- **排查/预防**：本项目 Simple 链路上限 1 次；Agentic 用 `webSearchAttempted` 计数 + 预算字段（第 6 课六件套）双重防护。**任何"再试一次"的循环都必须有计数器**。

## 五、讲师口播稿（约 300 字）

> 前四节课我们把检索的每个零件都造好了：切片、向量化、BM25、混合排序。今天把它们装成一台完整的机器，并且给这台机器装上方向盘——决策层。基础检索生成链路若未配置证据门禁，可能在资料不足时仍生成答案。这一讲的链路多了一个问句："检索到的证据，够回答这个问题吗？"不够，先去网上补；补完再问一次；还不行，就老实说"资料不足，请补充信息"，置信度标零。很多同学觉得"拒答"是系统无能——恰恰相反，企业知识库场景里，一个编造的答案能误导一次决策，一次拒答只是损失一次点击。这节课我们逐段读 answer 方法七十行的主线：直答捷径、三路并发、双门禁、证据顺序的门禁语义、补证循环的护栏。读懂这条链路后，还需要通过对照评测解释门禁、预算与补证的具体代价。我们开始。

## 六、配套 Lab 与自测

- Lab（见[课程大纲第 5 节](../README.md)）：构造知识库外 query 追踪完整降级路径 → 阈值严格/宽松对比 → 画链路流程图
- 自测：[quiz.md](./quiz.md)（9 题，≥10 分 + Lab 完成即通过）
