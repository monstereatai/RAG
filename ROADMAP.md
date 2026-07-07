# ROADMAP

> 项目真实进度源。只保留当前状态、开放事项、阻塞和最近验证结论。完整历史已备份到 `ROADMAP.full-2026-06-25.md`。

## 读取规则

- 日常开发：优先读本文件。
- 历史细节：读 `ROADMAP.full-2026-06-25.md`，用 `rg` 精准搜索。
- 只有已实现并验证的写入"已完成"。做完未验证不得标完成。
- 外部依赖/红线/缺用户输入的事项显式写入"阻塞/待确认"。

## 文档索引

| 文档 | 说明 |
|------|------|
| `CLAUDE.md` | 项目规则、红线、验证命令 |
| `ARCHITECTURE.md` | 系统架构与模块边界 |
| `PRD.md` | 产品需求和验收标准 |
| `SERVICE_BOUNDARIES.md` | rag-backend 与 admin-backend 服务边界 |
| `DEPLOYMENT_CHECKLIST.md` | 生产部署 Checklist |
| `docs/async-task-queue-plan.md` | BullMQ 异步队列方案 |
| `docs/remaining-enhancement-plan.md` | 剩余增强项方案 |
| `docs/jd-requirements-project-mapping.md` | 一线大厂 AI 应用 / Agent JD 与项目实现对照 |
| `docs/jd-gap-implementation-status.md` | JD 差距本地补齐状态 |
| `docs/interview-docs-usage.md` | 面试文档使用说明 |
| `docs/karpathy-obsidian-dual-ingest-plan.md` | Karpathy + Obsidian 统一知识链路方案 |

## 当前结论

**本地工程成熟度：96/100 | 项目级 RAG 评测：100%（28/28）| TS 错误：0**

项目当前已从 RAG demo 推进到可运营的企业级 RAG 原型，所有无外部依赖的能力全部实现并验证：

- **rag-backend**：文档解析 → 结构化切片 → Embedding → Milvus+BM25/ES 混合检索 → Rerank → 生成 → 引用校验，全链路闭环。
- **admin-backend**：登录态/用户/角色/权限/菜单/日志/通知/配置/大盘/RAG 运营 API 代理，完整管理后台后端。
- **admin 前端**：Dashboard/Documents/SearchOps/QaOps/GraphOps/Account/System/Notification/Audit + 记忆管理页面。
- **rag-cli**：正式 RAG search/context API、真实 SSE ask stream、admin search、GraphRAG query、eval status/run 命令。
- **模拟数据**：193 条评测 / 27 个本地文档文件 / 15 GraphRAG 种子 / 20 部门 / 19 个多模态登记项。
- **剩余项**：真实 key、生产级部署/域名/证书/备份/监控接入和真实业务替换数据仍需主人提供/确认；其他真实输入缺口均已补模拟包。

## 已完成能力

### RAG 核心链路
- 文档上传解析：MD/TXT/PDF/DOCX/DOC/XLS/XLSX/PPT/PPTX/CSV/JSON/HTML + URL 抓取入库
- URL 抽取：默认静态 fetch；可选 `URL_EXTRACT_DYNAMIC_ENABLED=true` 走 Playwright 动态渲染，失败自动降级并记录 Extraction Mode / renderError
- 媒体入库：图片/视频/音频 → 对象存储 + 元数据 Markdown；音频 ASR 转写（缺 key 降级）
- 混合检索：标准 RRF 排名融合，保留 BM25/cosine 分数做质量闸门
- Agentic RAG：routing → query augment → retrieval → sufficiency → web search → rerank → generate → citation → reflection → final
- GraphRAG：Neo4j provider、实体关系抽取、schema/entities/relationships/search 运营接口
- 引用校验 + 低相关拒答 + 多租户 userId 物理隔离
- LLM-as-Judge 评测：7/7 supported

