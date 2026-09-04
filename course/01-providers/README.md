# 第 1 节讲义 · 架构全景与可插拔 Provider 体系

> 课程：《从零手撕企业级 RAG》第 1 节 · 架构全景与可插拔 Provider 体系
> 源码：[configuration.ts](../../backend/src/config/configuration.ts) · [vector-store-provider.interface.ts](../../backend/src/providers/vector-store/vector-store-provider.interface.ts) · [vector-store.provider.ts](../../backend/src/providers/vector-store/vector-store.provider.ts) · [llm-gateway.policy.ts](../../backend/src/providers/llm/llm-gateway.policy.ts)
> 全局配图：[diagrams.md](../diagrams.md)（两张 Pipeline 图）

## 一、痛点引出

三个真实场景：Milvus 想换 pgvector，发现 `MilvusClient` 的调用散落在 12 个文件里；OpenAI SDK 升级改了返回结构，全仓库回归；用 LangChain 全家桶搭得很快，直到某个需求框架不支持——发现编排权在框架手里，不在你手里。

| | 硬编码厂商 SDK | Provider 接口层 |
|---|---|---|
| 换向量库 | 全仓库搜索替换，回归全量 | 改 1 个环境变量 |
| SDK 升级 | 所有调用点排查 | 只改 1 个实现类 |
| 降级/熔断 | 各处自己写 | 接口方法统一暴露状态 |
| 被框架锁定 | — | LangChain 只做工具库，架构自己定 |

## 二、整体架构：四层分工

请求流：`modules`（业务）→ `rag`（管线）→ `providers`（接口）→ 具体实现（Milvus/Qwen/…）。`config` 层从环境变量加载全部配置。

**切换矩阵**（[configuration.ts L24/L68/L117/L148](../../backend/src/config/configuration.ts)）：

| 环境变量 | 默认 | 可选 |
|---|---|---|
| `VECTOR_STORE_PROVIDER` | milvus | pgvector（接口预留） |
| `RELATIONAL_DB_PROVIDER` | postgres | mysql |
| `LLM_PROVIDER` | qwen | deepseek |
| `EMBEDDING_PROVIDER` | qwen | openai 兼容 |

## 三、代码拆解

### 3.1 接口契约：业务视角的动词表（interface L67-125）

[`IVectorStoreProvider`](../../backend/src/providers/vector-store/vector-store-provider.interface.ts) 定义 11 个方法：`ensureCollection / insert / similaritySearch / deleteByDocId` 是写入检索，**`getIndexInfo / getRuntimeStatus` 是可观测**——`RuntimeStatus` 直接携带 `circuitState: closed | open | half_open` 熔断状态（L31-39）。

**教学引导语**：接口不是厂商 SDK 的翻译，是**业务需要的动词表**。注意 `similaritySearch(queryVector, k, userId?)`——`userId` 从第一天就在签名里，这就是第 7 课四层隔离的伏笔。对比：LangChain 的 `VectorStore` 接口没有熔断状态、没有运行时健康度——自研接口把"生产可运营"当一等公民。

### 3.2 工厂切换：一个 case 一个实现（vector-store.provider.ts L27-37）

```ts
onModuleInit() {
  const providerName = this.config.get<string>('vectorStore.provider') ?? 'milvus';
  switch (providerName) {
    case 'milvus':
      this.provider = this.milusProvider;
      break;
    default:
      throw new Error(`Unsupported vector store provider: ${providerName}`);
  }
}
```

**坦白讲**：switch 里目前只有 milvus——pgvector 是"纸面可插拔"。但看清楚这个缝隙的价值：补一个 `PgVectorStoreProvider` 类 + 一个 case，**上层 rag/modules 一行不改**。本节 Lab 就是亲手证明这件事。`default: throw` 是有意的：配置错误在**启动时**炸掉，好过运行时静默写错库。

### 3.3 最小接口 vs 有意泄漏（embedding/llm 接口）

[`IEmbeddingProvider`](../../backend/src/providers/embedding/embedding-provider.interface.ts) 只有 2 个方法：`embedQuery / embedDocuments`。而 [`ILLMProvider`](../../backend/src/providers/llm/llm-provider.interface.ts) 除 `invoke` 外还有 `getModel(): BaseChatModel`——**返回 LangChain 类型，这是有意的泄漏**：业务需要 `withStructuredOutput / stream`，重新抽象一遍成本大于收益。收益：结构化输出零成本获得；代价：换成非 LangChain SDK 时调用方要动。工程决策不是洁癖，是明码标价的权衡。

### 3.4 LLM 网关策略：比"可插拔"更进一步（llm-gateway.policy.ts L22-45）

[`LlmGatewayPolicy`](../../backend/src/providers/llm/llm-gateway.policy.ts) 按任务路由：`fast / reasoning / structured / embedding` 四类任务，各自独立的 `timeoutMs / maxTokens / maxCostUsd` 预算（`LLM_FAST_*`、`LLM_REASONING_*` 环境变量组），主备自动互换（qwen↔deepseek）。网关不只管"换厂商"，还管**路由、预算、降级**——这是云厂商 SDK 永远不会替你做的事。

## 四、生产坑点（学员最易踩的 2 个）

### 坑点 1：环境变量打错 → 服务启动即炸

- **现象**：`VECTOR_STORE_PROVIDER=milvuss`（多打一个 s），服务起不来，新人 panic。
- **根因**：工厂 `default: throw`（[L35](../../backend/src/providers/vector-store/vector-store.provider.ts)）。这是**正确设计**：fail-fast 在启动期，优于运行期静默回退导致数据写进错的地方。
- **排查三步**：看启动日志第一行错误 → 核对 `.env` 与切换矩阵表 → `git diff .env.example` 找拼写差异。

### 坑点 2：接口按想象设计 → 双向返工

- **现象**：先写了 `similaritySearch(query, k)`（没有 userId），多租户需求一来，接口签名、所有实现、所有调用点全改。
- **根因**：接口设计没有先枚举**调用方场景**（单租户/多租户/图片向量/按文档删除）。
- **预防**：写接口前回答三个问题——谁调用？带什么上下文（userId？scope？）？怎么观测它挂没挂？本项目的 `userId?` 可选参数 + `getRuntimeStatus` 就是这份清单的答案。

## 五、讲师口播稿（约 300 字）

> 大家好，欢迎来到这门课的第一讲。今天不讲检索、不讲大模型，讲一个更值钱的东西：架构的"骨架"——Provider 体系。为什么你的项目换一个向量库要改十几个文件，而这个项目只改一个环境变量？区别就在一层薄薄的接口。很多同学上手就 import 厂商 SDK，写得飞快，三个月后想换库、想降级、想加熔断，发现代码和厂商焊死了。还有同学直接上 LangChain 全家桶，框架替你做了所有决定——直到有一天你需要一个框架没有的功能，你才发现编排权不在自己手里。这一讲我们打开这个项目的 providers 目录，看接口怎么定、工厂怎么切、什么该抽象、什么可以有意地"泄漏"。记住这门课的红线：LangChain 是工具箱，不是架构师。架构的决定权，从第一行接口定义开始，就要握在自己手里。我们开始。

## 六、配套 Lab 与自测

- Lab（见[课程大纲第 1 节](../README.md)）：实现 `FakeVectorStoreProvider`（内存数组实现 11 个方法），完成实现和依赖注入注册后，通过环境配置切换，验证上层检索代码零改动
- 自测：[quiz.md](./quiz.md)（9 题，≥10 分 + Lab 完成即通过）
