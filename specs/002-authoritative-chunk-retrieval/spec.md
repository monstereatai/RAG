# 权威 Chunk 回源与引用一致性

## 背景与目标

- 背景：当前 Elasticsearch、Milvus、本地 BM25 快照和 PostgreSQL 都保存不同程度的 chunk 正文。向量命中后，检索链路使用本地 `bm25-index.json` 恢复完整正文和引用元数据；Milvus 返回的是限长副本，多实例场景下本地快照也可能不一致。
- 目标：将 PostgreSQL `document_chunks` 明确为脱敏 chunk 正文和引用元数据的权威来源；Elasticsearch、Milvus 与本地 BM25 只负责候选召回和降级。最终证据和引用必须按 chunk ID 批量回源 PostgreSQL。
- 成功标准：无论候选来自 Elasticsearch、Milvus、本地 BM25 或检索描述索引，进入生成上下文和 `references` 的正文及来源字段均来自当前用户有权访问、生命周期有效的 PostgreSQL chunk。

## 范围

- 包含：候选 chunk 的批量回源、权限与生命周期复核、完整正文和引用元数据覆盖、缺失或过期索引命中的丢弃、相邻块/同节扩展的权威数据来源、相关定向测试和架构文档更新。
- 包含：Milvus 检索结果降为 chunk ID、分数及定位信息；检索和引用逻辑不再依赖 Milvus 的限长 `content`。
- 包含：Elasticsearch 和本地 BM25 继续保存正文副本，以支持全文召回、高亮和本地降级；这些副本不作为最终引用真源。
- 不包含：删除 PostgreSQL `document_chunks.content`、删除 Elasticsearch `_source` 正文、改变原始文件对象存储策略。
- 不包含：本次物理删除 Milvus collection 的 `content` 字段或迁移历史向量数据。现有字段暂时保留以兼容已部署 collection；物理 schema 变更另行确认。
- 不包含：修改 `.env`、新增依赖、部署或生产数据迁移。

## 用户与行为

### AC-01：所有召回通道统一回源权威 Chunk

- 前置条件：ES、Milvus、本地 BM25 或检索描述返回一个或多个候选 chunk ID。
- 操作：系统融合候选并准备重排、上下文扩展和回答证据。
- 预期结果：系统通过一次或有限次数的批量 PostgreSQL 查询取得完整 chunk；候选的正文、文档 ID、块序号和引用元数据由 PostgreSQL 记录覆盖。
- 预期结果：PostgreSQL 中不存在的索引命中不会进入重排、上下文或引用。
- 验证方式：检索服务与权威 chunk 读取服务单元测试，覆盖 ES、Milvus、本地 BM25 和混合候选。

### AC-02：引用与生成上下文使用同一份正文

- 前置条件：检索得到最终证据 chunks，并生成带 `[片段N]` 标记的回答。
- 操作：系统构造模型上下文和 API `references`。
- 预期结果：同一 chunk 在模型上下文和引用结果中的 `content`、`docVersion`、`headingPath`、`sectionId`、`sourceStart`、`sourceEnd`、`sourceMetadata` 等来源字段一致，均来自 PostgreSQL。
- 预期结果：Milvus 截断正文或过期 ES/BM25 正文不能覆盖权威正文。
- 验证方式：检索融合、上下文构造和引用映射回归测试。

### AC-03：权限、租户和生命周期在回源阶段失败关闭

- 前置条件：底层索引包含越权、跨租户、已归档、草稿、过期或已删除 chunk。
- 操作：系统批量回源候选。
- 预期结果：只返回 `allowedDocIds` 范围内并符合当前检索 scope 和生命周期规则的 chunk；未知或不一致候选直接丢弃，不使用索引副本兜底生成答案。
- 验证方式：定向单测覆盖共享 ACL、所有者回退、租户、草稿、归档、过期和缺失记录。

### AC-04：索引职责清晰且现有降级能力保持

- 前置条件：Milvus 不可用、Elasticsearch 不可用或本地 BM25 被启用作为降级通道。
- 操作：系统执行关键词或向量检索。
- 预期结果：可用索引仍能召回候选；PostgreSQL 可用时最终正文和引用正常生成。PostgreSQL 回源失败时本轮检索明确失败或返回无证据结果，不使用索引正文冒充权威证据。
- 预期结果：Milvus Provider 的公开检索契约不再要求调用方依赖 `content`，但不触发 collection schema 迁移。
- 验证方式：Provider 契约测试、检索降级测试、后端 build/lint 和真实统一问答入口的快速/深度路径验证。

## 边界与约束

- 错误态：PostgreSQL 回源失败必须可观测且失败关闭；不能静默改用 Milvus、ES 或本地快照正文回答。
- 空态：全部候选被过滤后沿用现有“证据不足”行为。
- 兼容性：现有 Milvus collection、ES mapping、BM25 快照格式和外部 API references 结构保持兼容。
- 性能：回源按 chunk ID 批量查询，禁止逐条 N+1；只查询候选、扩展和最终引用所需字段。
- 安全与隐私：PostgreSQL 中保存的是入库流程产出的脱敏正文；回源仍受租户、ACL、文档范围和生命周期约束。
- 一致性：PostgreSQL 是权威存储，ES/Milvus/BM25 是派生索引；跨存储写入仍非原子，由现有对账与重建机制处理。
- 工作区：保留现有未提交改动，不覆盖 `001-pii-ingestion` 相关实现；本次业务改动只进入批准 Plan 的文件白名单。
- 数据库红线：本规格不包含关系库或 Milvus schema 变更，不执行数据迁移。

## 已确认事实

- `document_chunks` 已保存完整 `content`、稳定 chunk ID、版本、来源位置、权限相关字段和生命周期字段。
- Elasticsearch 已保存完整正文及引用所需的大部分元数据，负责 BM25/全文召回。
- Milvus 主 collection 的正文写入前会截断到 8192 字节，不能作为完整引用来源。
- 当前向量命中通过进程内 `chunkMeta` 获取完整正文；`chunkMeta` 从本地 BM25 JSON 快照恢复。
- API `references` 已包含 chunk 正文、ID、版本、标题路径、来源位置和生命周期等字段。

## 待确认项与假设

- 假设：本轮优先完成运行时权威回源和引用一致性，不物理删除 Milvus 的兼容字段。
- 待 Plan 阶段确认：是否保留本地 BM25 为生产降级候选源，还是只在开发模式启用；默认保持现有行为以控制范围。

## 审批

- Spec 状态：draft
- 批准人：
- 批准时间：
- 审批证据：用户原始要求“按最优方案来，不合理可以重构的”。
