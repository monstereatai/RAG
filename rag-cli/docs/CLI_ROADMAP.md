# RAG CLI 文档 Roadmap

> 本文件记录 RAG CLI 文档规划和历史决策。CLI 代码实现进度以 `../ROADMAP.md` 为准；RAG 服务项目进度不在这里维护。

## 当前状态

- **CLI PRD 已完成并优化**（2026-06-24）：`CLI_PRD.md` 已补充飞书 CLI 产品形态参考、脚手架调研图映射、交互体验规范、`rag init` 配置初始化和脚手架能力边界。
- **CLI 架构设计已完成并优化**（2026-06-24）：`CLI_ARCHITECTURE.md` 已补充 Commander.js、飞书官方 CLI、yargs、oclif、cac、stricli 以及常见脚手架工具链对比，第一版选择 Commander.js + TypeScript。
- **CLI 文档已迁移到实现项目**（2026-06-24）：原 `cli-docs/` 内容已归档到 `rag-cli/docs/`，文档和代码现在同属 `rag-cli` 项目边界。
- **CLI 代码 MVP 已完成**（2026-06-24）：当前实现进度详见 `../ROADMAP.md`。

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

1. 对齐正式后端 `POST /api/rag/search` 和 `POST /api/rag/context`。
2. 增加 SSE 流式 `rag ask --stream` 展示。
3. 增加更多真实后端联调 smoke。
4. 后续视真实使用情况决定是否增加 `rag admin search`、`rag graph query`、`rag eval run`。

## 阻塞与红线

- 不做 npm publish。
- 不改 CI/CD。
- 不改数据库 schema 或迁移。
- 不修改 RAG 服务生产配置。
