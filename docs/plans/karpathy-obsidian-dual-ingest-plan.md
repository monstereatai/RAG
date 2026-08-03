# Unified Karpathy + Obsidian Knowledge Chain Plan

> 目标：补完整 Karpathy 这条链路，让 Karpathy 和本地 Obsidian 知识库结合成一个统一知识系统。同一份输入资料既进入现有 RAG 检索索引，也进入 Obsidian 的可读、可 diff、可持续编译知识层；Karpathy 负责统一编排两边的数据，而不是把 Obsidian 当成旁路备份。

## 当前判断

现有项目里的 Karpathy 更偏 “Karpathy-style RAG”：文档切片后进入 BM25 内存索引、Milvus/VectorStore、ES，再由 RAG 服务检索和生成答案。

个人知识库要补的 Karpathy 不是单独再建一个数据库，也不是简单把资料复制到 Obsidian 文件夹。它要把 Obsidian 当成长期知识层，把 DB/Milvus/ES/BM25 当成检索索引层，统一承担 fuxi 式能力：

- 保留原始资料，能回到事实来源。
- 生成单源笔记，记录 AI 对一份资料的理解和判断。
- 编译多份相关笔记，形成主题页、实体页、结论页。
- 每次新资料进入后，能往回更新相关主题和实体。
- 输出不止问答，还要服务软件项目推进：方案选择、技术选型敲定、架构决策、任务拆解、风险复盘和决策沉淀。

## 统一链路关系

### 索引层：现有 RAG / Karpathy 检索能力

用途：让系统“答得出”。

流程：

```text
输入资料
  -> DocumentService.upload()
  -> 结构化切片
  -> Embedding
  -> Milvus / VectorStore
  -> Elasticsearch
  -> Karpathy BM25
  -> Chat / Agentic RAG / Admin QA
```

特点：

- 面向检索和问答。
- 数据进数据库、向量库、ES、BM25。
- 适合低延迟召回、引用、RAG 评测。
- 对用户不够“可读”，不适合作为长期知识资产的主界面。

### 知识层：Obsidian 个人知识编译能力

用途：让知识“用得出、决策得出、执行得动”。

流程：

```text
输入资料
  -> 原料层 raw
  -> 单源笔记 notes
  -> 主题 / 实体 / 结论编译层 compiled
  -> 索引层 index
  -> 问答 / 方案选择 / 技术选型 / 架构决策 / 任务拆解
```

特点：

- Obsidian vault 是个人知识库的主要落点。
- Markdown 文件是 source of truth，便于阅读、手改、Git diff 和回滚。
- 关联写入 frontmatter / backlinks / related 字段。
- 先用轻量可解释关联，不急着把向量库作为主方案。

### 结合原则

两层都要拿到同一份输入数据，并由 Karpathy 统一编排。它们不是两套互不相关的系统，而是一个知识系统里的两种存储和取用形态：

| 能力 | RAG / Karpathy 索引层 | Obsidian 知识层 |
|------|--------------------------|-------------------|
| 主要目标 | 答得出 | 写得出、用得出 |
| 数据形态 | chunks / vectors / ES docs / BM25 entries | Markdown 文件 / frontmatter / backlinks |
| 适合场景 | 即时问答、引用、检索评测 | 方案选择、技术选型、架构决策、任务拆解、长期复用 |
| source of truth | DB 中的 doc/chunk + 原始对象 | Obsidian raw/notes/compiled 文件 |
| 关系发现 | BM25 / ES / Vector / RRF | tags/entities/topics/related/title overlap |
| 冲突处理 | RAG 引用和事实治理 | 编译页标注矛盾和版本差异 |

结论：不能二选一，也不能互相覆盖。输入资料进入系统时，必须同时更新索引层和知识层；回答、方案选择、技术选型、架构决策、任务拆解时，Karpathy 要能同时读取 RAG 检索结果和 Obsidian 编译页。

## Karpathy 在统一系统里的职责

Karpathy 不是单纯 BM25 服务，也不是 Obsidian writer。它应该是统一知识编排层：

```text
输入阶段：
  Karpathy Ingest Orchestrator
    -> RAG 索引层：DB / chunks / Milvus / ES / BM25
    -> Obsidian 知识层：raw / source note / compiled / index

取用阶段：
  Karpathy Retrieval Orchestrator
    -> 先读 Obsidian compiled/index，拿到人的长期判断
    -> 再查 RAG 索引层，补充原文证据和引用
    -> 最后融合生成问答、方案建议、技术选型建议、架构决策说明和任务拆解
```

