# Official Docs Nightly Sync

## 目标

每天凌晨 01:00 抓取 React、Vue、JavaScript、NestJS 官方文档，检测新增或修改页面，将变化内容插入数据库、向量库、ES、Karpathy BM25 知识库，并同步写入 Obsidian 本地知识库。

## 实现策略

- 默认关闭：避免本地启动时自动访问公网。
- 开启方式：设置 `OFFICIAL_DOCS_SYNC_ENABLED=true`。
- 调度时间：默认每天 01:00，本地时区；可用 `OFFICIAL_DOCS_SYNC_HOUR` 调整小时。
- 状态存储：`workspace/official-docs-sync-state.json`，按 URL 保存内容 hash。
- 去重策略：只有 URL 首次出现或正文 hash 变化时才入库。
- 入库链路：复用 Karpathy-Obsidian ingestion service，所以会同步写入：
  - `documents_meta`
  - `document_chunks`
  - Milvus / vector store
  - Elasticsearch
  - Karpathy BM25 持久化索引
  - Obsidian `raw/official-docs`
  - Obsidian `notes/日期-标题.md`
  - Obsidian `index/sources.md`、`index/tags.md`
  - Obsidian `compiled/{tag}.md`
- 不新增数据库表，不做 schema 变更。

## 默认抓取范围

| 来源 | 入口 |
|------|------|
| React | `https://react.dev/learn`、`https://react.dev/reference/react` |
| Vue | `https://vuejs.org/guide/introduction`、`https://vuejs.org/api/` |
| JavaScript | `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide`、`https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference` |
| NestJS | `https://docs.nestjs.com/`、`https://docs.nestjs.com/controllers`、`https://docs.nestjs.com/providers` |

## 配置项

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `OFFICIAL_DOCS_SYNC_ENABLED` | `false` | 是否启用夜间同步 |
| `OFFICIAL_DOCS_SYNC_HOUR` | `1` | 每天几点执行，0-23 |
| `OFFICIAL_DOCS_SYNC_RUN_ON_START` | `false` | 启动后是否立即跑一次 |
| `OFFICIAL_DOCS_SYNC_USER_ID` | `system-official-docs` | 入库文档所属用户 |
| `OFFICIAL_DOCS_SYNC_MAX_PAGES_PER_SOURCE` | `12` | 每个来源每轮最多抓取页面数 |
| `OFFICIAL_DOCS_SYNC_TIMEOUT_MS` | `15000` | 单页面抓取超时 |

## 注意

- 首次开启会把默认范围内的页面都视为新增内容。
- 后续只会插入新增或修改页面的快照，不会删除旧版本，便于追踪官方文档变化。
- 如果 Embedding、Milvus、ES 或数据库不可用，入库会失败并记录日志；下一轮仍会重新尝试。
- `OFFICIAL_DOCS_SYNC_USER_ID` 对应的用户可按需要在权限系统中做展示或后台查询。
