# 第 4 节讲义 · 自研 BM25 与混合检索（旗舰章）

> 课程：《从零手撕企业级 RAG》第 4 节 · 检索核心 I
> 源码：[bm25.util.ts](../../backend/src/rag/karpathy/bm25.util.ts)（128 行，本讲义主角） · [bm25-store.ts](../../backend/src/rag/karpathy/bm25-store.ts) · [karpathy-rag.service.ts](../../backend/src/rag/karpathy/karpathy-rag.service.ts)（`retrieveDetailed` L525 / `retrieveBm25Only` L704）
> 前置：第 3 节向量检索——本节是它的另一半

## 一、痛点引出

向量检索有两个先天盲区：**精确词不敏感**（"订单 A-1024"和"订单 A-1025"在向量空间几乎重合，但对业务是天壤之别）和**单点依赖**（Milvus 超时/宕机，全链路瘫痪）。主流解法是 BM25 + 向量混合检索——问题是：接 Elasticsearch 要多养一个重型服务，用现成库又学不到东西。本项目的选择：**128 行手写 BM25**，既是混合检索的关键词一路，又是 Milvus 故障时的本地兜底——云端全挂，检索不断。

## 二、数据流

```
入库：chunks → tokenize（jieba）→ BM25 内存索引（词频表/文档频率表）→ bm25-index.json 持久化
查询：query → tokenize → 逐文档打分（IDF × TF 归一化）→ 排序 topK ─┐
                                                                ├─ RRF 融合 → Rerank
Milvus 向量召回 topK ────────────────────────────────────────────┘
```

## 三、代码拆解

### 3.1 BM25 打分公式（bm25.util.ts L90-127）

```ts
const idf = Math.log((this.docs.length - df + 0.5) / (df + 0.5) + 1);  // L108
const tfNorm =
  (tf * (this.k1 + 1)) /
  (tf + this.k1 * (1 - this.b + this.b * (docLen / (this.avgDocLen || 1)))); // L109-112
score += idf * tfNorm;
```

三个设计点：

- **k1 = 1.5, b = 0.75**（L36-37）：k1 控制 TF 饱和速度（词出现 10 次不该得 10 倍分），b 控制文档长度惩罚强度（b=0 不惩罚长文档，b=1 完全归一化）。0.75 是 Lucene/Elasticsearch 的默认值，经过工业验证。
- **IDF 里的 `+1`**（L108）：未平滑的 `log((N-df+0.5)/(df+0.5))` 在 df>N/2 时为负；本实现将比值加 1 后取对数。`log(N/df)` 是另一公式，在有效 df 范围内不为负。
- **`avgDocLen || 1`**（L112）：空索引首次查询时 avgDocLen=0，防除零。

### 3.2 中文分词：jieba 懒加载 + 静默降级（L21-66）

```ts
let _jieba: Jieba | null = null;
const getJieba = (): Jieba | null => {
  if (_jieba === null) {
    try { _jieba = new Jieba(); } catch { _jieba = null; }
  }
  return _jieba;
};
```

单例懒加载（首次用时才初始化，避免拖慢启动）；jieba 是原生依赖，加载失败**不炸**，降级为纯 JS 按标点正则切分（L62-65）。tokenize 统一小写 + 去空串。这个"优雅降级"是本节坑点 1 的伏笔——降级本身也是一种风险。

### 3.3 诚实的代码审查：tf 恒为 1（L58）

```ts
return [...new Set(tokens)];  // 去重保持顺序
```

**教学引导语**：这行代码让 `docTokens` 只存唯一 token——于是 `search` 里每个词的 `tf` 恒等于 1（L99-103 的 termFreq 永远数出 1），**TF 饱和公式被整体短路**，k1 实际只影响文档长度归一化的权重。这是当前实现的简化：不存重复词项，词频和文档长度都按去重后统计；收益和质量损失需要测量，不能预设索引体积减半，也不能默认短切片就适用。**读源码不是为了仰望，是为了能指出它做了什么取舍**——这一条比公式本身更值得面试讲。

