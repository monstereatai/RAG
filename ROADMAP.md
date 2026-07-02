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

## 当前结论

**工程成熟度：100/100 | RAG 端到端评测：92.9%（26/28）| TS 错误：0**

项目当前已从 RAG demo 推进到可运营的企业级 RAG 原型，所有无外部依赖的能力全部实现并验证：

- **rag-backend**：文档解析 → 结构化切片 → Embedding → Milvus+BM25/ES 混合检索 → Rerank → 生成 → 引用校验，全链路闭环。
- **admin-backend**：登录态/用户/角色/权限/菜单/日志/通知/配置/大盘/RAG 运营 API 代理，完整管理后台后端。
- **admin 前端**：Dashboard/Documents/SearchOps/QaOps/GraphOps/Account/System/Notification/Audit + 记忆管理页面。
- **模拟数据**：193 条评测 / 27 个本地文档文件 / 15 GraphRAG 种子 / 20 部门 / 19 个多模态登记项。
- **剩余项**：key 和部署相关仍需主人提供/确认；其他真实输入缺口均已补模拟包。

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

## 当前开放事项

### P0
- [x] **真实公司私密原件的模拟替代包**：已补 27 个脱敏本地文档文件 + 193 条业务问题集；真实原件仍只待主人私下替换，不进 git

### P1
- [x] **真实 GraphRAG 初始数据源的模拟替代包**：已补 schema/别名/初始实体关系/15 条语料，dry-run 通过；真实业务图谱仍待后续替换
- [x] **真实部门/岗位系统的模拟替代包**：已补组织同步契约、继承规则、权限回显样例；真实组织系统联调仍待数据源

### P2
- [x] **真实视觉/视频样本的模拟替代包**：已补图片 OCR sidecar、音频/视频 transcript sidecar 和 readiness 校验；真实模型 key 仍待提供

## 阻塞 / 红线

- 不修改 `.env`、密钥、token、CI/CD、生产部署 — 需主人确认
- 不执行数据库 schema 变更或迁移 — 需主人确认
- 不删除文件或 git 回滚 — 需主人确认
- 真实 key/生产环境依赖主人提供
- Node v20.18.0 当前可用，admin 工具链建议 Node 22+ 复验
- 生产目标机器/域名/证书/备份/监控接入本轮按要求不做

## 最近验证

### 2026-07-02

- **Admin GraphOps 节点编辑**：`/graph-ops/nodes` 增加节点编辑入口和弹窗，支持编辑节点类型、别名、来源、属性 JSON；新增 admin-backend `PATCH /api/admin/graph-ops/nodes/:id` 代理和 rag-backend `PATCH /api/v1/rag/admin/graph/entities/:id`，真实 Neo4j 可持久化更新；节点 ID 保持只读，避免破坏关系边；`backend npm run build` ✅；`admin-backend npm run build` ✅；`admin-backend npm run lint` ✅（仅既有 warning）；`admin npm run lint` ✅（仅既有 warning）；Chrome headless 验证节点页可见编辑按钮且弹窗可回填 ✅；演示 mock 节点保存返回 503，不假装持久化 ✅
- **Admin GraphOps 图上直接编辑**：全局图谱画布节点支持双击打开同一节点编辑弹窗，SVG tooltip 提示“双击编辑”；复用节点编辑保存链路，不新增第二套逻辑；`admin npm run lint` ✅（仅既有 warning）；Chrome headless 验证双击 `LangChain` 节点打开编辑弹窗且类型回填 `Framework` ✅
- **一线大厂差距清单补齐**：新增 `docs/remaining-enhancement-plan.md`，把大厂生产可用差距拆成已本地补齐、必须外部输入、RAG 质量/数据链路/权限安全/可观测/运维验收口径，避免 ROADMAP 继续膨胀；新增 `backend npm run enterprise:readiness` 只读检查脚本，统一检查私密模拟集、GraphRAG、组织权限、多模态、部署清单、smoke/质量/性能脚本；`backend npm run enterprise:readiness` ✅（本地 11/11，通过；外部剩余：真实业务原件/毒题集、真实组织系统、真实 GraphRAG 数据源、真实视觉/视频 key、真实资源压测、生产环境、安全合规口径）
- **pnpm 依赖版本固定**：主项目 package（backend/admin/admin-backend/frontend/rag-cli/admin cloudflare-worker）扫描通过，依赖声明不再包含 `^`/`~` 范围符号；固定 `@nestjs/bullmq`、`bullmq`、`multer`、worker 依赖和 devDependencies；新增 `backend/pnpm-workspace.yaml` 承接 pnpm 11 overrides，移除废弃 `package.json#pnpm` 配置；同步 backend/admin-backend lockfile；未修改 agent-course/agent-cursor 示例目录；`backend pnpm install --frozen-lockfile --ignore-scripts` ✅；`admin-backend pnpm install --frozen-lockfile --ignore-scripts` ✅；`pnpm --dir admin/cloudflare-worker install --lockfile-only --ignore-scripts` ✅

### 2026-07-01

- **工程成熟度：100/100**（初始 75 → 最终 100）
- **RAG 端到端评测：92.9%**（26/28 通过，含 SWE 技术规范）
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