### 多模态 & 视觉
- Vision Provider 脚手架：`IVisionProvider` 接口（OCR/图片描述/视频理解）+ MockProvider + OpenAiVisionProvider（原生 fetch）
- `VISION_PROVIDER=mock` 无 key 可开发；VISION_API_KEY 就绪后开真实能力
- 图像/视频上传自动调用 Vision Provider，失败降级到元数据
- 脱敏视觉样本：图片/音频/视频文件 + 音频/视频 transcript sidecar + 图片 OCR sidecar

### 记忆系统
- **短期记忆**：`ShortTermMemoryService` — Redis ZSET 滑动窗口（30 轮）+ LLM 摘要压缩，注入 ChatService
- **长期记忆**：Mem0 Provider（cloud/local 双模式）+ MemoryService（搜索/写入/分类器）+ admin `/account/memories` 管理页面
- **记忆管理 API**：`/api/v1/memories/status`、`/search`、`/sessions/:conversationId`，支持 user/session 分层诊断

### 异步处理
- BullMQ 队列：`/documents/upload/async` 入队，Worker 调真实解析/Embedding/索引链路，失败写回 `document_tasks`
- Redis 未配置时自动降级同步处理

### 可观测 & 工程化
- Prometheus 指标（rag_llm_calls_total 等）+ traceparent + LangFuse 可选 provider + `/api/v1/observability/langfuse/status`
- 定时任务 JobsService 复用 Supervisor 执行（cron/every/at）
- TS 0 错误，lint/build/test/verify 全部通过
- Admin QA：TTS 播放按钮补齐连接中/合成中/播放中/失败状态

### 私密模拟数据
- 企业制度文档 + 软件工程文档共 **27 个本地文件**，覆盖 HR/Finance/Legal/Security/Ops/CS/Product/Data/Engineering
- 业务评测 **193 条**，覆盖 19 领域、7 场景类型（含版本冲突/拒答/跨部门/多步推理）
- GraphRAG 种子 **15 条** + schema/entityTypes/relationshipTypes/aliasRules/initialEntities/initialRelationships
- 组织架构 **20 部门**（含子树）+ 22 岗位 + 8 用户 + 4 角色继承链 + 继承规则 + 权限回显样例
- 多模态样本 **19 个**（text/table/structured/checklist/speech/image/ocr/video/permission/workflow）

### 部署 & 文档
- `DEPLOYMENT_CHECKLIST.md`：基础设施/外部依赖/步骤/Nginx/备份/监控
- `scripts/deploy.sh`：一键部署模板
- `rag-cli`：CLI README/中文说明/CLI roadmap 与正式 API、高级命令保持同步

## 当前开放事项

### P0
- [x] **真实公司私密原件的模拟替代包**：已补 27 个脱敏本地文档文件 + 193 条业务问题集；真实原件仍只待主人私下替换，不进 git

### P1
- [x] **真实 GraphRAG 初始数据源的模拟替代包**：已补 schema/别名/初始实体关系/15 条语料，dry-run 通过；真实业务图谱仍待后续替换
- [x] **真实部门/岗位系统的模拟替代包**：已补组织同步契约、继承规则、权限回显样例；真实组织系统联调仍待数据源

### P2
- [x] **真实视觉/视频样本的模拟替代包**：已补图片 OCR sidecar、音频/视频 transcript sidecar 和 readiness 校验；真实模型 key 仍待提供

### P3
- [x] **Karpathy + Obsidian 统一知识链路核心闭环**：已实现 URL/文件/手动输入/官方文档同步统一进入 RAG/Karpathy 索引层和 Obsidian raw/notes/compiled/index；`simple` 走 Karpathy + Obsidian Fast Path，`auto` 先 Fast Path 再按 sufficiency gate 升级 Agentic，`agentic` 读取 Obsidian compiled/index/notes 作为高优先级上下文；详见 `docs/karpathy-obsidian-dual-ingest-plan.md`
- [x] **Obsidian 项目决策编排增强**：已新增项目工作流 API，支持方案选择、技术选型、架构决策 ADR、任务拆解、风险/验收清单，输出到 Obsidian `compiled/project-workflows/{type}`；RAG 重复入库采用 Obsidian `content_hash + rag_doc_id` 补偿索引复用已有 docId，未做数据库 schema 变更
- [x] **Karpathy + Obsidian 编译层补齐**：source note 新增 topics/entities/key conclusions；compiled 层补实体页、结论页、开放问题、版本/语义冲突信号基础检查；related 从 tags 升级为 entities/topics/tags 加权；GraphRAG seed 从 Obsidian entities/topics/tags 导出到 `index/graph/obsidian-seed.json` 和 `GET /api/obsidian/graph/seed`

