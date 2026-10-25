# 查询规划与统一检索改造方案

> 状态：代码改造与 QA Ops 三模式真实验收已完成
> 更新时间：2026-10-17
> 范围：只改问答阶段的查询规划、检索融合、附件检索和三种模式复用关系；保留现有入库、数据库、索引和知识治理能力。

## 当前实施与验证状态

| 内容 | 当前状态 | 依据／尚缺证据 |
| --- | --- | --- |
| 精简 QueryPlan、确定性 RetrievalPolicy、旧 QueryIntent 运行记录适配 | 已实施并定向验证 | `backend/src/rag/planning/`、旧格式适配用例、ChatService 定向测试 |
| Simple／Auto／Agentic 共用 `retrieveByPlan()`，多查询融合、权限／生命周期过滤和统一重排 | 已实施并定向验证 | Karpathy RAG 与 Agentic 定向测试；Chat modes 集成测试 7/7 |
| 移除检索档位语义正则；图片证据纳入检索候选 | 已实施并定向验证 | `context-builder.ts`、Karpathy RAG 定向测试 |
| 会话附件 BM25 + 向量召回、用户／会话边界及 Redis v1 兼容 | 已实施并定向验证 | 附件定向测试覆盖无关附件、低相似度候选与旧格式兼容 |
| 查询规划、附件命中指标及运行计划记录 | 已实施并通过真实运行核对 | Run Center 中三种模式均记录 QueryPlan、执行计划、检索结果和引用 |
| 构建与代码级验证 | 已通过 | Backend build、Admin build；Query Routing 评测 13/13 |
| Backend 全量 Jest | 已通过 | 105 个测试套件、542 个测试通过 |
| 全量 lint | 不作为本轮完成门槛 | 按本轮要求聚焦功能验证、构建、测试和真实页面流程 |
| QA Ops 页面真实用户验收 | 已通过 | 2026-10-17 同一会话附件、同一问题依次执行 Simple、Auto、Agentic；三种模式均回答正确并引用原附件。Run Center 核对了 QueryPlan、local_only/scopeRestricted 执行策略、两个子问题、附件 chunk 命中和检索充分状态。 |

代码级验证和 QA Ops 端到端验收均已完成。QA Ops 的运行详情展示计划、证据包和最终引用；每种检索后端的候选计数不在此页面展示，由对应的检索与权限测试覆盖。

## 1. 结论

现有 BM25／Elasticsearch、Milvus／pgvector、描述索引、RRF、DashScope Rerank、权限过滤、版本过滤、GraphRAG、引用校验和拒答门禁继续保留。

本轮主要处理四个问题：

1. `QueryIntentRouter` 一次输出过多字段，模型决策和后端规则混在一起。
2. `detectRetrievalProfile()` 依赖中文正则判断比较、流程、生成等语义。
3. Simple、Auto、Agentic 使用查询改写和子问题的方式不一致。
4. 会话附件仍以文件名、图片关键词和字符串匹配为主，没有进入统一的混合检索管线。

目标链路：

```text
用户问题 + 最近对话
        ↓
一次结构化 QueryPlan
        ↓
后端 Policy 校验权限、来源和执行上限
        ↓
原问题 / 追问补全 / 子问题并行召回
        ↓
BM25/ES + Vector + 描述索引 + 可选 Graph/附件
        ↓
分路 RRF → 跨查询加权 RRF → ACL/版本过滤
        ↓
按原问题统一 Rerank 一次
        ↓
去重、文档占比、上下文预算、引用
        ↓
Simple 或 Agentic 生成答案
```

## 2. 参考项目与采用结论

Star 为 2026-10-17 查询时的近似值，只用来筛选成熟度，不作为技术决策依据。

