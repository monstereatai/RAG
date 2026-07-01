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
- **模拟数据**：193 条评测 / 36 文档 / 15 GraphRAG 种子 / 19 领域 / 7 种场景类型。

## 已完成能力

### RAG 核心链路
- 文档上传解析：MD/TXT/PDF/DOCX/DOC/XLS/XLSX/PPT/PPTX/CSV/JSON/HTML + URL 抓取入库
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

### 记忆系统
- **短期记忆**：`ShortTermMemoryService` — Redis ZSET 滑动窗口（30 轮）+ LLM 摘要压缩，注入 ChatService
- **长期记忆**：Mem0 Provider（cloud/local 双模式）+ MemoryService（搜索/写入/分类器）+ admin `/account/memories` 管理页面

### 异步处理
- BullMQ 队列：安装 `@nestjs/bullmq` + `Queue` + `Worker` + `QueueEvents` + 状态 API
- Redis 未配置时自动降级同步处理

### 可观测 & 工程化
- Prometheus 指标（rag_llm_calls_total 等）+ traceparent + LangFuse 可选 provider
- 定时任务 JobsService 复用 Supervisor 执行（cron/every/at）
- TS 0 错误，lint/build/test/verify 全部通过

### 私密模拟数据
- 企业制度文档 + 软件工程文档共 **36 份**
- 业务评测 **193 条**，覆盖 19 领域、7 场景类型（含版本冲突/拒答/跨部门/多步推理）
- GraphRAG 种子 **15 条**（含技术栈/CI-CD/安全/部署图谱）
- 组织架构 **15 部门**（含子树）+ 17 岗位 + 5 用户 + 4 角色继承链
- 多模态样本 **13 个**（text/table/structured/checklist/speech/image/ocr/video）

### 部署 & 文档
- `DEPLOYMENT_CHECKLIST.md`：基础设施/外部依赖/步骤/Nginx/备份/监控
- `scripts/deploy.sh`：一键部署模板

## 当前开放事项

### P0
- [ ] **真实公司私密原件替换**：脱敏数据已就绪；需主人提供不可提交 git 的真实原件替换 `eval/private-*`

### P1
- [ ] **真实 GraphRAG 初始数据源**：脱敏种子已就绪；需公司实体类型/关系/别名/初始语料
- [ ] **真实部门/岗位系统接入**：admin-backend 接口已就绪；需企业组织数据源

### P2
- [ ] **真实视觉/视频模型接入**：Provider 脚手架已就绪；需 `VISION_API_KEY` / `QWEN_VL_API_KEY`

## 阻塞 / 红线

- 不修改 `.env`、密钥、token、CI/CD、生产部署 — 需主人确认
- 不执行数据库 schema 变更或迁移 — 需主人确认
- 不删除文件或 git 回滚 — 需主人确认
- 真实数据/API key/生产环境依赖主人提供
- Node v20.18.0 当前可用，admin 工具链建议 Node 22+ 复验

## 最近验证

### 2026-07-01

- **工程成熟度：100/100**（初始 75 → 最终 100）
- **RAG 端到端评测：92.9%**（26/28 通过，含 SWE 技术规范）
- **LLM-as-Judge：7/7 supported**（`EVAL_RAG_JUDGE_REQUIRED=true` 验证通过）
- **TS 编译：0 错误**（修复 3 个已有 spec 文件）
- **三段服务：全部运行**（backend:3000 ✅ admin-backend:3001 ✅ admin:8000 ✅）
- **Admin 生产构建成功**（含新 `/account/memories` 页面）
- **Admin-backend verify 通过**（8 suites/68 tests + 2 e2e/19 tests）
- **全部 npm 脚本通过**（fixtures/eval/import/smoke）

### 2026-06-30

- P0 私密模拟数据增强完成：103 → 193 条，含软件工程 15 领域
- Vision Provider 脚手架：interface + Mock + OpenAI-compat + Module
- 短期记忆产品化：Redis 滑动窗口 + ChatService 集成
- BullMQ 异步队列：安装 + Queue + Worker + 状态 API
- Mem0 管理页面：admin `/account/memories` + proxy 通路
- Deployment 文档：CHECKLIST.md + deploy.sh
- Vision 集成到文档上传：图片 OCR/视频理解 + 自动降级
