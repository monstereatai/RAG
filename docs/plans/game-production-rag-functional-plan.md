# 游戏官网／活动产研 RAG 功能增强方案

更新时间：2026-08-03

实现状态：**已完成本地工程实现与联调验证**。本方案涉及的数据库 migration 已经主人明确授权并在本地开发 PostgreSQL 执行；真实企业私有数据效果与生产部署不在本次完成口径内。

## 1. 目标

在结构保护切片基础上补齐入库质量、检索策略、上下文治理、业务元数据、文档生命周期、Bad Case 和专项评测闭环，使产品、UI、前端、后端和测试能围绕同一活动、地区和生效版本获得可追溯答案。

## 2. 改造前关键缺口

- `parentChunkId` 已进入索引，但检索命中后没有真正执行同 Section／相邻 Chunk 扩展。
- simple RAG 固定 `topK=5` 和固定候选深度，错误码查表与跨文档方案使用同一检索预算。
- 上下文按召回顺序直接拼接，没有语义去重、单文档限额、Token 预算和 Lost-in-the-Middle 排布。
- 上传只校验内容非空，没有输出解析质量、Chunk 质量、表格／代码保护和异常告警报告。
- 缺少 `projectId`、`activityId`、地区、语言、渠道、角色范围和文档类型等游戏业务过滤维度。
- 已有版本、生效期和来源权威字段，但缺少草稿／已确认／生效／废弃／被替代生命周期。
- Admin 的反馈更新接口没有持久化，所谓“负反馈”主要由拒答日志推断，不是真实用户点踩。
- 评测侧缺少专门验证标题路径、表格、接口、相邻块、版本过滤和上下文预算的 Chunk／Retrieval 数据集。

## 3. 功能方案

### 3.1 入库质量门禁

为每次入库生成质量报告：字符数、标题数、表格数、代码块数、Chunk 数、最大／平均 Chunk 长度、重复 Chunk 比例、告警和是否可入库。空内容、正文过短、严重乱码和极高重复率直接拒绝；超大原子块、普通重复和无结构长文允许入库但返回告警。

### 3.2 文档策略路由

根据文件名与正文识别 `prd`、`api`、`design`、`test`、`config`、`postmortem`、`general`。不同类型使用不同 Chunk 大小与 overlap，同时保留统一的标题路径、代码和表格保护规则。

### 3.3 层级与相邻上下文扩展

先召回叶子 Chunk，再按 `docId + sectionId` 扩展同 Section 证据，并按 `chunkIndex ± 1` 补相邻片段。扩展片段不继承命中分，只标记为 context expansion；最终仍受去重、单文档限额和 Token 预算约束。

### 3.4 自适应检索

把查询分为 `lookup`、`procedure`、`comparison`、`generation`：

- `lookup`：错误码、接口、尺寸、字段等精确问题，关键词通道优先，候选较少。
- `procedure`：流程、测试、上线检查，扩大同 Section 和相邻块。
- `comparison`：版本／地区／方案对比，提高文档多样性和候选深度。
- `generation`：技术方案、测试矩阵等综合任务，使用最大候选预算并交给 Rerank／Agentic 流程。

### 3.5 上下文治理

建立独立 Context Builder，执行内容归一化去重、每文档／Section 限额、来源多样性、字符／Token 预算和首尾交错排布。输出保留片段 ID，不在组装后重新编号，确保引用稳定。

### 3.6 游戏业务元数据与生命周期

文档和 Chunk 增加：

- `projectId`、`activityId`
- `region`、`locale`、`channel`
- `roleScope`
- `documentType`
- `lifecycleStatus`：`draft`、`confirmed`、`effective`、`deprecated`
- `supersedesDocId`

上传接口支持显式传入；未传时根据正文和文件名做保守推断。检索默认排除 `deprecated`，显式对比历史版本时允许召回。

### 3.7 Bad Case 持久化

新增反馈实体，保存 query log、会话、用户反馈、错误类型、用户说明、正确答案、召回快照、处理状态和是否进入回归集。反馈只进入待审核池，不自动注入 System Prompt。

### 3.8 专项评测与可观测

新增 Chunk／Retrieval 专项脚本，至少覆盖标题路径、空表格单元格、转义竖线、代码围栏、接口契约、测试用例、相邻块、版本／地区过滤和上下文预算。增加候选数、扩展数、去重数、最终上下文字符数和检索策略指标。

### 3.9 岗位预设与首次使用引导

