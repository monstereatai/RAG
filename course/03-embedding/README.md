# 第 3 节讲义 · Embedding 与向量库工程

> 课程：《从零手撕企业级 RAG》第 3 节 · Embedding 与向量库工程
> 源码：[qwen-embedding.provider.ts](../../backend/src/providers/embedding/qwen-embedding.provider.ts) · [milvus.vector-store.ts](../../backend/src/providers/vector-store/milvus.vector-store.ts) · [cosine.util.ts](../../backend/src/rag/karpathy/cosine.util.ts)
> 前置：第 1 节 Provider 体系（本节是它的第一个具体实现）

## 一、痛点引出

"向量能存能查"离工程可用差四件事：**维度对齐**（模型一换全库作废）、**批量与超时**（逐条调用、无超时的入库在云端一抖就全挂）、**schema 演进**（字段加错了怎么迁）、**租户过滤**（漏一个过滤就是数据泄露）。本节全部用真实代码回答。

## 二、数据流

入库：chunks → `embedDocuments`（批量）→ `insert`（带 user_id）→ Milvus。查询：query → `embedQuery` → `similaritySearch(vector, k, userId)`（expr 过滤）。两层容错：Provider 内超时快速失败，外层熔断 + BM25 降级（第 8 节展开）。

## 三、代码拆解

### 3.1 Embedding Provider：兼容复用 + 双超时（qwen-embedding.provider.ts）

**教学引导语**：自研不等于重造轮子。通义千问提供 OpenAI 兼容接口，于是直接用 `OpenAIEmbeddings` 指向 DashScope 的 baseURL（L29-34）——**接口兼容时借 SDK，接口不兼容时才自己写**。真正自研的是工程包装：

- `embedQuery`：3 秒超时（L40-46），交互式查询延迟敏感
- `embedDocuments`：每批 10 条、每批 5 秒超时（L56-68）——批量吞吐场景
- 超时用 `Promise.race` 实现；失败 `warn + throw` **上抛**（不吞错）——降级决策留给上层，Provider 只负责如实报告

注意一个细节：批量中途失败时，已成功的向量也随异常丢弃——**部分成功即整体失败，幂等重试由上层负责**。这是简单但明确的契约。

### 3.2 Milvus schema：字段、度量、租户过滤（milvus.vector-store.ts）

- schema 含 `user_id` 字段（[L219](../../backend/src/providers/vector-store/milvus.vector-store.ts)），度量 `MetricType.COSINE`（L230）
- 检索过滤：`expr: userId ? \`user_id == "${userId}"\` : undefined`（[L273](../../backend/src/providers/vector-store/milvus.vector-store.ts)）——**这一行就是 Milvus 层的租户隔离**
- 写入后 `flushSync`（L252）：调用刷盘后仍需验证集合加载、索引和一致性设置下的实际可检索性，不能把刷盘单独当成端到端立即可查保证

### 3.3 schema 演进：检测到旧 schema 直接重建（L159-184）

启动时检查 collection 是否缺 `user_id` 字段，缺则打日志 `Collection schema outdated... Re-creating` 并 **drop + 重建**。

**实现边界**：自动删除集合重建有数据风险，不能作为默认生产迁移策略。实验前核对代码与环境，只使用明确授权的可重建测试数据；生产需要规划新集合构建、验证与切换。关系库有原文不自动证明全部索引、权限与版本都可恢复。

### 3.4 手写 cosine：与 Milvus 互为校验（cosine.util.ts L5-19）

```ts
if (a.length !== b.length) {
  throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
}
const denom = Math.sqrt(normA) * Math.sqrt(normB);
return denom === 0 ? 0 : dot / denom;
```

19 行。两个防御：维度不等直接 throw（把错误前置到调用方）；零向量返回 0 而不是 NaN。它在 debug 接口里对拍 Milvus 的 COSINE 结果——**自研基准是校验第三方行为的锚点**。

## 四、生产坑点（学员最易踩的 2 个）

### 坑点 1：维度漂移——换模型后 insert 全挂

- **现象**：换了 Embedding 模型（或 dimension 配置），新文档入库报错、`cosineSimilarity` 抛 `dimension mismatch`。
- **根因**：collection 的 vector 字段维度在建表时固定；模型输出维度变了，新旧向量不在一个空间。
- **排查三步**：`getIndexInfo().dimension` 对比模型实际输出维度 → 确认 `.env` 的 dimension 配置 → 维度变更必须重建集合并**全量重灌**（新旧向量混存比报错更危险——检索结果静默错乱）。

### 坑点 2：schema 重建把数据"删没了"

- **现象**：升级代码后 Milvus 数据消失，检索命中数为 0，但服务一切正常。
- **根因**：§3.3 的 drop + recreate 策略——旧 collection 缺 `user_id` 触发重建，重建后是空集合。
- **排查三步**：查启动日志有没有 `Re-creating` → 确认 PG 里文档还在（源头数据）→ 重跑入库流程。预防：升级前看 changelog 是否涉及 schema 字段。

## 五、讲师口播稿（约 300 字）

> 这一讲我们把第一课画的骨架填上第一块肉：Embedding 和向量库。很多同学觉得这章没技术含量——不就是调个 API 存个数组吗？我给你三个数字：3 秒、5 秒、1024。3 秒是单条查询向量化的超时，5 秒是每批 10 条文档向量化的超时，1024 是向量维度——这三个数字任何一个配错，你的系统要么慢得没人用，要么在云端抖动时整条入库链路挂掉。然后是 Milvus：schema 里那个 user_id 字段，看起来人畜无害，它其实是多租户隔离在向量层的全部防线——检索时少了那一行 expr 过滤，A 用户就能搜到 B 公司的合同。最后我会给你看一段只有 19 行的手写余弦相似度，它存在的意义不是替代 Milvus，而是当第三方行为可疑时，你手里有一个自己完全理解的基准。学完这节，"能存能查"和"工程可用"的区别，你会刻在脑子里。

## 六、配套 Lab 与自测

- Lab（见[课程大纲第 3 节](../README.md)）：设计带 userId 的 schema 写入 100 条 → 验证隔离 → 调超时观察快速失败
- 自测：[quiz.md](./quiz.md)（9 题，≥10 分 + Lab 完成即通过）