因此后续实现时，不能把 Obsidian 同步做成和 Karpathy 无关的单独模块。Obsidian writer、source note generator、related calculator、compiled updater 都应该挂在 Karpathy 知识编排链路里，和现有 RAG 索引共享同一个 `docId/content_hash/source_id`。

## 92 分路由方案

最终路由采用三档，不把所有问题都丢给 Agentic RAG：

| 模式 | 定位 | 主链路 | 不做 |
|------|------|--------|------|
| `simple` | 读已经沉淀过的个人知识 | Karpathy + Obsidian Fast Path | 不调用外部工具、不做多步 agent、不联网研究 |
| `auto` | 默认入口，先快后深 | 先 simple，过不了 sufficiency gate 再升级 agentic | 不只按问题长短判断 |
| `agentic` | 研究未知/复杂问题 | Obsidian 工具源 + RAG Hybrid + GraphRAG + Web/Tools + Reflection | 不绕开 Obsidian 已沉淀判断 |

核心分工：

- Obsidian 是长期判断层：回答“我已经怎么看这件事”。
- RAG 索引层是证据层：回答“哪些原文证据支撑这个结论”。
- GraphRAG 是关系层：回答“实体、技术、主题之间怎么连接”。
- Agentic 是研究层：当已有知识不足时继续查、推理、调用工具。
- Karpathy 是统一编排层：决定先读哪层、怎么融合、何时升级。

### `simple`：Karpathy + Obsidian Fast Path

适用场景：

- 明确问个人知识库里已有观点。
- 查某个主题、实体、资料的结论。
- 生成方案选择、技术选型、架构决策、任务拆解、风险清单。
- 基于已经编译过的主题页/实体页快速回答。

流程：

```text
用户问题
  -> Karpathy Fast Path
  -> 读 Obsidian 40-index / 30-compiled
  -> 命中 topic/entity/conclusion
  -> 回溯 source notes / raw
  -> 查 RAG 索引层补证据和引用
  -> sufficiency gate
  -> 直接回答
```

要求：

- `simple` 必须走 Karpathy + Obsidian，不再只是传统简单 RAG。
- 优先读取 Obsidian compiled/index，拿长期判断。
- 必须能回链 source note/raw，避免只读二手结论。
- 必须补 RAG evidence 和引用，保证事实可追溯。
- 不调用外部 web search，不跑多 agent，保证快。

### `auto`：Fast Path First, Agentic Fallback

适用场景：

- 默认问答入口。
- 用户不显式指定 simple/agentic。

流程：

```text
用户问题
  -> 先跑 Karpathy + Obsidian Fast Path
  -> sufficiency gate
      - compiled/index 是否命中？
      - source note 覆盖是否足够？
      - RAG evidence 是否足够？
      - 引用是否能支撑答案？
      - 置信度是否过线？
  -> 足够：直接返回 simple 答案
  -> 不足：升级 Agentic RAG
```

升级条件：

- 没有命中 compiled/topic/entity。
- 只有结论，没有可追溯 source note/raw。
- RAG evidence 少于最低门槛。
- 需要跨多个来源复杂推理。
- 需要 GraphRAG、Web Search、外部工具。
- 用户问题要求“最新”“对比”“调研”“方案设计”“技术选型”“架构决策”等研究型输出。

### `agentic`：Research Path

适用场景：

- 资料不足，需要继续研究。
- 多跳推理、跨源对比、版本冲突分析。
- 需要 GraphRAG、外部工具、联网搜索。
- 需要规划、反思、引用校验的复杂任务。

流程：

```text
用户问题
  -> Agentic RAG
  -> Obsidian compiled/index 作为高优先级工具源
  -> RAG hybrid search
  -> GraphRAG
  -> Web/tools
  -> rerank/reflection/citation
  -> 回答
```

要求：

- Agentic 不能绕开 Obsidian。已经沉淀过的 compiled/topic/entity 是高优先级上下文。
- Agentic 可以把 Obsidian 当工具源，但不直接改 Obsidian，除非进入明确的 ingest/compile 任务。
- Agentic 输出如果形成新判断，后续应能写回 Obsidian compiled/conclusion，形成闭环。

### Sufficiency Gate

Fast Path 的答案必须过门禁才返回：