### 3.4 持久化：bm25-store.ts 不是索引，是快照

`Bm25Store` 只做一件事：把 entries 序列化到 `workspace/bm25-index.json`（v1 版本号校验，L61 不匹配返回 null 触发重建）。注意 `Bm25PersistedEntry`（L9-36）携带了 `userId / docVersion / region / roleScope` 等丰富元数据——**BM25 层的租户与作用域过滤就靠它们**（第 7 课四层隔离的 BM25 一层）。`removeByDocId`（L83-90）过滤后立即落盘，保证删文档后重启不复活。

### 3.5 混合检索中的位置（karpathy-rag.service.ts）

`retrieveDetailed`（L525）：BM25/ES 召回与向量召回合并候选 → RRF 融合（只看排名不看分数——各路分数标度和分布不同；一般余弦范围为 [-1,1]，不是天然概率）→ `applyRerank` 精排。`retrieveBm25Only`（L704）：Agentic 子问题检索失败时的降级入口（第 6 课）；Milvus 超时/熔断时 simple 链路同样落回 BM25——**兜底通道的兜底通道**。

## 四、生产坑点（学员最易踩的 2 个）

### 坑点 1：jieba 加载失败 → 中文召回静默崩塌

- **现象**：服务"正常"运行，BM25 命中率骤降至个位数，无任何报错。
- **根因**：原生依赖（node-gyp 编译失败/平台不匹配）导致降级到纯 JS 分词——中文整句被当成一个 token，查询词几乎不可能与"整句 token"精确匹配。
- **排查三步**：打日志看 `getJieba()` 是否返回 null → 用固定中文句子单测 tokenize 输出（是否成句）→ `npm rebuild @node-rs/jieba`。预防：启动自检 jieba 可用性，降级发生必须打点报警，而不是静默吞掉。

### 坑点 2：去重 token 让"重复关键词"失去权重

- **现象**：文档 A 提到"退款"12 次、文档 B 提到 1 次，业务直觉 A 更相关，但 BM25 给出接近的分数。
- **根因**：§3.3 的 `new Set(tokens)` 使 tf 恒为 1。
- **处理**：是否可接受由对照评测决定。若恢复词频，需一起核对文档长度、平均长度、查询重复词处理和既有测试，不能只删一行后宣称算法已正确。**知道取舍点在哪，比"修掉它"更重要**。

## 五、讲师口播稿（约 300 字）

> 今天是全课程最硬核的一讲：128 行手写 BM25。为什么值得？三个理由。第一，它是向量检索的另一半：用户搜"订单 A-1024"，向量觉得这和 A-1025 差不多，BM25 一票就能区分——精确词是关键词检索的主场。第二，它是你的救命通道：Milvus 挂了、云上 Embedding 挂了，BM25 在进程内存里，照常检索——云端全断、本地不断，这一句话就是架构价值。第三，也是我这节课最想教的：我们逐行读这 128 行，你会发现教科书公式和工程代码之间的距离——IDF 里为什么要加一？去重 token 怎么把 TF 饱和整个短路掉？这些细节没有一本书会告诉你，但每一行都在影响你的召回质量。读完这节，你在面试里聊 BM25，聊的就不是背公式，而是一个你真正理解、甚至挑得出毛病的实现。我们开始。

## 六、配套 Lab 与自测

- Lab 代码实战：[lab/](./lab/)（填空版：3 处 TODO，测试 3 为手算对拍——期望分数人工计算，非同构验证）
- Lab 操作练习（见[课程大纲第 4 节](../README.md)）：三路召回质量对比 → 关停 Milvus 验证 BM25 降级接管
- 自测：[quiz.md](./quiz.md)（9 题，≥10 分 + Lab 完成即通过）
