# RAG Admin API Contract

> `admin-backend` 只通过 HTTP 调用 `rag-backend`。本文件记录管理后台需要的 RAG 运营 API。当前 `rag-backend` 尚未完整暴露这些 `/api/v1/rag/admin/*` 路由，后台会返回 structured unavailable，不直接访问 RAG 内部 service。

## Base URL

默认：

```text
RAG_SERVICE_BASE_URL=http://localhost:3000/api/v1
```

## Required Endpoints

### Capabilities

```text
GET /rag/admin/capabilities
```

用于后台判断 RAG 服务可用能力：

- vector store provider
- BM25 / Elasticsearch 状态
- Rerank 状态
- GraphRAG 状态
- MCP 状态
- Mem0 / Redis 记忆状态
- speech / web search 状态

### Documents

```text
GET /rag/admin/documents
GET /rag/admin/documents/:docId
GET /rag/admin/documents/:docId/chunks
GET /rag/admin/documents/:docId/status
GET /rag/admin/documents/:docId/download
POST /rag/admin/documents/:docId/reindex
POST /rag/admin/documents/:docId/archive
POST /rag/admin/documents/:docId/permissions
POST /rag/admin/documents/batch
POST /rag/admin/documents/upload
```

后台文档治理需要：

- 分页列表
- 搜索关键词
- 文档分类
- 上传人 / userId
- 解析状态
- 权限范围
- sourceAuthority
- docVersion / effectiveAt / expiredAt
- chunks 列表
- 解析状态
- 安全下载
- 重建索引触发
- 归档
- 权限范围更新
- 批量治理操作
- 上传入口，由 RAG 服务执行解析、切片、向量化和索引同步

### Vector Index

```text
GET /rag/admin/vector-index
```

后台需要展示：

- vector provider
- collection / index name
- index type
- metric type
- chunk count
- last reindex time
- degraded / healthy 状态

### Evaluations

```text
GET /rag/admin/evaluations
POST /rag/admin/evaluations/run
```

后台需要展示并触发：

- 最近评测结果
- dataset 名称
- mode：offline / live / project
- pass rate
- refusal / citation / claim support 结果
- 失败样本

### Conversations

```text
GET /rag/admin/conversations
```

后台需要展示：

- 问答记录
- 用户 ID
- 模式：simple / auto / agentic
- 引用数量
- 是否触发拒答
- latency
- createdAt

### Search Operations

```text
GET /rag/admin/search/queries/popular
GET /rag/admin/search/queries/no-result
GET /rag/admin/search/recall-issues
```

后台需要展示：

- 热门 query
- 无结果 query
- 召回质量问题
- query 命中率
- query latency

### QA Operations

```text
GET /rag/admin/qa/negative-feedback
GET /rag/admin/qa/citation-failures
GET /rag/admin/qa/cost-summary
```

后台需要展示：

- 差评样本
- 引用失败样本
- 拒答样本
- LLM 调用量
- token / cost 汇总

### Graph Operations

```text
GET /rag/admin/graph/schema
GET /rag/admin/graph/entities
GET /rag/admin/graph/entities/:id
GET /rag/admin/graph/relationships
GET /rag/admin/graph/search
GET /rag/admin/graph/orphans
GET /rag/admin/graph/conflicts
```

后台需要展示：

- GraphRAG schema
- 实体列表
- 实体详情
- 关系列表
- 图谱搜索结果（nodes + edges）
- 孤立节点
- 冲突关系

## Error Shape

`admin-backend` 会把 RAG 请求包装成统一结构：

```json
{
  "available": false,
  "status": null,
  "data": null,
  "error": "fetch failed"
}
```

RAG 侧非 2xx 时：

```json
{
  "available": false,
  "status": 503,
  "data": null,
  "error": "message from rag-backend"
}
```

## Implementation Rule

- `admin-backend` 不 import `rag-backend` 代码。
- `admin-backend` 不直接读写 Milvus、Neo4j、Elasticsearch、Redis 或 RAG 数据库。
- `admin-backend` 不复制 RAG 检索、切片、Agent workflow、GraphRAG 逻辑。
- 当前不抽 `packages/shared`。