| 检查项 | 通过标准 |
|--------|----------|
| compiled 命中 | 至少命中一个 topic/entity/conclusion 或明确 source note |
| source 回链 | 能找到 source note/raw |
| evidence 覆盖 | 有足够 RAG chunk 或 raw 片段支撑 |
| 引用校验 | 关键结论能回到原文 |
| 置信度 | 低于阈值时不硬答，升级 agentic |

这个门禁比“问题短就 simple、问题长就 agentic”更可靠。路由依据不是长度，而是“已有知识是否足够支撑可靠回答”。

## Obsidian 目录约定

建议 vault 内先固定这些目录：

```text
ObsidianVault/
  00-inbox/
  10-raw/
    web/
    pdf/
    mhtml/
    manual/
  20-notes/
    source-notes/
    idea-notes/
  30-compiled/
    topics/
    entities/
    conclusions/
  40-index/
    daily.md
    weekly.md
    topics.md
    entities.md
    sources.md
  90-system/
    templates/
    logs/
    state/
```

目录含义：

- `00-inbox`：临时入口，人工拖入或自动生成的待处理文件。
- `10-raw`：原料层，只读不改，保留事实来源。
- `20-notes`：单源笔记层，一份资料生成一份带判断的笔记。
- `30-compiled`：编译层，多份笔记合成主题页、实体页、结论页。
- `40-index`：索引层，让人和 AI 快速定位知识。
- `90-system`：模板、运行日志、hash 状态、处理记录。

## Markdown Frontmatter 约定

### Raw 文件元数据

```yaml
---
id: source_20260702_xxx
type: raw
source_type: url | pdf | mhtml | manual | official_docs
source_url:
source_path:
title:
author:
captured_at:
content_hash:
rag_doc_id:
status: raw
---
```

### 单源笔记元数据

```yaml
---
id: note_20260702_xxx
type: source_note
source_id: source_20260702_xxx
rag_doc_id:
title:
topics: []
entities: []
tags: []
summary:
stance:
quality_score:
created_at:
updated_at:
related: []
---
```

### 编译页元数据

```yaml
---
id: topic_ai_native_knowledge_base
type: topic | entity | conclusion
title:
topics: []
entities: []
source_notes: []
related: []
open_questions: []
conflicts: []
updated_at:
---
```

关键点：

- `rag_doc_id` 用来打通 Obsidian 文件和现有 RAG 数据库。
- `content_hash` 用来判断资料是否重复或变化。
- `related` 写双向关联，便于 Obsidian 和 AI 都能跳读。

## 输入资料的统一写入流程

### 统一入口

后续应新增一个 Karpathy ingestion orchestrator，负责把同一份输入同时写入索引层和知识层：

```text
IngestInput
  filename
  content
  sourceUrl?
  sourceType
  originalBuffer?
  userId
  metadata
```

执行顺序：

1. 计算 `content_hash`。
2. 写入 Obsidian raw，保留原始资料。
3. 调用 `DocumentService.upload()`，进入现有 RAG / Karpathy 索引层，拿到 `docId`。
4. 生成 Obsidian source note，并写入 `rag_doc_id = docId`。
5. 基于 tags/entities/topics 算相关笔记。
6. 双向更新 `related`。
7. 更新相关 topic/entity/conclusion 编译页。
8. 更新 `40-index` 目录文件。

失败策略：

- RAG 入库失败：Obsidian raw 保留，note 标记 `rag_status: failed`，下次可重试。
- Obsidian 写入失败：RAG 入库可以完成，但任务标记 `obsidian_status: failed`，需要补偿。
- 编译页更新失败：source note 仍然保留，编译任务进入待重试队列。

## Karpathy 需要补强的内容

### P0：Karpathy 统一输入编排

- [x] URL 输入新增 Karpathy-Obsidian ingestion service：同一份 URL 正文同时进入 RAG 索引层和 Obsidian 知识层。
- [x] 给 `DocumentService.upload()` 的返回 `docId` 建立 Obsidian `rag_doc_id` 反向映射。
- [x] 支持 MHTML、PDF、Markdown、手动想法输入：文件上传和 `/documents/manual` 都走统一 Karpathy-Obsidian ingestion service。
- [x] Obsidian 层避免重复写入：基于 `content_hash` 判断 notes 是否已存在，重复资料返回 duplicate，不再重复生成 notes/raw/compiled。
- [x] RAG 索引层重复入库补偿：写入前先查 Obsidian source note 的 `content_hash + rag_doc_id`，命中时复用已有 `docId`，不重复调用 `DocumentService.upload()`；未新增数据库 schema。

### P0：Obsidian writer

