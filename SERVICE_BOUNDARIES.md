# 管理后台与 RAG 服务拆分设计

> 目标：管理后台和 RAG 服务拆成两个独立后端项目，避免后台需求污染 RAG 主链路；当前不抽共享包，两个服务先通过 HTTP API 契约协作。

## 结论

当前方案从“一个 NestJS 后端内部分域”调整为：

```text
rag-backend    独立项目，负责 RAG / Agent / 文档处理 / 检索问答
admin-backend  独立项目，负责管理后台 / 用户权限 / 运营统计 / 审计配置
frontend       面向普通知识库用户
admin-frontend 面向后台管理员
```

当前仓库里的 `backend/` 继续作为 `rag-backend` 演进。后续新增独立 `admin-backend/`，后台通过 HTTP API 调用 `rag-backend` 的运营接口，不直接 import RAG 内部 service。

## 为什么改成两个项目

管理后台和 RAG 服务的变化节奏不同：

- RAG 服务关注召回、切片、Embedding、Rerank、GraphRAG、Agent 工作流、引用支撑和评测。
- 管理后台关注用户、角色、权限、菜单、日志、系统配置、运营统计和审批治理。
- 后台功能会不断增加表单、筛选、报表、审计、配置项，如果和 RAG 主服务混在一起，RAG 主链路会越来越臃肿。
- 两个项目独立后，后台可以按管理系统节奏迭代，RAG 可以按模型和检索质量节奏迭代。

这不是为了追求“微服务好看”，而是因为两个系统的职责边界、开发节奏和风险面确实不同。

## 项目边界

### rag-backend

负责：

- 文档上传、解析、切片、元数据抽取。
- Embedding、向量入库、BM25/ES 混合检索。
- Rerank、低相关拒答、引用支撑校验。
- AI 问答、SSE 流式输出、对话历史。
- Agentic RAG、GraphRAG、Memory、Skills、MCP。
- RAG 评测、质量门禁、项目级业务回放。
- RAG 相关 Provider：LLM、Embedding、Vector Store、Speech、Web Search、Rerank、Neo4j。

不负责：

- 后台菜单。
- 用户列表管理页面口径。
- 角色权限配置页面。
- 后台审计报表。
- 系统公告、通知中心。
- 管理员运营工作台。

### admin-backend

负责：

- 管理后台登录态校验、管理员资料、角色权限。
- 用户管理、角色管理、权限点管理。
- 首页大盘、访问统计、文档统计、用户统计。
- 文档治理入口：全局文档列表、解析状态、重建索引、归档、权限范围。
- RAG 运营入口：查看 RAG 配置、索引状态、评测结果、问答记录、失败样本。
- 日志审计：登录日志、文档操作日志、AI 问答审计、管理员操作日志。
- 系统配置：模型配置、检索阈值配置、Rerank/Web Search/ASR/TTS/MCP 配置状态。
- 通知中心：解析完成、失败任务、权限变更、系统公告。

不负责：

- 直接执行切片和向量化。
- 直接读写向量库。
- 直接拼装 RAG prompt。
- 直接运行 Agent workflow。
- 直接访问 Neo4j 图谱内部写入逻辑。

## 服务调用关系

```text
admin-frontend -> admin-backend
frontend       -> rag-backend

admin-backend  -> rag-backend 只通过 HTTP API 调用
rag-backend    不调用 admin-backend
```

后台需要展示 RAG 数据时，通过 `rag-backend` 暴露的运营接口读取：

```text
GET  /api/v1/rag/admin/capabilities
GET  /api/v1/rag/admin/documents
GET  /api/v1/rag/admin/documents/:docId/chunks
GET  /api/v1/rag/admin/vector-index
GET  /api/v1/rag/admin/evaluations
GET  /api/v1/rag/admin/conversations
POST /api/v1/rag/admin/documents/:docId/reindex
POST /api/v1/rag/admin/evaluations/run
```

这些接口属于 RAG 服务对后台开放的“运营 API”，不是后台直接复用 RAG 内部模块。

## 复用与契约规则

当前阶段不建 `packages/shared`，也不提前抽公共包。

原因：

- 两个服务的业务逻辑不同，强行共享 DTO 会让后台字段变化反过来牵制 RAG 服务。
- 管理后台更偏运营管理模型，RAG 服务更偏知识检索和 Agent 执行模型，抽早了会制造假复用。
- 初期少量重复比错误抽象更便宜。

当前复用方式：

