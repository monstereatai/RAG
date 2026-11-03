# 任务清单：文档入库隐私脱敏

## T001：Presidio 检测和本地服务

- 依赖：无
- 允许文件：`apps/rag-api/src/modules/document/document-privacy.service.ts`、`apps/rag-api/src/modules/document/document-privacy.service.spec.ts`、`apps/rag-api/src/modules/document/document.module.ts`、`infra/docker/docker-compose.dev.yml`、`apps/rag-api/.env.example`、`docs/OPERATIONS.md`
- 操作：实现 loopback Analyzer 客户端与中文结构化规则；增加 Docker `privacy` profile 和手动启动说明。
- 对应 AC：AC-01、AC-03
- 验证：`pnpm --filter backend test --runInBand src/modules/document/document-privacy.service.spec.ts`；`docker compose -f infra/docker/docker-compose.dev.yml config --quiet`
- 完成定义：服务按规则识别并替换有效命中；Analyzer 错误失败关闭；Compose 只将端口映射至 loopback。
- 状态：done

## T002：共享入库和 Obsidian 数据脱敏

- 依赖：T001
- 允许文件：`apps/rag-api/src/modules/document/document.service.ts`、`apps/rag-api/src/modules/document/document.service.upload-workflow.ts`、`apps/rag-api/src/modules/document/document-parser-ingestion.contract.spec.ts`、`apps/rag-api/src/modules/document/obsidian-ingest.service.ts`、`apps/rag-api/src/modules/document/obsidian-ingest.service.spec.ts`、`apps/rag-api/src/modules/document/document.controller.ts`
- 操作：入库前脱敏正文、解析字段和业务字符串；使队列名称、异步任务及 Obsidian 元数据不保留原始标题/文件名。
- 对应 AC：AC-01
- 验证：`pnpm --filter backend test --runInBand src/modules/document/document-privacy.service.spec.ts`；后端 build/lint。
- 完成定义：提示注入检查仍基于原始内容；所有下游索引/生成路径使用脱敏内容。
- 状态：done

## T003：MinerU 出站门禁

- 依赖：T001、T002
- 允许文件：`apps/rag-api/src/modules/document/document.controller.ts`、`apps/rag-api/src/modules/document/document.controller.privacy.spec.ts`
- 操作：用不含远程 OCR/Vision 的本地解析做预检，命中或不完整时不调用 MinerU。
- 对应 AC：AC-02
- 验证：`pnpm --filter backend test --runInBand src/modules/document/document.controller.privacy.spec.ts`
- 完成定义：mock 断言每个分支的云调用次数和本地结果状态。
- 状态：done

## T004：最终验证和进度记录

- 依赖：T001、T002、T003
- 允许文件：`ROADMAP.md`、`specs/001-pii-ingestion/verify.md`
- 操作：运行计划验证、检查本次 Diff 与用户已有改动分界、记录结果。
- 对应 AC：AC-01、AC-02、AC-03
- 验证：后端定向 Jest、build、目标 ESLint、Compose config、`git diff --check`。
- 完成定义：验证记录含退出状态和未解决限制；ROADMAP 只记已验证事项。
- 状态：done