- [x] 配置 vault 根目录，不写死路径：`OBSIDIAN_VAULT_DIR`，默认 `workspace/obsidian`。
- [x] 实现 `notes/` 目录初始化。
- [x] 实现安全文件名和 frontmatter 写入。
- [x] raw 文件只追加/新建，不覆盖事实来源，按 `raw/{sourceType}/日期-标题.md` 保存。
- [x] source note 生成时保留 `raw_path` 回链，原始 raw 不被覆盖。

### P1：单源笔记生成

- [x] URL 资料生成结构化 Markdown source note，写入 `notes/日期-标题.md`。
- [x] 输出 2-3 句摘要、3-5 条要点、3-5 个标签；LLM 失败时启发式兜底。
- [x] 输出关键结论、反对意见、适用边界、落地风险和验收口径。
- [x] 抽取 tags/topics/entities，并基于 tags、entities 生成 compiled 页面和 graph seed。
- [x] 给 URL source note 写 `rag_doc_id`、`content_hash`。

### P1：轻量关联系统

- [x] 基于 tags/topics/entities 生成轻量候选关联：`index/tags.md`、`compiled/{tag}.md`、`compiled/entities/{entity}.md` 会聚合相关笔记。
- [x] 写入双向 `related`：每次刷新都会在 source note 中维护“相关笔记”区块。
- [x] 给每条关联记录 reason 和 score：共享 entities 权重最高，topics 次之，tags 兜底。
- [x] 将关联更新日志写入 `90-system/logs/related-日期.md`，便于 diff。

### P1：编译层

- [x] 主题页轻量版：按 tags 聚合多个 source notes 到 `compiled/{tag}.md`。
- [x] 项目工作流编译页：按 `compiled/project-workflows/{type}` 生成方案选择、技术选型、ADR、任务拆解文档。
- [x] 实体页基础版：按 source note frontmatter `entities` 聚合同一人/产品/公司/技术资料到 `compiled/entities/{entity}.md`，并刷新 `index/entities.md`。
- [x] 结论页基础版：按 source note 的“关键结论”沉淀到 `compiled/conclusions/{conclusion}.md`，聚合证据、风险和验收口径，并刷新 `index/conclusions.md`。
- [x] 每次新增资料后，自动刷新 `index/sources.md`、`index/tags.md`、`index/entities.md`、`index/conclusions.md`、tag/entity/conclusion compiled 页和 graph seed。
- [x] 版本/语义差异基础检查：结论页会检测多个年份/版本信号，以及推荐/不推荐、采用/避免、必须/可选等冲突信号并标记需人工确认；复杂语义矛盾仍需要后续评测和人工复核。

### P2：Karpathy 统一取用流

- [x] 问答流：Karpathy simple fast path 会读取 Obsidian compiled/index/notes，并结合 RAG 索引层补证据和引用。
- [x] 方案选择流：基于 topic/entity/conclusion 对比多种实现路线，输出推荐方案、取舍理由和适用边界。
- [x] 技术选型流：围绕技术栈、框架、数据库、向量库、Agent/RAG 方案做候选比较、评分和最终敲定。
- [x] 架构决策流：基于编译页输出 ADR 草稿，包含背景、约束、备选方案、决策、影响和回滚条件。
- [x] 任务拆解流：把已敲定方案拆成模块、接口、数据流、里程碑、风险和验收标准。

### P2：模式路由

- [x] `simple` 固定走 Karpathy + Obsidian Fast Path。
- [x] `auto` 先走 Fast Path，再按 sufficiency gate 决定是否升级 Agentic。
- [x] `agentic` 把 Obsidian compiled/index/notes 作为高优先级上下文源。
- [x] 建立基础门禁字段：RAG 检索充分性、Obsidian 命中充分性、`obsidianPaths`、`ragReferences`。
- [x] 在响应 metadata/final 中返回 route、retrievalReason、obsidianPaths、ragReferences。

### P2：与现有 Admin/RAG 的关系

- [x] Admin 文档列表展示 `obsidian_path` 或关联状态。
- [x] RAG 问答返回时能附带 `obsidianPaths`，并把 Obsidian 命中转成伪片段参与 `[片段N]` 引用校验和 references 返回。
- [x] 官方文档夜间同步进入 RAG 时，也同步写入 Obsidian。
- [x] GraphRAG 初始 seed：从 Obsidian source note 的 entities/topics/tags 抽取节点和关系，写入 `index/graph/obsidian-seed.json`，并通过 `GET /api/obsidian/graph/seed` 暴露只读导出。

