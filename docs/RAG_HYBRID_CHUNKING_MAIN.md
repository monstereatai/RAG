# RAG 结构感知组合切片（main）

## 原则

- 文件解析：MinerU 优先处理 Office/PDF；本地解析器兜底。MD/JSON/CSV/URL、音视频分别走原生解析。
- 结构优先：使用 `ParsedDocument.blocks` 的标题/页码/Sheet/行号/幻灯片/时间轴/附件信息，而不只解析扁平 Markdown。
- 业务边界：Excel/CSV 表格逐行；API Endpoint / 测试用例 / 规则条款聚合字段与相邻表格；PDF/Word/文档章节、音视频时间片按逻辑单元切片。
- Token 兜底：过长逻辑单元只在它内部使用现有 `MarkdownChunker` 的 Token+语义边界组合切片；不跨业务记录合并。
- Parent-Child：父块在 PostgreSQL 中独立保存一次，子块只保存父块 ID；**只有子块建立检索索引**。检索命中子块后，按 ID 回 PostgreSQL 取父块，再根据任务意图和上下文预算扩展。
- 引用安全：来源元数据作为 JSON 持久化，不把页码/行号/视频时间混同；不能证实时不编造。保留截图引用，由现有有权限校验的 OSS 路由访问。

## 数据路径

`ParsedDocument` → `splitHybridDocument` → `HybridChunk`（content + parentChunkId + 临时 parentContent + sourceMetadata）→ PostgreSQL（parent/leaf）→ Elasticsearch（leaf only）→ 子块召回、Rerank → PostgreSQL 回填父块 → ContextBuilder 扩展 / 来源标签。

父子块共用现有 `document_chunks` 表：父块行的 `chunkType='parent'`，正文放在 `content`；叶子行的 `chunkType='leaf'`，用 `parentChunkId` 指向父块。`parentContent` 只在切片结果中临时传递，新的叶子行不再重复保存父文；父行不写入 Elasticsearch、BM25 或向量索引。Elasticsearch 只保留叶子正文和召回所需字段，引用正文与父级上下文以 PostgreSQL 为准。

旧数据可能仍把父文保存在叶子行的 `parentContent` 中，读取路径会在找不到父行时兼容该字段。新入库和增量更新按独立父行写入；不自动回填历史数据，也不需要新增数据库 schema。历史文档需要转换时，应通过重新入库或经确认的专项回填完成。

## 验证

1. 执行 `npm run build` 和改动文件 ESLint。
2. 验证普通入库与增量更新都写出 parent/leaf 行，且 `document_chunks` 中每个父 ID 对应一致的父正文。
3. 验证 Elasticsearch 的 BM25/dense_vector 检索和开发环境 BM25 快照只含叶子块；检索命中后从 PostgreSQL 回填父块。文档正文不写入 Milvus。
4. 使用真实 Excel、含图 PDF/Word/PPT、游戏玩法 PRD、API/测试/规则和音视频样本回归切片边界、引用来源与增量更新。

## 验收

- 一条 Bug 的文本/截图不与相邻 Bug 混到一个 Parent；两个不同 Bug 的来源行号准确。
- API 的请求/参数/响应不被拆散到不同 Endpoint 的 Parent；超长文档在同一 Endpoint 内切分。
- 图片链接/页码/Sheet/行号/音视频时间范围正确存储并可见；无来源时不得臆造。
- 检索索引中只存在叶子块；Parent 扩展由预算控制，不跨用户、租户、文档、版本拼接。
- 对比 Recall@5、证据精确度、引用正确率、记录完整率；错误可复现并回归。

## 当前边界

MinerU 对多级表头/复杂跨页合并表格的识别依赖具体模板，另外约九种模板尚需真实验证。完整端到端需要服务器接通 MinerU、OSS、PostgreSQL、ES、Milvus 和实际权限数据库。