- `admin-backend` 通过 `rag-client` 调用 `rag-backend` HTTP API。
- `admin-backend` 自己维护调用 RAG 运营 API 所需的 request / response DTO。
- `rag-backend` 自己维护对外接口 DTO。
- 两边只通过接口文档和 HTTP 返回结构对齐，不共享业务代码。

不建议复制的内容：

- RAG 检索 service。
- 文档入库 service。
- Agent workflow。
- GraphRAG 写入和查询逻辑。
- 向量库 provider。
- LLM prompt 与生成链路。
- 评测执行逻辑。
- RAG 内部 DTO 到后台业务模型的整套复刻。

原因：业务 service 一旦复制，两边会很快变成“两份相似但不一致的实现”，后面修 bug、调参数、改返回结构都会变成双倍成本。

## admin-backend 建议模块

```text
admin-backend/src/
  app.module.ts
  config/
  common/
    guards/
    decorators/
    filters/
    interceptors/
    pagination/
  modules/
    auth/
    users/
    roles/
    permissions/
    dashboard/
    documents/
    search-ops/
    qa-ops/
    graph-ops/
    audit-logs/
    notifications/
    system-config/
    rag-client/
```

关键点：

- `rag-client` 只封装调用 `rag-backend` 的 HTTP client。
- 后台自己的用户、角色、权限、日志、通知由 `admin-backend` 自己管理。
- 后台文档列表可以展示来自 `rag-backend` 的文档元数据，但不直接操作 RAG 数据库。
- 后台触发重建索引、重跑评测、查看 chunk 等操作，通过 `rag-backend` 的运营 API 完成。
- AI 岗位预设由 `rag-backend` 的 `role-presets.ts` 统一维护，`admin-backend` 只代理目录并透传 `rolePresetId`；它与后台用户、RBAC 角色、权限表是两套不同概念。

## rag-backend 后续改造

当前 `backend/` 中已有 RAG 主链路，后续作为 `rag-backend` 保留并收口：

- 保留普通用户接口：上传、搜索、问答、图谱查询、记忆、语音。
- 新增 RAG 运营 API，专门给 `admin-backend` 调用。
- 删除或停止继续扩展当前临时 `backend/src/domains/admin/*` 方向。
- 不在 `rag-backend` 内继续实现完整后台用户、角色、日志、通知。

已存在的 `backend/src/domains/*` 是上一版“单后端分域”方案的过渡代码。后续拆项目时要么移除，要么仅保留 `rag` 侧别名，不作为最终后台实现方向。

## 迁移步骤

第一步：文档确认。

- 更新 `SERVICE_BOUNDARIES.md`。
- 更新 `ADMIN_FEATURES.md`。
- 更新 `ROADMAP.md`。

第二步：冻结单后端后台扩展。

- 不继续在 `backend/src/domains/admin` 里堆管理后台功能。
- 不在 RAG 服务内新增用户管理、角色管理、通知中心、审计报表。

第三步：准备 RAG 运营 API。

- 在 `rag-backend` 暴露后台需要读取和触发的最小运营接口。
- API 返回结构面向后台稳定，不暴露内部 service 细节。

第四步：新建 `admin-backend`。

- 独立 NestJS 项目。
- 先实现登录态、用户/角色只读骨架、后台大盘、RAG client。
- 再逐步补审计、通知、系统配置、运营报表。

第五步：共享契约治理。

- 当前不抽 `packages/shared`。
- `admin-backend` 的 `rag-client/dto` 只描述后台调用 RAG API 需要的字段。
- 如果后续大量接口稳定且重复维护成本真实出现，再重新评估是否抽公共契约包。
- 不为了“看起来规范”提前做 monorepo shared 包。

## 面试讲法

```text
我一开始做过单后端内部分域，因为这样最快能把 RAG 和后台入口跑起来。但继续往下推会发现管理后台和 RAG 服务的变化节奏完全不同：RAG 更关注召回、切片、引用、评测和 Agent 工作流，后台更关注用户、角色、日志、配置、统计和运营治理。如果硬放在一个服务里，后台表单和报表会污染 RAG 主链路。

所以我后面把方案调整成两个独立后端：rag-backend 专注知识库和 Agent 能力，admin-backend 专注管理后台。后台不直接 import RAG service，也不直接读向量库，而是通过 rag-backend 暴露的运营 API 查看文档、chunk、索引、评测和问答记录。当前我甚至不先抽 packages/shared，因为两个服务的业务模型不同，过早共享 DTO 会重新制造耦合。admin-backend 自己维护 rag-client 和调用 DTO，rag-backend 维护自己的接口 DTO，靠 HTTP 契约对齐。这样边界更硬，后续真有稳定重复再考虑抽公共契约。
```
