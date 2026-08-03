# RAG CLI Roadmap

> 本文件是 RAG CLI 文档项目的进度源。RAG 服务项目进度不在这里维护。

## 当前状态

- **CLI PRD 已完成并优化**（2026-06-24）：`CLI_PRD.md` 已补充飞书 CLI 产品形态参考、脚手架调研图映射、交互体验规范、`rag init` 配置初始化和脚手架能力边界。
- **CLI 架构设计已完成并优化**（2026-06-24）：`CLI_ARCHITECTURE.md` 已补充 Commander.js、飞书官方 CLI、yargs、oclif、cac、stricli 以及常见脚手架工具链对比，第一版选择 Commander.js + TypeScript。
- **CLI 代码 MVP 已迁移到 `rag-cli/`**（2026-06-24）：本目录作为旧文档归档副本保留，不作为实现项目。
- **Karpathy + Obsidian 后端响应已对齐**（2026-07-04）：`rag ask` human 输出展示答案、检索状态、Sources、Obsidian 路径；JSON 输出保留完整后端字段；`rag context` 在 debug chunks 为空时可用 `ask auto` 可靠兜底，但纯模型兜底仍返回 `insufficient_context`。
- **正式后端 API 与高级命令已对齐**（2026-07-05）：`rag search` / `rag context` 优先调用正式 `/rag/search`、`/rag/context`；`rag ask --stream` 消费后端 SSE；新增 `rag admin search`、`rag graph query`、`rag eval status`、`rag eval run`。本目录是归档副本，代码实现在 `rag-cli/`。
- **当前主项目真实口径**（2026-08-03）：项目级 RAG 评测 28/28；成熟度 93/100；Milvus search runtime 降级和生产材料未确认仍是后端/运行环境阻塞，CLI 只消费状态，不直接治理。

## 当前选型

- CLI 框架：Commander.js。
- 语言：TypeScript。
- 运行时：Node.js 20+。
- 交互：Node readline。
- 输出美化：Chalk。
- Loading：自定义 stderr spinner。
- 校验：Zod。
- HTTP：Node fetch，必要时再引入 Undici。

## 下一步

1. 增加更多真实后端联调 smoke，覆盖 `ask --stream`、`graph query`、`eval run`。
2. 视后端状态 API 成熟度，把主项目成熟度、Milvus runtime 降级、项目级评测结果并入 `rag eval status`。
3. 根据真实使用情况再扩展更多 admin/graph/eval 子命令，避免一次性做成大而全平台。

## 阻塞与红线

- 新增依赖、创建 CLI 实现项目之前，需要按当前任务确认范围。
- 不做 npm publish。
- 不改 CI/CD。
- 不改数据库 schema 或迁移。
- 不修改 RAG 服务生产配置。