系统统一保持“懂完整产研链路的业务负责人”基础身份，在其上提供业务负责人、产品、UI／UX、前端、后端、测试、活动运营和项目管理八个岗位预设。每个预设定义职责、常用任务、示例问题、回答结构和可选 `roleScope`。用户端与管理后台 QA 工作台都展示可执行入口并本地保存选择；simple、agentic、auto／AG-UI 共用同一角色目录和行为，不新增 schema。

## 4. Schema 变更

- `documents_meta`：新增游戏业务元数据、生命周期字段和入库质量报告 JSON。
- `document_chunks`：新增可用于检索过滤的业务元数据和生命周期字段。
- `rag_feedback`：新增真实反馈与 Bad Case 审核记录。

所有字段均通过 TypeORM migration 增加，不依赖 `synchronize=true`。

## 5. 实现位置

- 文档识别与质量门禁：`backend/src/modules/document/document-profile.util.ts`
- 结构保护切片：`backend/src/modules/document/chunking.util.ts`
- 入库路由与生命周期：`backend/src/modules/document/document.service.ts`
- 自适应检索与上下文扩展：`backend/src/rag/karpathy/karpathy-rag.service.ts`
- 去重、来源限额和上下文预算：`backend/src/rag/karpathy/context-builder.ts`
- ES 业务过滤：`backend/src/providers/elasticsearch/elasticsearch.provider.ts`
- 反馈与 Bad Case：`backend/src/modules/chat/rag-feedback.service.ts`
- Schema migration：`backend/src/migrations/1783200000000-AddGameProductionRagGovernance.ts`

主要接口：

- 文档上传接口支持 `projectId`、`activityId`、`region`、`locale`、`channel`、`roleScope`、`documentType`、`lifecycleStatus`、`supersedesDocId`。
- `POST /api/v1/chat` 支持 `scope` 检索范围，并在非流式回答中返回真实 `queryLogId`。
- `GET /api/v1/chat/role-presets` 返回统一岗位目录；`POST /api/v1/chat`、Chat SSE 和 AG-UI SSE 均支持 `rolePresetId`。
- `GET /api/v1/rag/admin/role-presets` 向独立管理服务提供服务令牌保护的同源目录，`GET /api/admin/qa-ops/role-presets` 负责代理，后台 AG-UI 继续透传 `rolePresetId`。
- `POST /api/v1/chat/feedback` 持久化用户反馈和服务端召回快照。
- `GET /api/v1/rag/admin/qa/feedback` 与 `PATCH /api/v1/rag/admin/qa/feedback/:id` 提供 Bad Case 查询和审核。

## 6. 验收结果

- 后端全量测试通过：28 个 Suite、135 个 Test。使用 Node 22 与 `NODE_OPTIONS=--experimental-vm-modules` 兼容 `langfuse-core` 的 ESM 动态导入。
- `backend npm run build` 与 `admin-backend npm run build` 通过。
- `backend npm run eval:game-marketing` 通过：8 份仿真业务文档、96 条问题。
- `backend npm run enterprise:readiness` 通过：12／12。
- migration `up` 已在本地开发库执行，`migration:show` 显示 3／3 已应用；`down` 已实现但未执行回滚验证，避免破坏本地数据。
- 单测覆盖精确查表、流程扩展、去重、单文档限额、上下文预算、默认排除 `deprecated`、scope 过滤与反馈快照固化。
- 真实本地 HTTP smoke 已完成：带 `projectId` 的 simple 问答返回 5 条引用和真实 `queryLogId`，反馈接口返回真实反馈 ID；管理接口未认证访问返回 401。
- Prometheus 已暴露 `rag_retrieval_context_chunks`、`rag_retrieval_context_characters`、`rag_retrieval_expanded_chunks_total`。
- 岗位预设定向测试、Chat 模式集成测试和 AG-UI 透传测试通过；真实接口返回 8 个岗位，产品经理岗位问答返回答案和真实 `queryLogId`。

## 7. 完成边界

- 当前结论是“本地工程闭环完成”，不是“主人公司真实业务准确率已达标”。96 条数据属于项目级仿真业务评测。
- 本地启动时 Milvus warmup 仍可能出现 `DEADLINE_EXCEEDED`，系统会降级到 BM25／Elasticsearch；该问题不影响本次功能闭环，但生产环境仍需独立容量与网络验证。
- 后续新增 schema、执行 migration、修改密钥或生产部署仍需再次确认，本次授权只覆盖本方案 migration。