## 阻塞 / 红线

- 不修改 `.env`、密钥、token、CI/CD、生产部署 — 需主人确认
- 不执行数据库 schema 变更或迁移 — 需主人确认
- 不删除文件或 git 回滚 — 需主人确认
- 真实 key/生产环境依赖主人提供
- Node v20.18.0 当前可用，admin 工具链建议 Node 22+ 复验
- 生产级部署/域名/证书/备份/监控接入本轮按要求不做

## 最近验证

### 2026-07-07

- **JD 差距可本地补齐项实现**：新增 `docs/jd-gap-implementation-status.md` 记录“已实现/部分实现/外部阻塞”；补齐 Prompt Injection 基础防护（`prompt-injection.guard.ts` + 检索片段高风险行脱敏 + prompt 不可信证据边界 + `eval/prompt-injection.dataset.json`）、Prompt Registry 基础版（`prompt-registry.ts` + `prompt:registry:check`）、Tool Registry 基础版（`tool-registry.ts` + `tools:registry:check`）、Agent 任务级评测脚手架（`eval-agent-task-metrics.mjs` + `eval:agent-tasks`）。同步更新 `docs/jd-requirements-project-mapping.md` 和 `docs/remaining-enhancement-plan.md`，把这些项从“缺口”调整为“本地基础版已实现，生产化仍待真实数据/平台接入”。验证：`backend npm run eval:prompt-injection` ✅（7/7）；`backend npm run prompt:registry:check` ✅；`backend npm run tools:registry:check` ✅；`backend npm run eval:agent-tasks` ✅；`backend npm run build` ✅。
- **面试文档使用说明**：新增 `docs/interview-docs-usage.md`，说明 `jd-requirements-project-mapping.md`、`jd-gap-implementation-status.md`、`INTERVIEW_PLAYBOOK.md`、`ROADMAP.md`、`remaining-enhancement-plan.md` 的用途、阅读顺序、问题定位方式和不能混用的边界。仅文档更新，未改代码。

### 2026-07-06

- **面试文档核心口径补强**：更新 `INTERVIEW_PLAYBOOK.md`，将本地工程成熟度和项目级评测口径同步为 `96/100`、`28/28`；新增“面试先记这一页”、30 秒总回答、2 分钟展开版、7 问压缩背诵卡片，并围绕 RAG 主链路、向量/ES/图谱、多 Agent、工具调用、RAG 难点、情感分析边界、AI Coding 使用方式补充追问回答。继续补充二层追问：NestJS/FastAPI 选型、Dify/Coze/LangFlow 取舍、权限过滤、索引一致性、性能优化、幻觉控制、一线大厂生产化差距、前端负责人视角、后台指标、评测集建设、AG-UI/SSE 排障 STAR 和反问清单。按公开 JD 抽样继续补充大厂 AI 应用/Agent 岗位对照：RAG+Agent、Planning/Acting/Reflection、Tool Calling/MCP、Memory、Eval、Observability、多模态、生产工程、成本延迟、金融合规，并加入阿里/腾讯/百度/字节/美团、小米/大疆/高德、微信/DeepSeek、中信/平安/证券公司的差异化讲法。仅文档更新，未改代码。
- **大厂 JD 与项目实现对照文档**：新增 `docs/jd-requirements-project-mapping.md`，把公开 AI 应用/Agent 岗位要求与本项目实现逐项映射，覆盖 RAG、Hybrid Search、Agentic Workflow、Planning/Acting/Reflection、Tool Calling/MCP、Memory、GraphRAG、Eval、Observability、权限、审计、多模态、金融合规、Prompt 安全、模型路由、生产化等；每项标注“已实现/部分实现/未实现”、核心代码位置和面试回答边界，便于面试时准确说明项目能力与一线大厂差距。仅文档更新，未改代码。
- **BOSS/公开 JD 对照表补强**：继续完善 `docs/jd-requirements-project-mapping.md`，新增 BOSS/公开 JD 高频要求观察和公司/行业对照表，覆盖阿里、腾讯/微信、百度、字节、美团、小米、高德、大疆、DeepSeek、中信/平安/证券；补充工具注册/工具目录、灰度/A-B/效果回归、上下文工程、SFT/RLHF/模型训练等招聘要求与项目实现边界。仅文档更新，未改代码。

