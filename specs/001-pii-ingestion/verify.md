# 验证记录：文档入库隐私脱敏

## 范围与 Diff

- 计划内文件：隐私识别服务、共享入库、MinerU 预检、Obsidian 队列、Docker Compose、环境模板、运维文档、ROADMAP 与规格工件。
- 实际新增测试：隐私识别服务单测、MinerU 门禁单测；扩展工作流上下文与 Obsidian 队列单测。
- 范围门禁：pass；改动都对应 AC-01 至 AC-03。
- 无关已有变更：保留 `.obsidian/workspace.json`、日志脚本、解析器、RAG Admin、锁文件和 BM25 索引等当前工作区改动，未归入本次交付。

## 自动验证

| 验证 | 命令／操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| unit | `pnpm --filter backend test --runInBand src/modules/document/document-privacy.service.spec.ts src/modules/document/document.controller.privacy.spec.ts src/modules/document/document-parser-ingestion.contract.spec.ts src/modules/document/obsidian-ingest.service.spec.ts` | pass | 4 suites，19 tests |
| lint | 对本次修改的 10 个 TypeScript 源码/测试文件运行 ESLint | pass | 退出码 0 |
| format | 对本次修改的 TypeScript 文件运行 Prettier `--check` | pass | 所有目标文件格式通过 |
| build | `pnpm --filter backend build` | pass | NestJS build 退出码 0 |
| compose | `docker compose -f infra/docker/docker-compose.dev.yml config --quiet` | pass | 配置解析退出码 0 |
| scoped diff | `git diff --check -- <本次目标文件>` | pass | 退出码 0 |
| full diff | `git diff --check` | blocked by existing workspace content | 未改动的 `apps/rag-api/src/modules/rag-admin/rag-admin.service.ingestion.ts:39,83` 有尾随空格 |

## 验收标准追踪

| AC | 结果 | 验证证据 | 备注 |
| --- | --- | --- | --- |
| AC-01 | pass | Analyzer 客户端、校验与 nested fields 定向测试；共享入库与 Obsidian 回归测试 | 没有对历史数据回填 |
| AC-02 | pass | 控制器 mock 测试覆盖无命中、命中、不完整、图片未 OCR、解析失败和 Analyzer 失败 | 实际 Presidio 容器未启动，因此没有真实 HTTP 集成验证 |
| AC-03 | pass | Compose profile 静态解析与操作文档核对 | `presidio-analyzer` 未自动启动；需手动按运维文档启动 |

## 例外与风险

- 原始文件字节保留原有存储行为，不会因此自动脱敏。
- 首版识别中国大陆手机号、校验有效的 18 位居民身份证号、Luhn 银行卡号、邮箱及明显凭据；姓名和地址不自动识别。
- MinerU 的本地门禁关闭远程 OCR/Vision；图像资产和解析不完整时跳过 MinerU。其他 OCR、ASR、Vision 出站链路没有被本次改造控制。
- Analyzer 不可用或扫描文本超过 2,000 万字符上限时，RAG 入库失败关闭。
- 旧队列中的文件名会在异步处理入口重新扫描；已有对象、索引和 Obsidian 笔记不做历史清理。
- 全工作区 `git diff --check` 的尾随空格来自现有 RAG Admin 改动；本次未修改该文件。

## 结论

- 状态：ready_for_review
- 人工验收证据：尚未记录
