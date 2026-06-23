# RAG CLI Roadmap

> 本文件是 RAG CLI 实现项目的真实进度源。只有已经实现并验证的事项才进入已完成。

## 当前状态

- **项目骨架完成**（2026-06-24）：创建独立 `rag-cli/` 项目，包含 `CLAUDE.md`、`ROADMAP.md`、`package.json`、`tsconfig.json` 和源码/测试目录。
- **P0 命令实现完成**（2026-06-24）：实现 `rag init`、`rag auth login/status/logout`、`rag config get/set`、`rag search`、`rag ask`、`rag context`、`rag skill list/match`、`rag doc list/show`、`rag doctor`。
- **核心模块实现完成**（2026-06-24）：实现 `RagApiClient`、`ConfigStore`、`OutputFormatter`、`ContextBuilder`、终端输出隔离、错误码和 spinner 封装。
- **依赖管理切换为 pnpm**（2026-06-24）：`package.json` 声明 `packageManager=pnpm@10.17.1`，测试脚本改为 `pnpm run build`，依赖锁定改用 `pnpm-lock.yaml`。
- **交互依赖瘦身完成**（2026-06-24）：移除 `@inquirer/prompts`，改用 Node 内置 readline 实现 prompt/secret prompt，避免 JSON module 实验警告污染脚本环境。
- **运行时输出净化完成**（2026-06-24）：移除 `ora`，改用自定义 stderr spinner，避免 `cli-spinners` JSON module 实验警告污染脚本环境。
- **本地验证完成**（2026-06-24）：`pnpm run build` 通过；`pnpm test` 通过 10/10；`node dist/src/bin.js --help` 正常输出命令列表；`doctor --format json` 在不可达 base URL 下返回退出码 1、stdout 纯 JSON、stderr 0 行、`doctor_failed` 和 `service_unavailable`；非法参数返回 `invalid_args`。
- **中文使用说明完成**（2026-06-24）：新增 `USAGE.zh-CN.md`，覆盖安装构建、配置认证、常用命令、JSON 输出契约、Agent/Skill 调用方式、企业级使用建议和排障说明；README 增加中文文档入口。
- **CLI 文档归档完成**（2026-06-24）：将原 `cli-docs/` 内容复制到 `rag-cli/docs/`，并把 `rag-cli` 内部引用统一改为 `docs/`；源 `cli-docs/` 按删除红线保留未删。

## 已完成

- [x] 独立 CLI 项目规则文件。
- [x] 独立 CLI 进度文件。
- [x] Commander 命令注册。
- [x] 用户级配置读写。
- [x] JSON / Markdown / table 输出。
- [x] API 客户端和 transform response 解包。
- [x] P0/P1 基础命令。
- [x] 单元测试和关键 CLI smoke 回归测试。
- [x] 中文使用说明文档。
- [x] CLI PRD / 架构 / 文档 roadmap 归档到 `docs/`。

## 已验证

- [x] 安装依赖。
- [x] TypeScript build。
- [x] 单元测试。
- [x] `--help` smoke。
- [x] `doctor --format json` 在无后端服务时返回可恢复错误。
- [x] 参数校验错误返回 `invalid_args`。
- [x] `doctor --format json --base-url http://127.0.0.1:9/api/v1 --timeout 500` 保持 stderr 为空且 stdout 可被脚本解析。

## 后续

- [ ] 接入正式 `POST /api/rag/search`。
- [ ] 接入正式 `POST /api/rag/context`。
- [ ] 增加 SSE 流式 `rag ask --stream` 的完整事件展示。
- [ ] 增加 `rag admin search`、`rag graph query`、`rag eval run`。

## 红线

- 不做 npm publish。
- 不改 CI/CD。
- 不改数据库 schema 或 migration。
- 不修改 RAG 服务生产配置。
