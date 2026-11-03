# 实施计划：文档入库隐私脱敏

## 已确认上下文

- 共享入库路径为 `DocumentUploadWorkflow.upload`，切块、元数据提取、Hypothetical Questions、Embedding 与索引写入均在其后。
- MinerU 在 `DocumentController.extractUploadContent` 中接收原始文件字节。
- Obsidian 队列另存标题、文件名和正文哈希；异步上传先创建任务并以文件名构造原文件对象键。
- 用户要求其他服务手动启动；本地开发脚本继续只启动 RAG API。

## 方案

- 数据流：文档字段 → 本机 Presidio `/analyze` 批量检测 → 校验身份证/银行卡命中 → 从右向左替换为类型标签 → 现有入库链路。
- Presidio 使用请求级正则 recognizer，不依赖云端 DLP；API URL 只接受 loopback HTTP。
- 自定义识别器采用 Presidio Analyzer 的请求级 ad-hoc recognizer 接口，参照[官方 Analyzer 文档](https://microsoft.github.io/presidio/analyzer/)。
- MinerU 路径先关闭远程 OCR/Vision 做本地预解析；只有解析完整、没有命中且无未 OCR 图片才上传原文件。预检不完整时只用本地结果；分析器失败时阻断。
- 原始文件字节与既有保留行为不变；文件名和进入索引/Obsidian 的文本元数据会脱敏。
- 无数据库 schema 或迁移变更；不改 `.env`，只更新 `.env.example`。

## 文件清单

| 文件 | 操作 | 原因 | 对应 AC |
| --- | --- | --- | --- |
| `apps/rag-api/src/modules/document/document-privacy.service.ts` | add | Presidio 客户端、规则、校验与替换 | AC-01, AC-02 |
| `apps/rag-api/src/modules/document/document-privacy.service.spec.ts` | add | 检测、校验、失败关闭测试 | AC-01 |
| `apps/rag-api/src/modules/document/document.controller.privacy.spec.ts` | add | MinerU 出站门禁分支测试 | AC-02 |
| `apps/rag-api/src/modules/document/document.module.ts` | modify | 注册隐私服务 | AC-01, AC-02 |
| `apps/rag-api/src/modules/document/document.service.ts` | modify | 将服务接入共享工作流上下文 | AC-01 |
| `apps/rag-api/src/modules/document/document.service.upload-workflow.ts` | modify | 入库前扫描全部文本字段 | AC-01 |
| `apps/rag-api/src/modules/document/document-parser-ingestion.contract.spec.ts` | modify | 工作流上下文加入隐私扫描器 | AC-01 |
| `apps/rag-api/src/modules/document/document.controller.ts` | modify | 文件名预脱敏及 MinerU 云前预检 | AC-02 |
| `apps/rag-api/src/modules/document/obsidian-ingest.service.ts` | modify | Obsidian 队列只持有脱敏后标题、文件名和切块正文哈希 | AC-01 |
| `apps/rag-api/src/modules/document/obsidian-ingest.service.spec.ts` | modify | Obsidian 队列脱敏回归测试 | AC-01 |
| `infra/docker/docker-compose.dev.yml` | modify | 增加手动启动的 loopback Presidio profile | AC-03 |
| `apps/rag-api/.env.example` | modify | 记录本地 Analyzer URL | AC-03 |
| `docs/OPERATIONS.md` | modify | 记录独立启动和使用方式 | AC-03 |
| `ROADMAP.md` | modify | 记录实现和验证进展 | AC-01–AC-03 |
| `specs/README.md`, `specs/001-pii-ingestion/*` | add/modify | 项目变更规格目录及验收记录 | AC-01–AC-03 |

## 执行顺序

1. 增加 Presidio 客户端与脱敏单测，并配置手动启动的 Docker profile。
2. 将统一脱敏接入共享入库和 Obsidian 写入，再接入文件名处理。
3. 在 MinerU 调用前加入完整性与隐私门禁，编写控制器回归测试。
4. 执行目标 build/lint/Jest/Compose 检查，审阅 Diff 后更新 ROADMAP 与验证记录。

## 验证计划

| 层级 | 命令或操作 | 通过条件 |
| --- | --- | --- |
| unit | `pnpm --filter backend test --runInBand src/modules/document/document-privacy.service.spec.ts src/modules/document/document.controller.privacy.spec.ts src/modules/document/document-parser-ingestion.contract.spec.ts src/modules/document/obsidian-ingest.service.spec.ts` | 隐私识别、校验、字段替换、入库旁路和 MinerU 分支用例通过 |
| lint | `pnpm --filter backend exec eslint <本次修改的 TypeScript 文件>` | 无 lint 错误 |
| build | `pnpm --filter backend build` | NestJS 构建通过 |
| compose | `docker compose -f infra/docker/docker-compose.dev.yml config --quiet` | profile YAML 可解析 |
| diff | `git diff --check` | 无空白错误 |

## 执行控制

- 状态恢复：off
- 独立审查：off
- 分支策略：保留当前 `main`，不切换分支
- 提交策略：none

## 风险与回退

- 主机需要本地 Docker 运行 Presidio；未启动时入库会 fail-closed。
- 自动识别无法保证发现所有隐私；姓名/地址及未提取图像文本不在首版范围。
- 回退方式：停止使用隐私保护入库功能并由主人决定是否恢复代码；不自动回滚或删除文件。

## 审批

- Plan 状态：approved
- 批准人：主人
- 批准时间：2026-11-03（本会话）
- 批准证据：“按推荐方案开始”；“按主流方案来做”。