## 不做什么

第一阶段不做：

- 不把 Obsidian 替换成数据库，也不把 Obsidian 做成 Karpathy 之外的旁路备份。
- 不新增生产数据库 schema。
- 不把向量库作为个人知识库主真相。
- 不做多人协作和多端同步。
- 不做复杂 UI。
- 不做音视频理解。

## 里程碑

### M1：双写闭环

目标：输入一篇文档后，Karpathy 统一编排 RAG 索引层和 Obsidian 知识层，两边都能拿到同源数据。

验收：

- URL 输入时 RAG 文档列表可见新文档。
- URL 输入时 Karpathy/RAG 能检索回答。
- URL 输入时 Obsidian `notes/` 出现 source note。
- source note frontmatter 包含 `title/source_url/tags/date/rag_doc_id/content_hash`。
- 文件上传和手动输入也能进入 RAG 与 Obsidian。

### M2：关联闭环

目标：新增资料后，Obsidian 能自动建立可解释关联。

验收：

- 新 source note 有 tags。
- `index/tags.md` 能看到同标签聚合。
- `compiled/{tag}.md` 能看到相关 source note 摘要。
- 双向 `related`、reason/score 日志已完成基础版。

### M3：编译闭环

目标：新增资料后，相关主题页/实体页能被更新。

验收：

- tag compiled 页面包含 source note 列表和摘要。
- 新资料能触发对应 compiled/index 刷新。
- entity/conclusion 页面会生成证据、风险、验收、开放问题和基础矛盾检查；复杂语义矛盾仍需真实数据评测和人工复核。

### M4：取用闭环

目标：Karpathy 不只会问答，还能基于 Obsidian 编译页推进软件项目决策和执行。

验收：

- 可基于 compiled 页回答问题。
- 可生成方案选择对比表。
- 可生成技术选型决策说明。
- 可生成架构决策记录 ADR 草稿。
- 可生成任务拆解、接口清单、风险清单和验收标准。
- 对外接口：`POST /api/obsidian/project-workflows/:type`，`type` 支持 `solution`、`tech-selection`、`adr`、`task-breakdown`。

### M5：路由闭环

目标：simple/auto/agentic 三档路由稳定工作。

验收：

- `simple` 明确走 Karpathy + Obsidian Fast Path。
- `auto` 在 compiled/evidence 足够时不升级。
- `auto` 在知识不足时自动升级 agentic。
- `agentic` 能读取 Obsidian compiled/index 作为工具源。
- 响应中能解释本次走了哪条路线以及为什么。

## 风险和边界

- Obsidian 文件是人可编辑的，程序必须能容忍 frontmatter 缺字段或人工改动。
- 文件写入必须做路径安全校验，不能允许 path traversal。
- 编译层可能产生错误判断，所以 raw 永远保留，compiled 页必须能回链 source notes/raw。
- 不要让 RAG DB 和 Obsidian 互相覆盖；二者通过 `rag_doc_id` 和 `content_hash` 建关系，并由 Karpathy 统一读取。
- 如果后续加入向量库检索 Obsidian，也只能作为辅助索引，不能取代 Markdown 文件本身。

## 当前状态

- [x] 已明确 Karpathy 统一编排 RAG 索引层和 Obsidian 知识层。
- [x] 已明确 Obsidian 作为个人知识库落点。
- [x] 已明确 Karpathy 从“答得出”补强为“写得出、用得出”的方向。
- [x] 已明确 92 分路由方案：simple 走 Karpathy + Obsidian，auto 先快后深，agentic 走研究路径且不绕开 Obsidian。
- [x] URL 入口已接入 Karpathy-Obsidian ingestion service，同一份正文进入 RAG 和 Obsidian notes。
- [x] 已实现 Obsidian `raw/notes/compiled/index` writer。
- [x] 已实现 MHTML/PDF/Markdown/手动想法的统一 ingestion。
- [x] 已实现 simple/auto/agentic 三档路由和 sufficiency gate 基础版。
- [x] 已接入问答 metadata 中的 Obsidian 路径回链。
- [x] 已实现双向 `related` 基础版、reason/score 日志。
- [x] 已接入 Admin 文档列表展示 `obsidian_path` 关联状态。
- [x] 已实现项目决策编排 API 和 Obsidian 输出：方案选择、技术选型、ADR、任务拆解。
- [x] 已实现 entity/conclusion 编译页基础版、开放问题、版本/语义冲突信号检查和 GraphRAG seed 只读导出。