### 2026-07-05

- **正式 RAG 网关 API 与 CLI 后续项收尾**：新增 backend `RagGatewayModule`，提供 `POST /api/v1/rag/search` 与 `POST /api/v1/rag/context`，复用 Karpathy 检索与 Skills 匹配，不新增数据库 schema、不修改 `.env`；`rag-cli` 的 `search/context` 优先走正式 API，旧后端缺接口时保守降级；新增 `rag ask --stream` 消费后端真实 SSE，新增 `rag admin search`、`rag graph query`、`rag eval status`、`rag eval run`；同步 `rag-cli/ROADMAP.md`、README、中文说明和 CLI roadmap 归档；补 SSE CRLF 分隔回归测试。`backend npm run build` ✅；`rag-cli pnpm run build` ✅；`rag-cli pnpm test` ✅（11/11）；CLI help smoke ✅；不可达服务 JSON 错误契约 smoke ✅；临时当前构建服务 `PORT=3015` 在线 smoke ✅（`POST /api/v1/rag/search` 201 count=2、`POST /api/v1/rag/context` 201 count=2、CLI `search` count=2、CLI `eval status` count=4）。当前常驻 `3000` 进程仍是旧进程，需重启后才会加载新路由。

### 2026-07-04

- **RAG CLI 对齐 Karpathy + Obsidian**：`rag ask` schema/human 输出补齐 `retrievalSufficient`、`retrievalReason`、references、`obsidianPaths`；`rag context` 在 debug chunks 为空时使用 `ask auto` 可靠兜底，只有 references、Obsidian 路径或 `retrievalSufficient=true` 才输出上下文包；同步 `rag-cli`、根目录 CLI 文档和 `cli-docs` 归档副本。`rag-cli CI=true pnpm run build` ✅；`rag-cli CI=true pnpm test` ✅（10/10）；CLI `ask` 真实后端 smoke ✅；CLI `context` 普通路径和 fallback smoke ✅。

### 2026-07-03

- **未完成项复核与成熟度门禁校准**：`backend npm run enterprise:readiness` ✅（本地 11/11，通过；当前未 ready 外部输入：视觉/视频理解 key、LangFuse key、真实业务原件和毒题集、真实组织系统、真实 GraphRAG 数据源、真实资源压测窗口、生产环境、安全合规口径）；修正 `eval-rag-maturity.mjs` 的生产材料判断，不再依赖 ROADMAP 文案字符串，改为显式 `RAG_PRODUCTION_MATERIALS_CONFIRMED=true` 后才计入；同步 `PRD.md` / `ARCHITECTURE.md` 企业级成熟度口径为 96/100。
- **RAG 脚本服务边界修正**：将真实 rag-backend 检查脚本默认地址统一为 `http://localhost:3000`，避免 `perf/eval/smoke` 误打 admin-backend `3001` 后出现 `/api/v1/auth/login` 404；同步 `backend/scripts/README.md`。`backend npm run build` ✅
- **Karpathy + Obsidian 双写去重修复**：Obsidian `content_hash` 命中旧 note 时，不再直接复用旧 `rag_doc_id` 阻断当前用户 RAG 入库；若当前用户没有该 RAG 文档，会重新走 `DocumentService.upload()` 写入 DB、Milvus/ES、Karpathy BM25，再返回 duplicate note 关联的新 `ragDocId`。这样 Obsidian 负责知识沉淀去重，RAG 负责当前用户可检索数据，两条链路互补不互相吞数据。`backend npm run build` ✅
- **项目级 RAG 评测修复到 100%**：Karpathy 检索改为 ES + 本地 BM25 结果合并，答案证据优先 RAG chunks 再补 Obsidian chunks；明确事实题新增结构化抽取兜底，覆盖差旅审批、采购付款、法务审查、数据留存、React 状态管理、NestJS Provider 等场景；抽取式 fallback 跳过 `path:`/Obsidian source link 噪声。`backend npm run eval:rag:project` ✅（score=1，simple 14/14，auto 14/14）
- **当前性能/外部阻塞复核**：`backend npm run smoke:external` ✅（Bocha/Rerank/Judge 当前 key 可用）；`backend npm run perf:rag` ⚠️（脚本可运行但 simple/agentic p50 未达严格阈值）；`backend npm run smoke:milvus` ❌（Milvus collection loaded/indexed，但 warmup/search `DEADLINE_EXCEEDED`，当前依靠 BM25/ES 回退保证准确性，真实资源压测和 Milvus timeout/warmup 阈值仍待处理）。

