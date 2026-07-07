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
- **Karpathy + Obsidian 输出对齐完成**（2026-07-04）：`rag ask` 明确展示 answer、retrievalSufficient、retrievalReason、references 和 obsidianPaths；JSON 模式保留后端完整字段，适配 simple/auto 的 Karpathy + Obsidian Fast Path。
- **Context fallback 对齐完成**（2026-07-04）：`rag context` 先走 debug chunks，检索为空时使用 `ask auto` 作为可靠兜底；只有 references、obsidianPaths 或 `retrievalSufficient=true` 时才输出上下文包，纯模型兜底仍返回 `insufficient_context`。
- **正式 RAG API 与高级命令接入完成**（2026-07-05）：`rag search` 优先走正式 `POST /api/v1/rag/search`，`rag context` 优先走正式 `POST /api/v1/rag/context`；`rag ask --stream` 消费后端真实 SSE；新增 `rag admin search`、`rag graph query`、`rag eval status`、`rag eval run`。

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
- [x] `ask` human 输出适配 Karpathy + Obsidian 元数据。
- [x] `context` 支持 Karpathy + Obsidian Fast Path 兜底。
- [x] `search` / `context` 接入正式后端 RAG 网关 API，旧后端缺接口时保守降级。
- [x] `ask --stream` 消费后端 SSE 真实流式输出。
- [x] `admin search` / `graph query` / `eval status` / `eval run` 命令。

## 已验证

- [x] 安装依赖。
- [x] TypeScript build。
- [x] 单元测试。
- [x] `--help` smoke。
- [x] `doctor --format json` 在无后端服务时返回可恢复错误。
- [x] 参数校验错误返回 `invalid_args`。
- [x] `doctor --format json --base-url http://127.0.0.1:9/api/v1 --timeout 500` 保持 stderr 为空且 stdout 可被脚本解析。
- [x] `pnpm run build` 通过（2026-07-04）。
- [x] `pnpm test` 通过 10/10（2026-07-04）。
- [x] `node dist/src/bin.js ask ... --format markdown` 可展示答案、检索状态、Sources、Obsidian 路径（2026-07-04）。
- [x] `node dist/src/bin.js context ... --format json` 在 debug chunks 为空时可用 `ask auto` 兜底返回可靠上下文（2026-07-04）。
- [x] `pnpm run build` 通过（2026-07-05）。
- [x] `pnpm test` 通过 11/11（2026-07-05，含 SSE CRLF 分隔回归测试）。
- [x] `node dist/src/bin.js --help`、`ask --help`、`admin --help`、`graph --help`、`eval --help` 可见新增命令（2026-07-05）。
- [x] `search/eval status --format json` 在不可达 base URL 下返回稳定 `service_unavailable` JSON（2026-07-05）。
- [x] 临时当前构建服务 `PORT=3015` 在线 smoke 通过：正式 `rag/search` 与 `rag/context` HTTP 返回 201 且 count=2；CLI `search` 返回 count=2；CLI `eval status` 返回 count=4（2026-07-05）。常驻 `3000` 旧进程需重启后加载新路由。

## 后续

- [ ] Milvus runtime 仍为服务端阻塞：CLI 只展示状态，不直接治理 Milvus、数据库或生产配置。
- [ ] 真实后端在线联调 `rag ask --stream`、`rag graph query`、`rag eval run`；本轮已完成正式 search/context 与 eval status 在线 smoke，生成型/图谱型命令仍建议在重启常驻 3000 后复验。

## 红线

- 不做 npm publish。
- 不改 CI/CD。
- 不改数据库 schema 或 migration。
- 不修改 RAG 服务生产配置。