| 项目 | 背景与规模 | 参考内容 | 本项目采用方式 |
| --- | --- | --- | --- |
| [LangChain](https://github.com/langchain-ai/langchain) | 成熟 AI 工程团队，约 148k Star | Router 独立负责分类、拆解和选择处理器；多个处理器可并行执行后再综合 | 保留一次结构化语义规划，但缩小输出；ChatService 只编排 |
| [Dify](https://github.com/langgenius/dify) | 成熟产品团队，约 157k Star | 问题分类、知识检索和答案生成是独立工作流节点 | 将 QueryPlan、Policy、Retrieval、Context 分开，不在一个函数中连续追加规则 |
| [RAGFlow](https://github.com/infiniflow/ragflow) | 成熟 RAG 产品团队，约 92k Star | 召回、候选池、融合、重排和 TopK 是明确流水线 | 检索参数由 QueryPlan 和知识库配置决定，不靠自然语言正则 |
| [LlamaIndex](https://github.com/run-llama/llama_index) | 成熟数据框架团队，约 52k Star | 追问补全是独立能力，将上下文问题转成可独立检索的问题 | 只有追问才增加 `standaloneQuery`；原问题始终检索 |
| [Microsoft GraphRAG](https://github.com/microsoft/graphrag) | Microsoft，约 36k Star | Local、Global、DRIFT 等查询模式边界明确 | GraphRAG 作为显式检索方法，不使用隐藏关键词触发，不替代普通 Hybrid RAG |
| [腾讯 WeKnora](https://github.com/Tencent/WeKnora) | 腾讯，约 34k Star | 权限优先、多知识库并发、查询向量复用、加权 RRF、Rerank、MMR、引用扩展 | 作为统一检索主链的首要参考 |
| [Haystack](https://github.com/deepset-ai/haystack) | 成熟 AI 工程团队，约 26k Star | QueryExpander 保留原问题，失败时回退原问题；Router 是独立组件 | 改写只增加检索入口，失败不能阻断回答 |

直接参考源码和设计文档：

- [LangChain Router](https://github.com/langchain-ai/docs/blob/main/src/oss/langchain/multi-agent/router.mdx)
- [LlamaIndex Condense Question](https://github.com/run-llama/llama_index/blob/main/llama-index-core/llama_index/core/chat_engine/condense_question.py)
- [腾讯 WeKnora RAG Pipeline](https://github.com/Tencent/WeKnora/blob/main/website-docs/02-architecture/04-rag-pipeline.md)
- [腾讯 WeKnora Retrieval Engines](https://github.com/Tencent/WeKnora/blob/main/website-docs/03-features/05-retrieval-engines.md)
- [Microsoft GraphRAG Query Overview](https://github.com/microsoft/graphrag/blob/main/docs/query/overview.md)
- [Haystack QueryExpander](https://github.com/deepset-ai/haystack/blob/main/haystack/components/query/query_expander.py)

### 不照搬的内容

- 不复制 Dify 的整套通用工作流平台；当前只收敛问答检索链路。
- 不复制 RAGFlow 的完整文档平台和解析基础设施；现有入库链继续使用。
- 不把 GraphRAG 当默认检索；只有关系、多跳和依赖问题才启用。
- 不为普通单点查询固定生成多条改写，避免额外模型和向量成本。
- 不让 LLM 决定用户能访问哪些知识库、文档或租户数据。

## 3. 改造前问题与保留能力

### 3.1 已有能力可以保留

| 能力 | 当前入口 | 处理意见 |
| --- | --- | --- |
| BM25／Elasticsearch + Vector | `backend/src/rag/karpathy/karpathy-rag.service.ts` | 保留 |
| RRF 融合 | `fuseByRrf()` | 保留并增加跨查询加权融合 |
| DashScope Rerank | `applyRerank()` | 保留，所有查询候选合并后只调用一次 |
| 权限和租户范围 | `DocumentPermissionService`、`RetrieveOptions.scope` | 保留并继续在召回和融合后双重过滤 |
| 描述命中后回原文 | `RetrievalDescriptionService` | 保留 |
| 上下文去重、文档占比和字符预算 | `ContextBuilder` | 保留 |
| GraphRAG | 改造前由旧意图字段控制 | 现由 `QueryPlan.needsGraph` 和后端执行计划显式控制 |
| 引用和证据门禁 | Karpathy／Agentic 最终阶段 | 保留 |

### 3.2 改造前问题（对应代码改造已实施）

#### QueryIntent 输出过重

`backend/src/rag/prompts/query-intent-router.ts` 同时输出：

- `intent`、`queryType`
- `contextMode`、`historyPolicy`
- `action`、`sourcePolicy`
- `multiIntent`、`subQueries`
- `needsSynthesis`、`requiresGraph`
- `targetKbs`、`filters`、`entities`
- `standaloneQuery`、`rewriteQueries`
- `confidence`、`ambiguity`

随后 `normalizeDecision()` 再用多组条件修改模型结果。语义理解、权限策略、来源策略和兼容逻辑因此耦合在一个类里。

#### 检索档位依赖正则

`backend/src/rag/karpathy/context-builder.ts` 的 `detectRetrievalProfile()` 通过“比较、生成、流程”等关键词选择检索深度。表达方式变化后容易误判，也可能把同一个词在不同语境中的含义混在一起。

#### 三种模式使用查询计划不一致

- Simple 使用原问题，并在高置信追问时增加 `standaloneQuery`。
- Agentic 额外使用 `rewriteQueries` 和 `subQueries`。
- Auto 根据路由进入不同实现，因此同一问题可能因为模式不同得到不同的召回集合。

#### 附件仍是独立的词法检索

`backend/src/modules/agui/conversation-attachment.service.ts` 当前使用文件名包含、图片关键词正则、字词命中打分。它适合显式指定文件和兜底，但不能稳定覆盖同义表达和长文语义查询。

## 4. 目标职责划分

### 4.1 QueryPlanner：只做语义理解

保持一次 LLM 调用，返回精简结构：

```ts
export interface QueryPlan {
  action: 'direct' | 'retrieve' | 'execute';
  domain: 'internal' | 'public' | 'realtime';
  contextMode:
    | 'independent'
    | 'follow_up'
    | 'setting'
    | 'verification';
  standaloneQuery: string;
  subQueries: string[];
  taskType: 'lookup' | 'procedure' | 'comparison' | 'synthesis';
  needsGraph: boolean;
  filters: {
    department?: string;
    project?: string;
    timeRange?: string;
    documentType?: string;
  };
  clarificationQuestion?: string;
}
```

约束：

- `domain` 只表示问题语义属于内部、公共还是实时领域，不代表访问授权。
- 不返回 `targetKbs`。实际知识库和文档范围来自请求 scope、用户权限和页面选择。
- 不返回通用 `rewriteQueries`。普通查询只使用原问题。
- 追问才生成 `standaloneQuery`。
- 多意图、比较或综合问题才生成 `subQueries`，最多 3 条。
- 模型调用失败或 JSON 校验失败时，使用原问题和保守本地检索计划。

### 4.2 RetrievalPolicy：执行确定性规则

后端策略根据 QueryPlan、请求上下文和系统配置生成实际执行计划：

```ts
export interface RetrievalExecutionPlan {
  sourcePolicy: 'direct_answer' | 'local_only' | 'web_allowed';
  queries: Array<{
    text: string;
    kind: 'original' | 'standalone' | 'sub_query';
    weight: number;
  }>;
  profile: RetrievalProfile;
  useGraph: boolean;
  scope: RetrievalScope;
}
```

规则：

1. 内部、项目、上传文件问题强制 `local_only`。
2. 用户 scope、tenantId、ACL、文档版本由后端注入，模型不可扩大。
3. 原问题永远加入，权重 `1.0`。
4. 高置信追问且补全结果与原问题不同，加入补全问题，建议权重 `0.85`。
5. 多问题加入最多 3 条子问题，建议权重 `0.7`。
6. `taskType` 映射到现有 `PROFILES`；知识库配置只覆盖数字参数。
7. Graph 只有 `needsGraph=true` 且服务可用时执行；失败退回普通混合检索。

### 4.3 UnifiedRetrieval：统一候选管线

先在现有 `KarpathyRagService` 增加统一入口，不立即重写四千多行服务：

```ts
retrieveByPlan(
  plan: RetrievalExecutionPlan,
  options: RetrieveOptions,
  userId?: string,
): Promise<DetailedRetrievalResult>
```

执行顺序：

1. 按权限范围准备允许访问的文档集合。
2. 每条 query 并行执行 BM25／ES、向量和描述索引召回。
3. 每条 query 内部使用现有 RRF 融合关键词和向量候选。
4. 多条 query 的候选使用加权 RRF 再融合，避免直接比较不同查询的原始分数。
5. 再次执行 ACL、tenant、scope、生命周期和版本过滤。
6. 合并 Graph、图片和附件候选。
7. 使用用户原问题统一 Rerank 一次。
8. 执行邻居扩展、去重、单文档上限、上下文预算和引用格式化。

普通查询只有一条 query，不增加额外 embedding 和检索成本。

### 4.4 ContextBuilder：只组装上下文

移除 `detectRetrievalProfile(query)` 的语义正则。`ContextBuilder` 只接收已经确定的 `RetrievalProfile`，继续负责：

- chunk 去重
- 单文档占比
- 相关性和多样性
- 字符预算
- 长上下文排列
- 引用片段格式

现有 lexical MMR 暂时保留。先通过评测确认多样性问题，再决定是否改为 embedding MMR，避免同时扩大改造范围。

### 4.5 会话附件：进入相同候选管线

附件仍保持“只属于当前用户和当前会话，TTL 到期自动失效”。

上传阶段：

1. 复用现有 PDF、DOCX、MD、OCR 和图片理解解析。
2. 按标题、页码和段落切片。
3. 上传时批量生成 chunk embedding。
4. 文本、位置、文件名和编码后的 Float32 向量存入 Redis，与附件使用同一 TTL。
5. 不修改 PostgreSQL schema，不把会话附件写入长期知识库。

查询阶段：

1. 对附件 chunk 执行本地 BM25 和向量余弦召回。
2. 文件名匹配只处理用户明确指定的附件。
3. 附件候选转换成统一 `RetrievedChunk`。
4. 与知识库候选一起加权融合、Rerank、去重和生成引用。

兼容：旧的 Redis v1 附件在 TTL 内继续走当前词法检索；新上传附件使用带向量的 v2 数据。旧数据自然过期，不执行数据迁移。

## 5. 三种模式的最终边界

| 模式 | 查询规划 | 检索实现 | 生成方式 |
| --- | --- | --- | --- |
| Simple | 使用统一 QueryPlan | 固定执行 `retrieveByPlan()` | 一次生成，失败按现有规则降级 |
| Auto | 使用统一 QueryPlan | Fast Path 结果够用时走 Simple；升级时把首轮证据交给 Agentic 复用 | 根据 action、taskType 和证据充分性选择 |
| Agentic | 使用同一 QueryPlan，可消费 subQueries | 显式 Agentic 进入 `retrieveByPlan()`；Auto 升级复用 Fast Path 结果 | LangGraph 负责多步任务、工具和反思 |

三种模式可以有不同执行深度，但不能拥有三套底层权限、融合和排序算法。

## 6. 文件改造清单

| 文件 | 改动 |
| --- | --- |
| `backend/src/rag/planning/query-plan.ts`、`query-planner.service.ts`、`retrieval-policy.service.ts` | 定义 QueryPlan、模型语义规划和后端确定性执行策略；旧 router 文件只保留兼容导出 |
| `backend/src/rag/prompts/few-shot.examples.ts` | few-shot 改为精简 QueryPlan 示例 |
| `backend/src/modules/chat/chat.service.ts` | 生成一次 QueryPlan，交给 Policy；删除对旧字段的散落判断 |
| `backend/src/rag/karpathy/context-builder.ts` | 删除语义正则；只接收明确 profile |
| `backend/src/rag/karpathy/karpathy-rag.service.ts` | 增加 `retrieveByPlan()`；并行执行查询集合；跨查询加权 RRF；统一 Rerank |
| `backend/src/rag/agentic/agentic-rag.service.ts` | 移除独立消费 `rewriteQueries` 的路径；知识检索统一调用 planned retrieval；保留旧 checkpoint 节点 ID 与 SSE 事件名兼容 |
| `backend/src/modules/agui/conversation-attachment.service.ts` | 新附件上传生成向量；BM25 + 向量召回；输出统一候选 |
| `backend/src/rag/karpathy/karpathy-rag.module.ts` | 注册新增 Planner／Policy 服务 |

建议新增：

```text
backend/src/rag/planning/
├── query-plan.ts
├── query-planner.service.ts
└── retrieval-policy.service.ts
```

第一轮不要直接拆散 `KarpathyRagService`。功能收敛并验证后，再按候选召回、融合排序、上下文组装拆文件，降低同时重构和改行为的风险。

## 7. 实施顺序与当前状态

以下阶段的主体代码已实施并通过验证；阶段顺序保留作为变更记录和验收索引。

### 第一阶段：统一计划，不改变底层检索（代码已实施，定向验证通过）

1. 新增 QueryPlan schema 和失败兜底。
2. `ChatService` 每次请求只调用一次 QueryPlanner。
3. RetrievalPolicy 将 QueryPlan 转成现有 `RetrieveOptions`。
4. Simple、Auto、Agentic 保持现有输出，只替换路由数据来源。

验证重点：公共问题、内部问题、追问、事实核验、实时问题和执行任务的路由不能退化。

### 第二阶段：统一多查询检索（代码已实施，定向验证通过）

1. 新增 `retrieveByPlan()`。
2. 原问题、追问补全和子问题并行召回。
3. 增加跨查询加权 RRF。
4. 所有候选合并后只执行一次 Rerank。
5. Simple、Auto、Agentic 全部切换到统一入口。

验证重点：三种模式对同一问题的基础候选、权限过滤和引用来源一致。

### 第三阶段：移除正则语义判断（代码已实施，定向验证通过）

1. `taskType` 映射 RetrievalProfile。
2. 删除 `detectRetrievalProfile()` 及其调用点。
3. 图片说明作为普通向量证据参与召回；显式图片过滤由 QueryPlan／请求参数控制。
4. 保留安全、权限、格式和确定性校验规则。

验证重点：比较、流程、方案生成、单点查询的候选深度和上下文预算符合 profile。

### 第四阶段：附件混合检索（代码已实施，定向验证通过）

1. 新附件切片时生成向量并存入 Redis TTL 数据。
2. 查询附件时执行 BM25 + Vector。
3. 附件候选接入统一融合、Rerank 和引用。
4. 保留 v1 词法检索兼容直到旧附件过期。

验证重点：不提文件名的同义问题也能命中附件；跨用户和跨会话不能访问。

### 第五阶段：兼容收敛（兼容实现与回归验证完成）

- 旧 QueryIntent 和 checkpoint 数据可转换到新 QueryPlan。
- 活跃检索路径不再消费旧 `rewriteQueries` 或语义检索正则。
- Redis v1 附件读取保留到旧数据 TTL 自然过期，不执行数据库或 Redis 数据迁移。
- 旧类型导出、checkpoint 节点 ID 和 SSE 事件名继续保留，避免破坏已经落盘的运行状态。

## 8. 验收清单

至少覆盖以下问题类型：

| 场景 | 预期 |
| --- | --- |
| 普通内部事实 | 原问题检索一次，必须返回内部引用 |
| “刚才那个项目负责人是谁” | 原问题和补全问题都检索，按原问题重排 |
| “比较 A 和 B，并给出上线步骤” | 原问题 + 子问题并行，合并后统一重排 |
| 模型规划超时或 JSON 错误 | 原问题走保守本地检索，问答不中断 |
| Graph 服务不可用 | 普通 Hybrid RAG 继续回答 |
| 用户明确指定 PDF | 只检索指定附件范围 |
| 用户未说文件名但语义相关 | 附件向量召回能够命中 |
| 访问无权文档或其他会话附件 | 候选阶段和融合后都被过滤 |
| 文档旧版本和过期资料 | 不进入最终上下文 |
| Simple／Auto／Agentic | 基础召回与引用规则一致 |

执行项目规定的验证：

```bash
cd backend && npm run build
cd backend && npm run lint
cd backend && npm test -- --runInBand
```

检索改动完成后，从 QA Ops 模拟真实用户，在 Simple、Auto、Agentic 各执行一次完整问题，核对：

- QueryPlan
- 实际查询集合
- BM25／Vector／Graph／附件候选
- ACL 和版本过滤数量
- RRF 与 Rerank 顺序
- 最终引用和拒答状态

### 2026-10-17 QA Ops 实测结果

同一会话附件 `rag-queryplan-qa.md`，同一问题在 Simple、Auto、Agentic 各运行一次。负责人林晓、预算 728 万元、交付日期 2027 年 3 月 18 日、风险等级中等，三次答案均与附件一致，并引用该附件。Run Center 记录显示：

- Simple：`simple / simple`，检索充分，1 个引用；附件证据包命中同一附件 chunk。
- Auto：`auto / simple`，检索充分，1 个引用；Fast Path 直接完成，没有不必要地升级到 Agentic。
- Agentic：`agentic / agentic`，检索充分，1 个引用；1 次重试后引用门禁通过。
- 三条运行的 QueryPlan 均保留原问题和两个子问题；执行策略为 `local_only`，并标记 `scopeRestricted: true`；Graph 和联网检索未启用。
- 三种模式的最终证据均来自会话附件；引用文档名与附件文件名一致。

对应 Run ID：Simple `d73774b3-2ec4-4ea6-a9a5-3e17e4132d66`；Auto `09d44d32-352a-4f23-816e-0c6450a0601d`；Agentic `a277625a-5a99-4db0-ab61-d866e1fc8c52`。

## 9. 成本与风险控制

### 成本

- 普通查询只执行原问题，不增加 LLM 或 embedding 次数。
- 追问最多增加 1 条补全查询。
- 多问题最多增加 3 条子查询。
- 所有查询候选合并后只 Rerank 一次。
- Graph、Web 和 Agentic 只按计划启用。
- 附件 embedding 在上传时生成一次，后续查询复用。

### 风险

| 风险 | 控制方式 |
| --- | --- |
| QueryPlan 判断错误 | 原问题始终保留；解析失败走保守本地检索 |
| 子问题扩大原意 | 限制数量、保留实体和约束、最终按原问题重排 |
| 模型扩大权限 | scope 和 ACL 完全由后端注入 |
| 多查询增加延迟 | 并行召回、查询数量上限、一次 Rerank |
| 附件向量占用 Redis | Float32 编码、chunk 上限、复用附件 TTL |
| 一次重构范围过大 | 按五阶段切换，先兼容再删除旧代码 |

## 10. 不在本轮范围

- 不扩建完整 AI 中台。
- 不调整文档入库主链和数据库 schema。
- 不更换 Milvus、Elasticsearch、PostgreSQL 或 Redis。
- 不重新设计 GraphRAG 数据模型。
- 不引入新的工作流框架。
- 不修改生产部署、密钥或 `.env`。
