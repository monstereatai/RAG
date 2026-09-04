# 课程配图 · 数据写入与在线问答 Pipeline（Mermaid）

> 两张图均取自仓库真实链路（非示意）：入库四路并发、混合检索 + Rerank + 充分性门禁、Direct Answer Gate、引用溯源。
> 教学对应：图 1 → 第 2-3 课（文档管线 / 向量库）；图 2 → 第 4-6 课（混合检索 / Karpathy 链路 / Agentic 编排）。
> 语法兼容 GitHub / Typora / Notion（保守子集：flowchart + subgraph + 引号标签 + 标准/虚线箭头）。

## 图 1 · 数据写入 / 索引 Pipeline

核心教学点：**高风险内容在并发前隔离**（Prompt Injection 不进任何索引）；**四路并发、任一失败补偿清理**；Neo4j 图谱是可选异步补充，失败不阻塞。

```mermaid
flowchart TD
    A["上传文档<br/>PDF / DOCX / PPTX / MD / TXT / MP4"] --> B["文档解析 document-parser"]
    B --> B1["扫描件 PDF 无文本层<br/>OCR 兜底（Vision）"]
    B --> B2["内嵌图片 → MinIO<br/>视频：ffmpeg 抽音轨 → 腾讯 ASR"]
    B --> C{"质量门禁 +<br/>Prompt Injection 检测"}
    C -->|高风险| X["隔离区：不进任何检索索引"]
    C -->|通过| D["父子切块 MarkdownChunker<br/>标题结构 / 表格语义化 / 代码整块保护"]
    D --> E["LLM 元数据抽取（zod）<br/>标题 / 作者 / 关键词 / 分类"]
    E --> F{"审批门禁<br/>DOCUMENT_REQUIRE_APPROVAL"}
    F -->|开启：先落 draft| G["draft 草稿态入库"]
    F -->|关闭| G2["直接进入索引"]
    subgraph PARALLEL["四路并发索引（任一失败：草稿保留排障 + 补偿清理已写索引）"]
        I1["PostgreSQL<br/>文档 / Chunk / 权限 ACL / 质量元数据"]
        I2["Qwen Embedding<br/>Milvus 向量库 + ES dense_vector"]
        I3["BM25 内存索引<br/>+ Elasticsearch 全文（IK 分词）"]
        I4["Obsidian 来源笔记"]
    end
    G --> PARALLEL
    G2 --> PARALLEL
    PARALLEL --> J{"必要分支<br/>全部成功？"}
    J -->|是| K["恢复目标生命周期<br/>draft → effective 对外可见"]
    J -->|否| L["PostgreSQL 草稿保留供排障<br/>补偿清理 Milvus / ES / BM25"]
    K -. 可选异步 .-> M["Neo4j 图谱补充索引<br/>实体关系抽取，失败不阻塞"]
```

## 图 2 · 在线问答 / 检索 Pipeline

核心教学点：**Direct Answer Gate 先于一切检索**（已审核 Base Case 直达回答）；**RRF 融合 → 统一过滤 → Rerank** 的顺序不可颠倒（先过滤后精排，Rerank 才不会把无权限内容排上来）；充分性不足走**联网补证 → 再门禁 → 安全降级**，绝不无证据硬答。

```mermaid
flowchart TD
    Q["用户提问<br/>Simple 极速 / Auto 自动 / Agentic 深度"] --> DG{"Direct Answer Gate<br/>精确直答门禁（含中文纠错）"}
    subgraph REC["统一 Hybrid RAG 并发召回"]
        R1["关键词召回<br/>BM25 内存索引 + Elasticsearch"]
        R2["向量召回<br/>Milvus + Qwen Embedding"]
        R3["ES kNN 向量降级"]
        R4["Obsidian 来源笔记召回"]
    end
    subgraph CB["上下文组装"]
        M1["Redis 短期记忆 + Mem0 长期记忆注入"]
        M2["对话历史向量召回 ConversationEmbedding"]
        M3["Context Builder：去重 / 排序 / Token 预算"]
    end
    DG -->|命中已审核 Base Case| ZA["Base Case 直答<br/>exact / correction 转为可引用证据"]
    DG -->|未命中| REC
    R2 -. Milvus 超时 .-> R3
    REC --> RR["RRF 融合候选"]
    RR --> FLT["统一过滤：权限 ACL / 版本 effective<br/>来源 / 作用域 / draft 隔离"]
    FLT --> GP["按需合并图谱证据（Neo4j）"]
    GP --> RK["DashScope Rerank 精排 TOP_N<br/>未配置或失败 → 原序降级"]
    RK --> SF{"充分性门禁"}
    SF -->|证据不足| WB["联网补证：博查 Web Search<br/>Simple 最多一次 / Agentic 按需"]
    WB --> SF
    SF -->|充分| CB
    SF -->|仍不足| SD["安全降级：confidence = 0<br/>返回补充信息指引"]
    CB --> LM["Qwen LLM 流式生成（Provider 可插拔）"]
    LM --> CG{"逐句引用门禁"}
    CG -->|通过| OUT["回答 + references 溯源<br/>docId / docVersion / score / rerankScore"]
    CG -->|未通过| FB["抽取式带引用兜底回答"]
    FB --> OUT
    OUT --> SSE["SSE / AG-UI 事件流<br/>token 推送 + 运行轨迹"]
    OUT --> MEM["Mem0 长期记忆分类写入"]
```

## 与三模式的关系（图 2 的差异点）

| 模式 | 走到哪 |
|---|---|
| Simple 极速 | Gate → Hybrid RAG → 最多一次联网补证，不拆题、不循环 |
| Auto 自动 | Gate → Fast Path → 按充分性与复杂度决定升级 Agentic |
| Agentic 深度 | 不走直答捷径；查询增强 → 子问题并发检索 → 按需图谱/工具补证 → 受预算约束的反思重试 |