### 2026-07-02

- **Admin GraphOps 节点编辑**：`/graph-ops/nodes` 增加节点编辑入口和弹窗，支持编辑节点类型、别名、来源、属性 JSON；新增 admin-backend `PATCH /api/admin/graph-ops/nodes/:id` 代理和 rag-backend `PATCH /api/v1/rag/admin/graph/entities/:id`，真实 Neo4j 可持久化更新；节点 ID 保持只读，避免破坏关系边；`backend npm run build` ✅；`admin-backend npm run build` ✅；`admin-backend npm run lint` ✅（仅既有 warning）；`admin npm run lint` ✅（仅既有 warning）；Chrome headless 验证节点页可见编辑按钮且弹窗可回填 ✅；演示 mock 节点保存返回 503，不假装持久化 ✅
- **Admin GraphOps 图上直接编辑**：全局图谱画布节点支持双击打开同一节点编辑弹窗，SVG tooltip 提示“双击编辑”；复用节点编辑保存链路，不新增第二套逻辑；`admin npm run lint` ✅（仅既有 warning）；Chrome headless 验证双击 `LangChain` 节点打开编辑弹窗且类型回填 `Framework` ✅
- **一线大厂差距清单补齐**：新增 `docs/remaining-enhancement-plan.md`，把大厂生产可用差距拆成已本地补齐、必须外部输入、RAG 质量/数据链路/权限安全/可观测/运维验收口径，避免 ROADMAP 继续膨胀；新增 `backend npm run enterprise:readiness` 只读检查脚本，统一检查私密模拟集、GraphRAG、组织权限、多模态、部署清单、smoke/质量/性能脚本；`backend npm run enterprise:readiness` ✅（本地 11/11，通过；外部剩余：真实业务原件/毒题集、真实组织系统、真实 GraphRAG 数据源、真实视觉/视频 key、真实资源压测、生产环境、安全合规口径）
- **pnpm 依赖版本固定**：主项目 package（backend/admin/admin-backend/frontend/rag-cli/admin cloudflare-worker）扫描通过，依赖声明不再包含 `^`/`~` 范围符号；固定 `@nestjs/bullmq`、`bullmq`、`multer`、worker 依赖和 devDependencies；新增 `backend/pnpm-workspace.yaml` 承接 pnpm 11 overrides，移除废弃 `package.json#pnpm` 配置；同步 backend/admin-backend lockfile；未修改 agent-course/agent-cursor 示例目录；`backend pnpm install --frozen-lockfile --ignore-scripts` ✅；`admin-backend pnpm install --frozen-lockfile --ignore-scripts` ✅；`pnpm --dir admin/cloudflare-worker install --lockfile-only --ignore-scripts` ✅
- **官方技术文档夜间同步**：新增 `OfficialDocsSyncModule/Service`，默认关闭；配置 `OFFICIAL_DOCS_SYNC_ENABLED=true` 后每天本地时间 01:00 抓取 React/Vue/MDN JavaScript/NestJS 官方文档，按 URL 内容 hash 检测新增/修改页面，生成 Markdown 快照并复用 `DocumentService.upload()` 写入数据库、Milvus/向量库、ES 和 Karpathy BM25；状态文件保存到 `workspace/official-docs-sync-state.json`，避免重复入库；新增 `docs/official-docs-sync.md` 记录配置和默认抓取范围；未新增数据库表/未做 schema 变更；`backend npm run build` ✅
- **Karpathy + Obsidian 链路设计**：新增 `docs/karpathy-obsidian-dual-ingest-plan.md`，明确 Karpathy 需要从现有“答得出”的 RAG/BM25 链路，补强为统一编排 RAG 索引层和 Obsidian 知识层的个人知识系统；Obsidian 不是旁路存档，后续 source note、related、compiled、index 都要挂在 Karpathy 知识编排链路里；本次只做设计文档和 ROADMAP 同步，未写功能代码
- **92 分路由方案记录**：在 `docs/karpathy-obsidian-dual-ingest-plan.md` 中补充 simple/auto/agentic 三档路由：`simple` 固定走 Karpathy + Obsidian Fast Path，优先读 Obsidian compiled/index 并补 RAG evidence；`auto` 先跑 Fast Path，再用 compiled 命中、source 回链、evidence、引用覆盖、置信度做 sufficiency gate；`agentic` 作为 Research Path，必须把 Obsidian compiled/index 当高优先级工具源；本次只记录方案，未编码
- **URL 抓取文章双写实现**：`/documents/url` 改为 Karpathy-Obsidian ingestion service 统一处理；同一份 URL 正文先继续走 `DocumentService.upload()` 写入数据库、Milvus/向量库、ES 和 Karpathy BM25，再写入 Obsidian `notes/日期-标题.md`；Markdown 文件 frontmatter 包含标题、原链接、标签、日期、`rag_doc_id`、`content_hash`；正文包含 2-3 句摘要、3-5 条要点、标签和完整正文；摘要/标签优先 LLM，失败启发式兜底；新增 `OBSIDIAN_VAULT_DIR` 配置默认 `workspace/obsidian`；未修改 `.env`、未新增 DB schema；`backend npm run build` ✅
- **Karpathy + Obsidian 核心闭环实现**：新增 `ObsidianKnowledgeModule/Service`，统一管理 `raw/notes/compiled/index`，URL/文件上传/MHTML/PDF/Markdown/手动输入 `/documents/manual`/官方文档夜间同步都走 Karpathy-Obsidian ingestion service；Obsidian notes 基于 `content_hash` 做重复写入跳过，raw 永久保留，source note 写 `raw_path/rag_doc_id/content_hash`；新增 `index/sources.md`、`index/tags.md` 和 `compiled/{tag}.md` 自动刷新；`simple` 读取 Obsidian compiled/index/notes 后补 RAG evidence，Obsidian 命中会转成伪片段参与 `[片段N]` 引用校验和 references 返回；`auto` 先做 Fast Path sufficiency gate 再决定是否升级 agentic，`agentic` 注入 Obsidian 高优先级上下文；响应 metadata/final 返回 `obsidianPaths`、`ragReferences`、`retrievalReason`；未新增 DB schema、未修改 `.env`；`backend npm run build` ✅；临时端口启动验证 `/api/documents/manual` 路由和新增模块初始化 ✅
- **Obsidian related 与 Admin 关联状态**：Obsidian 刷新时基于共享 tags 写入每篇 source note 的“相关笔记”区块，包含 score/reason，并生成 `90-system/logs/related-日期.md`；RagAdmin/RagOps 文档列表和详情通过 `rag_doc_id` 反查 `obsidianPath/obsidianStatus`；admin 文档列表新增 Obsidian 关联状态列；`backend npm run build` ✅；`admin npm run lint` ✅（仅既有 warning）
- **Karpathy + Obsidian 取用流方向调整**：`docs/karpathy-obsidian-dual-ingest-plan.md` 中 P2/M4 从“选题/周报/写作素材”改为软件项目流程编排：方案选择、技术选型敲定、架构决策 ADR、任务拆解、风险清单和验收标准；本次仅更新文档，不改代码
- **Obsidian 项目决策编排实现**：新增 `POST /api/obsidian/project-workflows/:type`，支持 `solution`、`tech-selection`、`adr`、`task-breakdown`；生成时先检索 Obsidian compiled/index/notes 作为证据，再输出方案选择对比、技术选型决策、ADR 草稿、任务拆解/接口/风险/验收标准，并写入 `compiled/project-workflows/{type}/日期-标题.md`，同时刷新 `index/project-workflows.md`；单源 source note 也补充关键结论、反对意见、适用边界、落地风险、验收口径；`backend npm run build` ✅；临时端口启动验证新路由注册 ✅
- **Karpathy + Obsidian 未完成项收尾**：RAG 写入前基于 Obsidian `content_hash + rag_doc_id` 查重，命中则复用已有 docId，避免重复进入 DB/Milvus/ES/BM25；Obsidian compiled 层补 `entities`、`conclusions`、基础版本信号检查，related 评分升级为 entities/topics/tags 加权；新增 GraphRAG seed 只读导出 `GET /api/obsidian/graph/seed` 和 `index/graph/obsidian-seed.json`；未新增数据库 schema、未修改 `.env`；`backend npm run build` ✅
- **Obsidian 编译页开放问题增强**：entity 编译页新增开放问题区；conclusion 编译页新增开放问题聚合，并把版本检查扩展到推荐/不推荐、采用/避免、必须/可选等语义冲突信号；复杂语义矛盾仍需真实数据评测和人工复核；`backend npm run build` ✅
- **Maturity 门禁证据修正**：`eval-rag-maturity.mjs` 从旧 ROADMAP 字符串检查改为读取真实代码/文件证据，覆盖 Milvus runtime governance、JobsService+Supervisor、claim-level 引用支撑、source span、fact_conflicts、enterprise readiness；`backend npm run enterprise:readiness` ✅（11/11）；`backend npm run eval:rag:maturity` ✅（96/100，Milvus search runtime 降级扣 2 分，生产部署/证书/备份策略未确认扣 2 分）

