# RAG CLI Roadmap

> 本文件是 RAG CLI 文档项目的进度源。RAG 服务项目进度不在这里维护。

## 当前状态

- **CLI PRD 已完成并优化**（2026-06-24）：`CLI_PRD.md` 已补充飞书 CLI 产品形态参考、脚手架调研图映射、交互体验规范、`rag init` 配置初始化和脚手架能力边界。
- **CLI 架构设计已完成并优化**（2026-06-24）：`CLI_ARCHITECTURE.md` 已补充 Commander.js、飞书官方 CLI、yargs、oclif、cac、stricli 以及常见脚手架工具链对比，第一版选择 Commander.js + TypeScript。
- **CLI 代码实现未开始**。

## 当前选型

- CLI 框架：Commander.js。
- 语言：TypeScript。
- 运行时：Node.js 20+。
- 交互：Inquirer 系列。
- 输出美化：Chalk。
- Loading：Ora。
- 校验：Zod。
- HTTP：Node fetch，必要时再引入 Undici。

## 下一步

1. 创建独立 `cli/` 实现项目，并先写 `cli/CLAUDE.md`。
2. 建立 `rag --help`、`rag --version`、`rag init`、`rag doctor` 骨架。
3. 实现 `RagApiClient`、`ConfigStore`、`OutputFormatter`、`ContextBuilder`。
4. 实现 P0 命令：`auth`、`search`、`ask`、`context`、`skill match`、`doctor`。
5. 后续视真实使用情况决定是否增加正式后端 `POST /api/rag/search` 和 `POST /api/rag/context`。

## 阻塞与红线

- 新增依赖、创建 CLI 实现项目之前，需要按当前任务确认范围。
- 不做 npm publish。
- 不改 CI/CD。
- 不改数据库 schema 或迁移。
- 不修改 RAG 服务生产配置。

