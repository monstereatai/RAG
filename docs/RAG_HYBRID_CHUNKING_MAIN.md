# RAG 结构感知组合切片（main）

## 原则

- 文件解析：MinerU 优先处理 Office/PDF；本地解析器兜底。MD/JSON/CSV/URL、音视频分别走原生解析。
- 结构优先：使用 `ParsedDocument.blocks` 的标题/页码/Sheet/行号/幻灯片/时间轴/附件信息，而不只解析扁平 Markdown。
- 业务边界：Excel/CSV 表格逐行；API Endpoint / 测试用例 / 规则条款聚合字段与相邻表格；PDF/Word/文档章节、音视频时间片按逻辑单元切片。
- Token 兜底：过长逻辑单元只在它内部使用现有 `MarkdownChunker` 的 Token+语义边界组合切片；不跨业务记录合并。
- Parent-Child：每个子块含稳定父级分组 ID 与有上限的父块上下文；**只有子块建立索引**，检索选出子块后根据任务意图按预算扩展父块。无需让父块重复进入向量/BM25 索引。
- 引用安全：来源元数据作为 JSON 持久化，不把页码/行号/视频时间混同；不能证实时不编造。保留截图引用，由现有有权限校验的 OSS 路由访问。

## 数据路径

`ParsedDocument` → `splitHybridDocument` → `HybridChunk` (content + parentContent + sourceMetadata) → PG + BM25 + ES + Milvus → 子块召回、Rerank → ContextBuilder 父块扩展 / 来源标签。

`parentContent`/`sourceMetadata` 存于 `document_chunks` 并随检索元数据持久化，ES 字段禁止检索和单独 Embedding。父块作为上下文缓存而非独立索引实体。为了避免引入新的关联查询，父上下文按子块重复保存（上限 6000 字符）；如规模增长，可迁移到独立 parent 表而不更改上层查询协议。

## 迁移与验证

1. 在 `main` 分支仓库根目录执行 `python3 apply_rag_hybrid_main.py`（仅在匹配目标版本时改写文件；已安装时可重跑检查）。
2. 执行 `pnpm --filter backend exec jest --runInBand hybrid-document-chunker.spec.ts`。
3. 执行 `pnpm --filter backend build`；`tsc --noEmit` 包含旧测试文件，旧测试类型错误要独立修复。
4. 使用现有 `migration:run` 流程应用 `AddHybridChunkProvenance`，且在生产环境先备份数据库。
5. 使用真实 Excel、含图 PDF/Word/PPT、游戏玩法 PRD、API/测试/规则、音视频样本做回归。旧数据不会自动补齐 sourceMetadata/parentContent；重建索引/重新入库后才能看到新增字段。

## 验收

- 一条 Bug 的文本/截图不与相邻 Bug 混到一个 Parent；两个不同 Bug 的来源行号准确。
- API 的请求/参数/响应不被拆散到不同 Endpoint 的 Parent；超长文档在同一 Endpoint 内切分。
- 图片链接/页码/Sheet/行号/音视频时间范围正确存储并可见；无来源时不得臆造。
- 检索索引中只存在叶子块；Parent 扩展由预算控制，不跨用户、租户、文档、版本拼接。
- 对比 Recall@5、证据精确度、引用正确率、记录完整率；错误可复现并回归。

## 当前边界

MinerU 对多级表头/复杂跨页合并表格的识别依赖具体模板，另外约九种模板尚需真实验证。完整端到端需要服务器接通 MinerU、OSS、PostgreSQL、ES、Milvus 和实际权限数据库。