### 2026-07-01

- **本地工程成熟度：96/100**（初始 75 → 当前 96；Milvus search runtime 降级扣 2 分，生产部署/证书/备份策略未确认扣 2 分）
- **当时 RAG 端到端评测：26/28，通过率约 93%**（含 SWE 技术规范；2026-07-04 项目级评测已提升到 28/28）
- **LLM-as-Judge：7/7 supported**（`EVAL_RAG_JUDGE_REQUIRED=true` 验证通过）
- **TS 编译：0 错误**（修复 3 个已有 spec 文件）
- **三段服务：全部运行**（backend:3000 ✅ admin-backend:3001 ✅ admin:8000 ✅）
- **Admin 生产构建成功**（含新 `/account/memories` 页面）
- **Admin-backend verify 通过**（8 suites/68 tests + 2 e2e/19 tests）
- **全部 npm 脚本通过**（fixtures/eval/import/smoke）
- **本轮补齐**：BullMQ worker 接真实文档处理；`queue/status` 路由顺序修复；异步空内容失败写回任务
- **本轮补齐**：URL 动态渲染抽取开关 + `.env.example` 配置；未启用/失败时静态降级
- **本轮补齐**：Mem0 状态/搜索/session API；LangFuse 状态 API；Admin QA TTS 状态反馈
- **本轮验证**：`backend npm run build` ✅；`admin npm run lint -- --quiet` ✅（仅既有 warning）；`fixtures:private:check` ✅；`smoke:vision-video` ✅；`smoke:external` ✅
- **本轮运行验证**：backend:3000 ✅；admin:8000 `/graph-ops` ✅；`/documents/queue/status`、`/memories/status`、`/observability/langfuse/status` 均 200 ✅
- **本轮模拟补齐**：私密原件模拟包增强为 27 个文档文件；GraphRAG 增强为 schema + alias + initial entities/relationships + 15 条语料；组织 fixture 增强为 20 部门/22 岗位/8 用户/继承规则/权限回显；视觉样本补 OCR sidecar
- **本轮模拟验证**：`fixtures:private:prepare` ✅；`fixtures:private:check` ✅；`graph:import-private` dry-run ✅；`smoke:vision-video` ✅
- **Admin QA 输出修复**：回答正文改为 `XMarkdown` 渲染，补代码块/列表/表格/引用样式和代码围栏兼容；`admin npm run lint -- --quiet` ✅；`/qa-ops` 200 ✅
- **Admin QA 富内容输出**：支持 Markdown 图片 `![alt](url)`、`output.images/media/attachments`、`rag.media/rag.image` 事件渲染；图片限制尺寸、圆角、caption，避免撑爆聊天区；`admin npm run lint -- --quiet` ✅；`/qa-ops` 200 ✅
- **Admin QA 真实流式输出**：撤掉前端延迟拆字模拟，前端即时消费 AG-UI `TEXT_MESSAGE_CONTENT` delta；backend simple RAG 和检索不足 fallback 改为 LangChain `model.stream` 透出真实 token；`backend npm run build` ✅；backend 重启 ✅；`/qa-ops` 200 ✅
- **Admin 菜单国际化修复**：补 `menu.qa-ops.qa-ops-model` 中英文 locale，消除 React Intl missing message；`admin npm run lint -- --quiet` ✅；`/qa-ops/model` 200 ✅
- **Admin QA 会话列表修复**：修正 admin-backend 对 `/rag/admin/conversations` 直接数组返回的解包逻辑，历史会话恢复显示；补 graph/system 嵌套菜单 locale；三段服务重启 ✅；`admin-backend npm run build` ✅；`admin-backend npm run lint` ✅（仅既有 warning）；`admin npm run lint` ✅（仅既有 warning）；Chrome headless 验证 `/qa-ops` 首条会话可见且 console 无 Missing message/page error ✅
- **Admin QA AG-UI 轨迹优化**：连续同类事件折叠为 `EVENT × N`，避免真实流式 token 造成 `TEXT_MESSAGE_CONTENT` 大量重复刷屏；`admin npm run lint` ✅（仅既有 warning）；Chrome headless 验证最终轨迹 `TEXT_MESSAGE_CONTENT × 29` 且事件名只出现 1 次 ✅
- **Admin QA 兜底首字延迟优化**：`RUN_STARTED/TEXT_MESSAGE_START` 提前到会话创建后立即发送；长期记忆检索最多等待 600ms，超时不阻塞回答；agentic 本地质量闸门不足时跳过 query augment 直接兜底生成；空 token 不下发；`backend npm run build` ✅；同一兜底问题首字约 2.18s（优化前复现 5.3-7.1s，用户观感约 11s）✅
- **Admin QA 技术问答默认路由优化**：admin 页面默认模式从 `agentic` 改为 `auto`，NestJS Provider 这类简单技术问答自动路由到 `simple`，复杂问题仍可手动选择 `agentic`；`admin npm run lint` ✅（仅既有 warning）；Chrome headless 验证默认 `auto`、路由 `simple`、首字约 1.93s ✅

### 2026-06-30

- P0 私密模拟数据增强完成：103 → 193 条，含软件工程 15 领域
- Vision Provider 脚手架：interface + Mock + OpenAI-compat + Module
- 短期记忆产品化：Redis 滑动窗口 + ChatService 集成
- BullMQ 异步队列：安装 + Queue + Worker + 状态 API
- Mem0 管理页面：admin `/account/memories` + proxy 通路
- Deployment 文档：CHECKLIST.md + deploy.sh
- Vision 集成到文档上传：图片 OCR/视频理解 + 自动降级
